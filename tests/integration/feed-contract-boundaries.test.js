const contracts = require('../../src/feed-contracts.js');
const { FIXED_NOW, CHANNEL_ID, RSS_ENTRY } = require('../fixtures/feed/contracts.js');

describe('feed contract boundaries', () => {
  test('only explicitly sourced canonical subscriptions enter initialization', () => {
    expect(contracts.canInitializeSubscription({
      channelId: CHANNEL_ID,
      source: 'takeout_csv'
    })).toBe(true);
    expect(contracts.canInitializeSubscription({
      channelId: CHANNEL_ID,
      source: 'manual'
    })).toBe(true);
    expect(contracts.canInitializeSubscription({
      channelId: CHANNEL_ID,
      source: 'history_inferred'
    })).toBe(false);
    expect(contracts.canInitializeSubscription({
      channelId: '@watched-once',
      source: 'takeout_csv'
    })).toBe(false);
  });

  test('a scan result can be completed without Home-specific work', () => {
    const scan = contracts.createRssScanResult({
      channelId: CHANNEL_ID,
      entries: [RSS_ENTRY],
      fetchedAt: FIXED_NOW
    });
    const completed = contracts.createTerminalResult({
      channelId: scan.channelId,
      outcome: 'updated',
      insertedVideoCount: scan.entries.length,
      completedAt: FIXED_NOW + 500
    });

    expect(completed).toEqual({
      channelId: CHANNEL_ID,
      outcome: 'updated',
      insertedVideoCount: 1,
      completedAt: FIXED_NOW + 500
    });
    expect(completed).not.toHaveProperty('homeEligibleCount');
  });

  test('import outcomes are bounded and report initialization separately', () => {
    const outcome = contracts.createImportOutcome({
      source: 'takeout_subscriptions',
      found: 5,
      valid: 4,
      added: 3,
      unchanged: 1,
      initializationQueued: 3,
      invalid: [{ row: 6, reason: 'missing channel URL' }]
    });

    expect(outcome).toMatchObject({
      source: 'takeout_subscriptions',
      found: 5,
      valid: 4,
      added: 3,
      unchanged: 1,
      initializationQueued: 3,
      fatalError: null
    });
    expect(outcome.invalid).toEqual([{ row: 6, reason: 'missing channel URL' }]);
  });
});
