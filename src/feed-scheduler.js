(function (root) {
    'use strict';

    const contracts = root.ytvhtFeedContracts || (typeof require === 'function' ? require('./feed-contracts.js') : null);
    const rssClient = root.ytvhtRssClient || (typeof require === 'function' ? require('./rss-client.js') : null);
    const ingestion = root.ytvhtFeedIngestion || (typeof require === 'function' ? require('./feed-ingestion.js') : null);
    const retention = root.ytvhtFeedRetention || (typeof require === 'function' ? require('./feed-retention.js') : null);
    const classification = root.ytvhtFeedChannelClassification || (typeof require === 'function' ? require('./feed-channel-classification.js') : null);

    const DEFAULTS = Object.freeze({
        foregroundBatchSize: 30,
        initializationBatchSize: 30,
        concurrency: 4,
        requestTimeoutMs: 10000,
        leaseMs: 30000,
        successfulCheckIntervalMs: 6 * 60 * 60 * 1000,
        retryBaseMs: 60 * 1000,
        retryMaxMs: 60 * 60 * 1000,
        unavailableChannelRetryMs: 30 * 24 * 60 * 60 * 1000,
        activityIntervalsMs: Object.freeze({
            very_active: 60 * 60 * 1000,
            active: 3 * 60 * 60 * 1000,
            regular: 8 * 60 * 60 * 1000,
            occasional: 24 * 60 * 60 * 1000,
            rare: 7 * 24 * 60 * 60 * 1000,
            dormant: 30 * 24 * 60 * 60 * 1000,
            reactivated: 3 * 24 * 60 * 60 * 1000
        }),
        newSubscriptionBonusMs: 60 * 60 * 1000
    });

    function nowFrom(clock) {
        return Number(clock());
    }

    function uniqueChannelIds(channelIds) {
        return [...new Set((channelIds || []).map((channelId) => String(channelId || '').trim()).filter(Boolean))];
    }

    class FeedScheduler {
        constructor(options = {}) {
            if (!contracts || !rssClient || !ingestion || !classification) throw new Error('Feed scheduler dependencies are unavailable');
            if (!options.storage) throw new TypeError('A feed repository storage is required');
            this.storage = options.storage;
            this.clock = options.clock || Date.now;
            this.fetchChannelRss = options.fetchChannelRss || rssClient.fetchChannelRss;
            this.ingestRssScan = options.ingestRssScan || ingestion.ingestRssScan;
            Object.assign(this, DEFAULTS, options);
            this.listeners = new Set();
            this.runSequence = 0;
            this.paused = false;
            this.cancelledRunIds = new Set();
            this.setInitializationHistoryPriority(options);
        }

        subscribe(listener) {
            if (typeof listener !== 'function') throw new TypeError('A progress listener must be a function');
            this.listeners.add(listener);
            return () => this.listeners.delete(listener);
        }

        publish(snapshot) {
            const progress = contracts.createForegroundProgress(snapshot);
            this.listeners.forEach((listener) => listener(progress));
            return progress;
        }

        pause() {
            this.paused = true;
        }

        resume() {
            this.paused = false;
        }

        cancel(runId) {
            if (runId) this.cancelledRunIds.add(String(runId));
        }

        shouldStopRun(runId) {
            return this.paused || this.cancelledRunIds.has(String(runId));
        }

        setInitializationHistoryPriority(options = {}) {
            this.recentHistoryChannelIds = new Set(uniqueChannelIds(options.recentHistoryChannelIds));
            this.historyChannelIds = new Set(uniqueChannelIds(options.historyChannelIds));
        }

        initializationPriority(state) {
            if (this.recentHistoryChannelIds.has(state.channelId)) return 0;
            if (this.historyChannelIds.has(state.channelId)) return 1;
            return 2;
        }

        async recoverExpiredLeases(at = nowFrom(this.clock)) {
            const states = await this.storage.listChannelSyncStates();
            const expired = states.filter((state) => Number(state.scanLeaseUntil || 0) > 0 && Number(state.scanLeaseUntil) <= at);
            await Promise.all(expired.map((state) => this.storage.putChannelSyncState({
                ...state,
                scanLeaseUntil: null,
                scanRunId: null
            })));
            return expired.length;
        }

        async initializeSubscriptions(channelIds) {
            const subscriptions = await this.storage.listSubscriptionRecords();
            const selectedIds = channelIds ? new Set(uniqueChannelIds(channelIds)) : null;
            const eligible = subscriptions.filter((subscription) =>
                contracts.canInitializeSubscription(subscription) && (!selectedIds || selectedIds.has(subscription.channelId)));
            const at = nowFrom(this.clock);
            let queued = 0;
            for (const subscription of eligible) {
                const state = await this.storage.getChannelSyncState(subscription.channelId);
                if (!state) {
                    await this.storage.putChannelSyncState({
                        channelId: subscription.channelId,
                        initializationState: 'pending',
                        nextEligibleCheckAt: at,
                        scanLeaseUntil: null,
                        scanRunId: null
                    });
                    queued += 1;
                }
            }
            return queued;
        }

        async start() {
            const recoveredLeaseCount = await this.recoverExpiredLeases();
            const initializedChannelCount = await this.initializeSubscriptions();
            return { recoveredLeaseCount, initializedChannelCount };
        }

        async getInitializationProgress() {
            const [subscriptions, states] = await Promise.all([
                this.storage.listSubscriptionRecords(),
                this.storage.listChannelSyncStates()
            ]);
            const stateByChannelId = new Map(states.map((state) => [state.channelId, state]));
            const initialized = subscriptions.filter((subscription) => contracts.canInitializeSubscription(subscription));
            const completed = initialized.filter((subscription) => {
                const state = stateByChannelId.get(subscription.channelId);
                return state && Number(state.lastAttemptAt || 0) > 0;
            }).length;
            return { completed, total: initialized.length, pending: Math.max(0, initialized.length - completed) };
        }

        async runInitialization(options = {}) {
            await this.initializeSubscriptions(options.channelIds);
            const at = nowFrom(this.clock);
            // Filter initialization work before applying its finite batch bound;
            // regular due channels must not starve newly added subscriptions.
            const states = await this.storage.getEligibleChannelSyncStates(at);
            const pending = states
                .filter((state) => state.initializationState === 'pending' && !state.lastSuccessfulCheckAt)
                .sort((left, right) => (this.initializationPriority(left) - this.initializationPriority(right)) ||
                    (Number(left.nextEligibleCheckAt || 0) - Number(right.nextEligibleCheckAt || 0)) ||
                    String(left.channelId).localeCompare(String(right.channelId)));
            return this.runBatch(pending, { ...options, limit: Number(options.limit || this.initializationBatchSize), kind: 'initialization' });
        }

        async runForeground(options = {}) {
            const at = nowFrom(this.clock);
            const states = await this.storage.getEligibleChannelSyncStates(at, Number(options.limit || this.foregroundBatchSize));
            return this.runBatch(states.filter((state) => !this.isDormantState(state)), { ...options, kind: 'foreground' });
        }

        async runBatch(states, options = {}) {
            const selected = (states || []).slice(0, Number(options.limit || this.foregroundBatchSize));
            const runId = String(options.runId || `${options.kind || 'foreground'}-${nowFrom(this.clock)}-${++this.runSequence}`);
            const startedAt = nowFrom(this.clock);
            const total = selected.length;
            let completed = 0;
            let insertedVideoCount = 0;
            const outcomes = { updated: 0, unchanged: 0, failed: 0, timed_out: 0 };
            this.publish({ runId, completed, total, insertedVideoCount, active: total > 0 });

            let cursor = 0;
            const worker = async () => {
                while (cursor < selected.length) {
                    // Pause/cancel are cooperative: an in-flight request is
                    // allowed to reach its terminal state, but no further
                    // channel is claimed. Durable pending state remains for a
                    // later resume/reconstructed run.
                    if (this.shouldStopRun(runId)) return;
                    const state = selected[cursor++];
                    const terminal = await this.scanChannel(state.channelId, runId, { kind: options.kind });
                    if (terminal) {
                        insertedVideoCount += terminal.insertedVideoCount;
                        outcomes[terminal.outcome] += 1;
                    }
                    completed += 1;
                    this.publish({ runId, completed, total, insertedVideoCount, active: completed < total });
                }
            };
            const workerCount = Math.min(Math.max(1, Number(options.concurrency || this.concurrency)), selected.length);
            await Promise.all(Array.from({ length: workerCount }, worker));
            this.cancelledRunIds.delete(runId);
            const result = { runId, completed, total, insertedVideoCount, active: false };
            await this.recordRunDiagnostic({ ...result, kind: options.kind || 'foreground', startedAt, completedAt: nowFrom(this.clock), outcomes });
            await this.cleanupRetainedFeedData();
            return result;
        }

        async recordRunDiagnostic(summary) {
            if (typeof this.storage.putFeedSyncRun !== 'function') return;
            await this.storage.putFeedSyncRun(summary);
        }

        async cleanupRetainedFeedData() {
            if (!retention || typeof retention.cleanupFeedData !== 'function' ||
                typeof this.storage.listSubscriptionFeedVideosByPublishedAt !== 'function' ||
                typeof this.storage.deleteSubscriptionFeedVideo !== 'function') return;
            await retention.cleanupFeedData(this.storage, { now: nowFrom(this.clock) });
        }

        async scanChannel(channelId, runId, options = {}) {
            const attemptedAt = nowFrom(this.clock);
            const claim = await this.storage.claimChannelSyncState(channelId, {
                runId,
                now: attemptedAt,
                leaseMs: this.leaseMs
            });
            if (!claim.claimed) return null;

            let scan;
            try {
                scan = await this.fetchChannelRss(channelId, { timeoutMs: this.requestTimeoutMs });
            } catch (error) {
                scan = contracts.createRssScanResult({
                    channelId,
                    entries: [],
                    fetchedAt: nowFrom(this.clock),
                    error: { code: 'network', message: String(error && error.message || 'RSS request failed') }
                });
            }
            const completedAt = nowFrom(this.clock);
            const terminal = await this.ingestRssScan(scan, { storage: this.storage, now: completedAt });
            const activity = !scan.error
                ? classification.classifyChannelActivity(claim.state, scan.entries, completedAt)
                : null;
            const partial = terminal.outcome === 'failed' || terminal.outcome === 'timed_out'
                ? (scan.error && Number(scan.error.status) === 404
                    ? this.unavailableChannelSchedule(claim.state, completedAt)
                    : this.failureSchedule(claim.state, completedAt))
                : {
                    initializationState: 'complete',
                    nextEligibleCheckAt: completedAt + this.activityIntervalMs(activity && activity.activityClass),
                    retryAfter: null
                };
            if (activity) Object.assign(partial, activity);
            if (options.kind === 'dormant_maintenance') {
                Object.assign(partial, this.reclassifyDormantChannel(claim.state, terminal, completedAt));
            }
            await this.storage.releaseChannelSyncState(channelId, runId, partial);
            return terminal;
        }

        async runDormantMaintenance(options = {}) {
            if (!options.pageActive) return { ran: false, reason: 'page_inactive', terminal: null };
            const at = nowFrom(this.clock);
            const due = await this.storage.getEligibleChannelSyncStates(at);
            if (due.some((state) => !this.isDormantState(state))) {
                return { ran: false, reason: 'foreground_due', terminal: null };
            }
            const candidate = await this.selectDormantCandidate(due, at);
            if (!candidate) return { ran: false, reason: 'none_due', terminal: null };

            const runId = String(options.runId || `dormant-${at}-${++this.runSequence}`);
            const terminal = await this.scanChannel(candidate.channelId, runId, { kind: 'dormant_maintenance' });
            if (terminal) {
                await this.recordRunDiagnostic({
                    runId,
                    kind: 'dormant_maintenance',
                    startedAt: at,
                    completedAt: nowFrom(this.clock),
                    total: 1,
                    completed: 1,
                    insertedVideoCount: terminal.insertedVideoCount,
                    outcomes: { updated: terminal.outcome === 'updated' ? 1 : 0, unchanged: terminal.outcome === 'unchanged' ? 1 : 0, failed: terminal.outcome === 'failed' ? 1 : 0, timed_out: terminal.outcome === 'timed_out' ? 1 : 0 }
                });
                await this.cleanupRetainedFeedData();
            }
            return { ran: Boolean(terminal), reason: terminal ? null : 'lease_unavailable', terminal };
        }

        isDormantState(state) {
            return state && (state.activityClass === 'dormant' || state.activityClass === 'rare');
        }

        async selectDormantCandidate(states, at) {
            const subscriptions = await this.storage.listSubscriptionRecords();
            const followedAtByChannel = new Map(subscriptions.map((subscription) => [subscription.channelId, Number(subscription.followedAt || 0)]));
            return (states || []).filter((state) => this.isDormantState(state)).sort((left, right) => {
                const score = (state) => {
                    const lastSuccessful = Number(state.lastSuccessfulCheckAt || 0);
                    const maintenanceAge = Math.max(0, at - lastSuccessful);
                    const followedAt = followedAtByChannel.get(state.channelId) || 0;
                    const newSubscriptionBonus = followedAt > 0
                        ? Math.max(0, this.newSubscriptionBonusMs - Math.max(0, at - followedAt))
                        : 0;
                    return maintenanceAge + newSubscriptionBonus;
                };
                const difference = score(right) - score(left);
                return difference || String(left.channelId).localeCompare(String(right.channelId));
            })[0] || null;
        }

        reclassifyDormantChannel(state, terminal, completedAt) {
            return {
                dormantMaintenanceAt: completedAt
            };
        }

        activityIntervalMs(activityClass) {
            const configured = Number(this.successfulCheckIntervalMs || DEFAULTS.successfulCheckIntervalMs);
            const byActivity = Number(this.activityIntervalsMs && this.activityIntervalsMs[activityClass]);
            return Math.max(configured, Number.isFinite(byActivity) ? byActivity : configured);
        }

        failureSchedule(state, completedAt) {
            const failures = Number(state.failureCount || 0) + 1;
            const delay = Math.min(this.retryBaseMs * (2 ** Math.max(0, failures - 1)), this.retryMaxMs);
            return {
                initializationState: state.initializationState || 'pending',
                retryAfter: completedAt + delay,
                nextEligibleCheckAt: completedAt + delay
            };
        }

        unavailableChannelSchedule(state, completedAt) {
            return {
                initializationState: 'complete',
                retryAfter: null,
                nextEligibleCheckAt: completedAt + this.unavailableChannelRetryMs,
                unavailableAt: completedAt,
                unavailableStatus: 404
            };
        }
    }

    const api = { DEFAULTS, FeedScheduler };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.ytvhtFeedScheduler = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
