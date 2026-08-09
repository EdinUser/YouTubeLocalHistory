const {
  advanceToNextOrganicShort,
  describeShortState,
  isReadyOrganicShortState,
} = require('../e2e/shorts-canary-navigation');

const ORGANIC_SHORT = {
  videoId: 'organic-video',
  reelVideoId: 'organic-video',
  found: true,
  duration: 12,
  readyState: 4,
  title: 'Fixture Short',
  channelName: 'Fixture Channel',
  channelId: 'fixture-channel',
};

describe('Shorts canary navigation', () => {
  test('accepts only a ready reel with a consistent organic identity', () => {
    expect(isReadyOrganicShortState(ORGANIC_SHORT, {
      previousVideoId: 'previous-video',
    })).toBe(true);

    expect(isReadyOrganicShortState({
      ...ORGANIC_SHORT,
      videoId: 'interstitial-reel',
      reelVideoId: '',
      title: 'Поръчай сега',
      channelName: '',
      channelId: '',
    }, {
      previousVideoId: 'previous-video',
    })).toBe(false);
  });

  test('advances past a non-organic reel without inspecting localized wording', async () => {
    const advances = [];
    const sponsoredState = {
      ...ORGANIC_SHORT,
      videoId: 'interstitial-reel',
      reelVideoId: '',
      title: 'Поръчай сега',
      channelName: '',
      channelId: '',
    };
    let waitAttempt = 0;

    const result = await advanceToNextOrganicShort({
      previousVideoId: 'previous-video',
      maxAttempts: 3,
      advance: async (attempt) => advances.push(attempt),
      waitForOrganic: async () => {
        if (waitAttempt++ === 0) throw new Error('non-organic reel');
        return ORGANIC_SHORT;
      },
      readState: async () => sponsoredState,
    });

    expect(result).toEqual(ORGANIC_SHORT);
    expect(advances).toEqual([0, 1]);
  });

  test('reports structural state after bounded traversal is exhausted', async () => {
    const incompleteState = {
      videoId: 'interstitial-reel',
      reelVideoId: '',
      found: true,
      readyState: 4,
      duration: 15,
      title: '',
      channelName: '',
      channelId: '',
    };

    await expect(advanceToNextOrganicShort({
      previousVideoId: 'previous-video',
      maxAttempts: 2,
      advance: async () => {},
      waitForOrganic: async () => { throw new Error('not organic'); },
      readState: async () => incompleteState,
    })).rejects.toThrow(/hasChannelId.*false/);

    expect(describeShortState(incompleteState)).toContain('"hasChannelId":false');
  });
});
