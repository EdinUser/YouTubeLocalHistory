const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'popup-data-pages.js'), 'utf8');

test('paginates Continue Watching after filtering unfinished videos', async () => {
  const getVideosPage = jest.fn(async (options) => ({
    records: [{ videoId: 'on-page-two' }],
    pagination: { totalPages: 3, totalRecords: 25 }
  }));
  const context = {
    currentPage: 2, pageSize: 10, searchQuery: '',
    currentShortsPage: 1, shortsPageSize: 10, currentPlaylistPage: 1, playlistPageSize: 10,
    allHistoryRecords: [], allShortsRecords: [], allPlaylists: [], totalPages: 1,
    totalHistoryRecords: 0, totalShortsPages: 1, totalShortsRecords: 0,
    totalPlaylistPages: 1, totalPlaylistRecords: 0,
    ytStorage: { getVideosPage, getShortsPage: jest.fn(), getPlaylistsPage: jest.fn() },
    log: jest.fn(), console
  };
  vm.runInNewContext(source, context);

  await context.loadHistoryPage();

  expect(getVideosPage).toHaveBeenCalledWith(expect.objectContaining({
    page: 2, pageSize: 10, unfinishedOnly: true
  }));
  expect(context.totalPages).toBe(3);
  expect(context.allHistoryRecords).toEqual([{ videoId: 'on-page-two' }]);
});
