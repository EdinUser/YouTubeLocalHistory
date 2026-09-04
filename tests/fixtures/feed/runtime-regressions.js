// Executed unchanged inside disposable Chrome and Firefox extension profiles.
async function verifyFeedReloadAndSearch() {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const waitFor = async (condition) => {
    const deadline = Date.now() + 8000;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error('Timed out waiting for feed regression UI');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  clearPageFeedWorkTimer();
  await requestPageActiveFeedWork();
  clearPageFeedWorkTimer();
  const originalSchedule = schedulePageFeedWork;
  const originalRender = render;
  const scheduler = ensureSharedFeedScheduler();
  const originalFetch = scheduler.fetchChannelRss;
  const delays = [];
  window.schedulePageFeedWork = delay => { delays.push(delay); };
  try {
    for (const subscription of await ytIndexedDBStorage.listSubscriptionRecords()) {
      await ytIndexedDBStorage.deleteSubscriptionAndSyncState(subscription.channelId);
    }
    const now = Date.now();
    const channelIds = Array.from({ length: 31 }, (_, index) => `UCregression${index}`);
    for (const [index, channelId] of channelIds.entries()) {
      await ytIndexedDBStorage.putSubscriptionRecord({ channelId, source: 'manual', channelTitle: `Regression ${index}`, followedAt: now, metadataHydratedAt: now });
      await ytIndexedDBStorage.putChannelSyncState({ channelId, initializationState: 'complete', lastAttemptAt: now - 10000,
        activityClass: index < 30 ? 'rare' : 'active', nextEligibleCheckAt: index < 30 ? now - 1000 + index : now + 9 * 86400000,
        unavailableStatus: index === 30 ? 404 : null, unavailableAt: index === 30 ? now - 21 * 86400000 : null });
    }
    await scheduler.start();
    const repaired = await ytIndexedDBStorage.getChannelSyncState(channelIds[30]);
    check(repaired.unavailableStatus === null && repaired.nextEligibleCheckAt <= Date.now(), 'startup left the legacy 30-day schedule in place');
    check(!repaired.rssAttempts, 'schedule repair invented an RSS read');
    const fetched = [];
    scheduler.fetchChannelRss = async channelId => {
        fetched.push(channelId);
        return ytvhtFeedContracts.createRssScanResult(channelId === channelIds[0]
          ? { channelId, fetchedAt: Date.now(), error: { code: 'network', message: 'controlled failure' } }
          : { channelId, fetchedAt: Date.now(), entries: [{
            videoId: `regression-video-${channelId}`, title: `Reload regression ${channelId}`,
            publishedAt: now, thumbnailUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
          }] });
    };
    const automatic = await requestPageActiveFeedWork();
    check(automatic.result.total === 1 && fetched[0] === channelIds[30], 'foreground scan was starved by low-activity channels');
    check(delays.length === 1 && delays[0] >= 1000, `unexpected automatic retry delays: ${JSON.stringify(delays)}`);

    // Every successful-check interval is now in the future. Manual reload
    // must still scan these channels, while deferring failure backoff/leases.
    for (const state of await ytIndexedDBStorage.listChannelSyncStates()) {
      await ytIndexedDBStorage.putChannelSyncState({ ...state, nextEligibleCheckAt: now + 86400000 });
    }
    for (const reason of ['retry', 'lease']) {
      const channelId = `UCdeferred${reason}`;
      await ytIndexedDBStorage.putSubscriptionRecord({ channelId, source: 'manual', followedAt: now, metadataHydratedAt: now });
      await ytIndexedDBStorage.putChannelSyncState({ channelId, initializationState: 'complete', lastAttemptAt: now,
        nextEligibleCheckAt: now + 86400000, retryAfter: reason === 'retry' ? now + 86400000 : null,
        scanLeaseUntil: reason === 'lease' ? now + 86400000 : null });
    }
    await loadData();
    document.getElementById('search').value = '';
    document.getElementById('navSubscriptions').click();
    const sort = document.getElementById('subscriptionSort');
    sort.value = 'published_asc';
    sort.dispatchEvent(new Event('change', { bubbles: true }));
    const beforeManual = fetched.length;
    document.getElementById('refresh').click();
    check(document.getElementById('refresh').disabled, 'manual reload did not show busy feedback');
    await waitFor(() => !document.getElementById('refresh').disabled);
    check(fetched.length - beforeManual === 31, 'manual reload did not check every eligible followed channel');
    check(document.getElementById('status').textContent === 'Checked 31 channels · 1 failed · 2 deferred.', 'manual result counts were inaccurate');
    check(pendingFeedVideoCount() === 0, 'manual reload left a redundant Show notice');
    check(sort.value === 'published_asc', 'manual reload changed the selected sort');
    await waitFor(() => document.getElementById('grid').textContent.includes(`Reload regression ${channelIds[1]}`));

    let renders = 0;
    window.render = function () { renders += 1; return originalRender(); };
    const search = document.getElementById('search');
    const type = value => { search.value = value; search.dispatchEvent(new Event('input', { bubbles: true })); };
    for (const value of ['R', 'Re', 'Rel', 'Relo', 'Reload']) type(value);
    check(renders === 0, 'feed search rendered before debounce');
    await waitFor(() => renders > 0);
    check(renders === 1, 'feed search did not coalesce rapid inputs');
    check(document.getElementById('localSearchResults').textContent.includes('Reload regression'), 'search results were not rendered');
    type('Reload regression');
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    check(renders === 2, 'Enter did not search immediately');
    type('cancelled');
    type('');
    check(renders === 3, 'clearing search was not immediate');
    await new Promise(resolve => setTimeout(resolve, 350));
    check(renders === 3, 'a cancelled search rendered later');
    const manualScans = fetched.length - beforeManual;
    window.render = originalRender;

    // Channels must check only the selected channel, promote its observed
    // cadence, and open a log from storage rather than a captured row.
    const channelId = channelIds[1];
    const previous = await ytIndexedDBStorage.getChannelSyncState(channelId);
    await ytIndexedDBStorage.putChannelSyncState({ ...previous, activityClass: 'dormant',
      latestUploadAt: now - 200 * 86400000, recentUploadTimestamps: [], rssAttempts: [], nextEligibleCheckAt: now + 30 * 86400000 });
    scheduler.fetchChannelRss = async id => {
      fetched.push(id);
      return ytvhtFeedContracts.createRssScanResult({ channelId: id, fetchedAt: Date.now(), entries:
        Array.from({ length: 20 }, (_, index) => ({ videoId: `rapid-${index}`, title: `Rapid upload ${index}`,
          publishedAt: now - index * 1800000 })) });
    };
    showSubscriptions();
    const channelRow = () => document.querySelector(`[data-channel-id="${channelId}"]`);
    await waitFor(() => !!channelRow()?.querySelector('[data-action="check"]'));
    const freshLogState = await ytIndexedDBStorage.getChannelSyncState(channelId);
    await ytIndexedDBStorage.putChannelSyncState({ ...freshLogState, rssAttempts: [
      { at: now, status: 200, code: 'success', message: 'Fresh log fixture' }
    ] });
    channelRow().querySelector('[data-action="log"]').click();
    await waitFor(() => !!document.querySelector('.rss-log-dialog'));
    check(document.querySelector('.rss-log-dialog').textContent.includes('Fresh log fixture'), 'Log used stale channel data');
    document.querySelector('.rss-log-dialog').close();

    const beforeChannelCheck = fetched.length;
    channelRow().querySelector('[data-action="check"]').click();
    check(channelRow().querySelector('[data-action="check"]').disabled, 'per-channel check did not show busy state');
    await waitFor(() => channelRow()?.textContent.includes('Checked 1 channels · 0 failed · 0 deferred.'));
    check(fetched.length === beforeChannelCheck + 1 && fetched[fetched.length - 1] === channelId, 'per-channel action checked other channels');
    const updated = await ytIndexedDBStorage.getChannelSyncState(channelId);
    check(updated.activityClass === 'very_active', 'busy channel was not promoted immediately');
    check(updated.nextEligibleCheckAt - updated.lastSuccessfulCheckAt === 3600000, 'busy channel did not receive an hourly schedule');
    check(channelRow().textContent.includes('very_active'), 'Channels did not show the recalculated activity');
    check(updated.rssAttempts.length === 2, 'channel check did not append its RSS log');
    return { automaticScans: automatic.result.total, manualScans, deferred: 2, failed: 1, searchRenders: renders };
  } finally {
    window.render = originalRender;
    window.schedulePageFeedWork = originalSchedule;
    scheduler.fetchChannelRss = originalFetch;
    clearPageFeedWorkTimer();
  }
}

async function verifyPopupSearchDebounce() {
  const search = document.getElementById('ytvhtGlobalSearchInput');
  const clear = document.getElementById('ytvhtSearchClear');
  clear.style.display = 'none';
  const deadline = Date.now() + 8000;
  // Popup storage initialization is asynchronous. Wait for the input handler
  // by observing its immediate clear-button feedback before measuring work.
  while (clear.style.display !== 'flex') {
    if (Date.now() > deadline) throw new Error('Popup search listeners did not initialize');
    search.value = 'ready';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    if (clear.style.display !== 'flex') await new Promise(resolve => setTimeout(resolve, 20));
  }
  cancelPendingPopupSearch();
  const originalSmartSearch = smartSearch;
  const originalFullSearch = showFullSearchResults;
  const calls = [];
  window.smartSearch = async query => { calls.push(query); };
  window.showFullSearchResults = async query => { calls.push(query); };
  try {
    const type = value => { search.value = value; search.dispatchEvent(new Event('input', { bubbles: true })); };
    ['r', 're', 'reload'].forEach(type);
    if (calls.length) throw new Error('Popup searched before debounce');
    await new Promise(resolve => setTimeout(resolve, 350));
    if (calls.length !== 1 || calls[0] !== 'reload') throw new Error(`Popup did not coalesce searches: ${JSON.stringify(calls)}, input=${search.value}`);
    type('enter');
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    if (calls.length !== 2 || calls[1] !== 'enter') throw new Error('Popup Enter was not immediate');
    type('cancelled');
    document.getElementById('ytvhtSearchClear').click();
    await new Promise(resolve => setTimeout(resolve, 350));
    if (calls.length !== 2 || search.value !== '') throw new Error('Popup clear did not cancel pending search');
    return { searches: calls };
  } finally {
    cancelPendingPopupSearch();
    window.smartSearch = originalSmartSearch;
    window.showFullSearchResults = originalFullSearch;
  }
}

async function verifyChannelSorting() {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const waitFor = async (condition) => {
    const deadline = Date.now() + 8000;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error('Timed out waiting for Channels sort');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  clearPageFeedWorkTimer();
  await requestPageActiveFeedWork();
  clearPageFeedWorkTimer();
  for (const subscription of await ytIndexedDBStorage.listSubscriptionRecords()) {
    await ytIndexedDBStorage.deleteSubscriptionAndSyncState(subscription.channelId);
  }
  const now = Date.now();
  const records = [
    ['z', 'Zulu', 100, 500, 'active', 300],
    ['a', 'alpha', 300, 200, 'active', 100],
    ['b', 'Beta 10', 200, 300, 'very_active', 200],
    ['c', 'Beta 2', 400, 100, 'dormant', 0],
    ['u', 'Unknown', 50, 0, 'unknown', 0],
    ['t', 'Aardvark', 500, 500, 'active', 400],
  ];
  for (const [id, channelTitle, followedAt, latestUploadAt, activityClass, lastAttemptAt] of records) {
    const channelId = `UCsort${id}`;
    await ytIndexedDBStorage.putSubscriptionRecord({ channelId, channelTitle, followedAt,
      source: 'manual', metadataHydratedAt: now });
    await ytIndexedDBStorage.putChannelSyncState({ channelId, latestUploadAt, activityClass, lastAttemptAt,
      initializationState: 'complete', nextEligibleCheckAt: now + 86400000 });
  }
  showSubscriptions();
  const order = () => [...document.querySelectorAll('#subscriptionsList .subs-card')].map(row => row.dataset.channelId.replace('UCsort', '')).join('');
  await waitFor(() => order() === 'tacbuz');
  const select = document.getElementById('channelsSort');
  const direction = document.getElementById('channelsSortDirection');
  check(select.value === 'name' && direction.textContent.includes('A–Z'), 'Channels did not default to name A–Z');
  check(select.options.length === 5 && !document.getElementById('channelsSortControls').hidden, 'Channels sort controls are incomplete');
  const cases = [
    ['name', 'tacbuz', 'zubcat', 'A–Z', 'Z–A'],
    ['followedAt', 'tcabzu', 'uzbact', 'Newest first', 'Oldest first'],
    ['latestUploadAt', 'tzbacu', 'cabtzu', 'Newest first', 'Oldest first'],
    ['activity', 'btzacu', 'ctzabu', 'Most active first', 'Least active first'],
    ['lastAttemptAt', 'cuabzt', 'tzbacu', 'Oldest first', 'Newest first'],
  ];
  for (const [field, forward, reverse, forwardLabel, reverseLabel] of cases) {
    select.value = field;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => order() === forward);
    check(direction.textContent.includes(forwardLabel), `Wrong default direction label for ${field}`);
    direction.click();
    await waitFor(() => order() === reverse);
    check(direction.textContent.includes(reverseLabel), `Wrong reversed direction label for ${field}`);
  }
  // Retain a non-default field and direction for the actual page-reload check.
  select.value = 'activity';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => order() === 'btzacu');
  direction.click();
  await waitFor(() => order() === 'ctzabu');
  check(JSON.stringify(JSON.parse(localStorage.getItem('ytvhtChannelsSort'))) === JSON.stringify({ field: 'activity', direction: 'asc' }), 'Channels sort preference was not saved');
  showFeed();
  showSubscriptions();
  await waitFor(() => order() === 'ctzabu');
  clearPageFeedWorkTimer();
  return { orders: 10, field: 'activity', direction: 'asc' };
}

async function verifyChannelSortingRestored() {
  clearPageFeedWorkTimer();
  showSubscriptions();
  const deadline = Date.now() + 8000;
  const order = () => [...document.querySelectorAll('#subscriptionsList .subs-card')].map(row => row.dataset.channelId.replace('UCsort', '')).join('');
  while (order() !== 'ctzabu') {
    if (Date.now() > deadline) throw new Error(`Channels sort did not survive reload: ${order()}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  if (document.getElementById('channelsSort').value !== 'activity' ||
      !document.getElementById('channelsSortDirection').textContent.includes('Least active first')) {
    throw new Error('Channels sort controls did not restore the saved selection');
  }
  clearPageFeedWorkTimer();
  return { restored: true };
}

module.exports = { verifyFeedReloadAndSearch, verifyPopupSearchDebounce, verifyChannelSorting, verifyChannelSortingRestored };
