(function (root) {
    'use strict';

    const CLASSIFICATION_VERSION = 1;
    const ACTIVITY_CLASSES = Object.freeze([
        'unknown', 'very_active', 'active', 'regular', 'occasional', 'rare', 'dormant', 'reactivated'
    ]);
    const RING_LIMIT = 20;
    const DAY_MS = 24 * 60 * 60 * 1000;
    const SESSION_GAP_MS = 12 * 60 * 60 * 1000;

    function median(values) {
        if (!values.length) return null;
        const sorted = [...values].sort((left, right) => left - right);
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
    }

    function mergeUploadTimestamps(existing, entries) {
        const values = new Set((existing || []).map(Number).filter((value) => Number.isFinite(value) && value > 0));
        (entries || []).forEach((entry) => {
            const publishedAt = Number(entry && entry.publishedAt);
            if (Number.isFinite(publishedAt) && publishedAt > 0) values.add(publishedAt);
        });
        return [...values].sort((left, right) => right - left).slice(0, RING_LIMIT);
    }

    function countSince(timestamps, now, days) {
        const cutoff = now - days * DAY_MS;
        return timestamps.filter((timestamp) => timestamp >= cutoff).length;
    }

    // Several videos released together are one publishing session for
    // scheduling purposes. Raw upload counts are still retained separately.
    function clusterUploadSessions(timestamps) {
        const sessions = [];
        let newestInSession = null;
        (timestamps || []).forEach((timestamp) => {
            if (newestInSession === null || newestInSession - timestamp > SESSION_GAP_MS) {
                sessions.push(timestamp);
                newestInSession = timestamp;
            }
        });
        return sessions;
    }

    function observedActivityClass(timestamps, now) {
        const latest = Number(timestamps[0] || 0);
        if (!latest) return 'unknown';
        if (latest < now - 180 * DAY_MS) return 'dormant';
        const sessions = clusterUploadSessions(timestamps);
        const sessions7d = countSince(sessions, now, 7);
        const sessions30d = countSince(sessions, now, 30);
        const sessions90d = countSince(sessions, now, 90);
        const intervals = sessions.slice(0, 10).map((timestamp, index, values) =>
            index + 1 < values.length ? timestamp - values[index + 1] : null
        ).filter((value) => value > 0);
        const medianIntervalMs = median(intervals);
        const ageMs = Math.max(0, now - latest);
        if (sessions7d >= 10 || (medianIntervalMs && medianIntervalMs <= 12 * 60 * 60 * 1000 && ageMs <= 2 * DAY_MS)) return 'very_active';
        if (sessions7d >= 4 || (medianIntervalMs && medianIntervalMs <= 3 * DAY_MS && ageMs <= 10 * DAY_MS)) return 'active';
        if (sessions30d >= 2 || (medianIntervalMs && medianIntervalMs <= 14 * DAY_MS && ageMs <= 30 * DAY_MS)) return 'regular';
        if (sessions90d >= 1 && ageMs <= 90 * DAY_MS) return 'occasional';
        return 'rare';
    }

    function classRank(activityClass) {
        if (activityClass === 'unknown') return null;
        if (activityClass === 'reactivated') return ACTIVITY_CLASSES.indexOf('rare');
        const rank = ACTIVITY_CLASSES.indexOf(activityClass);
        return rank < 0 ? null : rank;
    }

    function stepTowardActivityClass(current, target) {
        const currentRank = classRank(current);
        const targetRank = classRank(target);
        if (currentRank === null || targetRank === null) return target;
        if (currentRank === targetRank) return target;
        const nextRank = currentRank + Math.sign(targetRank - currentRank);
        return ACTIVITY_CLASSES[nextRank];
    }

    function classifyChannelActivity(existing, entries, now = Date.now()) {
        const timestamps = mergeUploadTimestamps(existing && existing.recentUploadTimestamps, entries);
        const sessions = clusterUploadSessions(timestamps);
        const latestUploadAt = Number(timestamps[0] || 0) || null;
        const intervals = sessions.slice(0, 10).map((timestamp, index, values) =>
            index + 1 < values.length ? timestamp - values[index + 1] : null
        ).filter((value) => value > 0);
        const latestKnown = Number(existing && existing.latestUploadAt || 0);
        const hasNewUpload = !!latestUploadAt && latestUploadAt > latestKnown;
        const observed = observedActivityClass(timestamps, now);
        const current = existing && existing.activityClass;
        const activityClass = hasNewUpload && (current === 'dormant' || current === 'rare')
            ? 'reactivated'
            : stepTowardActivityClass(current, observed);
        return {
            classificationVersion: CLASSIFICATION_VERSION,
            recentUploadTimestamps: timestamps,
            recentUploadSessionTimestamps: sessions,
            latestUploadAt,
            medianUploadIntervalMs: median(intervals),
            recentMedianUploadIntervalMs: median(intervals.slice(0, 5)),
            uploads7d: countSince(timestamps, now, 7),
            uploads30d: countSince(timestamps, now, 30),
            uploads90d: countSince(timestamps, now, 90),
            uploadSessions7d: countSince(sessions, now, 7),
            uploadSessions30d: countSince(sessions, now, 30),
            uploadSessions90d: countSince(sessions, now, 90),
            activityClass,
            classificationConfidence: Math.min(1, timestamps.length / 10),
            classificationUpdatedAt: now,
            reactivatedAt: activityClass === 'reactivated' ? now : null,
            hasNewUpload
        };
    }

    const api = { CLASSIFICATION_VERSION, ACTIVITY_CLASSES, RING_LIMIT, DAY_MS, SESSION_GAP_MS, mergeUploadTimestamps, clusterUploadSessions, observedActivityClass, stepTowardActivityClass, classifyChannelActivity };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.ytvhtFeedChannelClassification = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
