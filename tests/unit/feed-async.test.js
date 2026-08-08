const { runPool } = require('../../src/feed-async.js');

describe('feed async helpers', () => {
  test('runs every item while respecting the requested concurrency', async () => {
    let active = 0;
    let maxActive = 0;
    const handled = [];

    await runPool([1, 2, 3, 4, 5], 2, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      handled.push(item);
      active -= 1;
    });

    expect(handled.sort()).toEqual([1, 2, 3, 4, 5]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  test('does not call the worker for an empty pool', async () => {
    const worker = jest.fn();
    await expect(runPool([], 4, worker)).resolves.toBeUndefined();
    expect(worker).not.toHaveBeenCalled();
  });
});
