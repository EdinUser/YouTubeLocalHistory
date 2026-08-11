/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const displaySource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'popup-history-display.js'), 'utf8'
).slice(0, fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'popup-history-display.js'), 'utf8').indexOf('async function deleteRecord'));

test('shows and updates the Continue Watching pager when unfinished records span pages', () => {
  document.body.innerHTML = `
    <table><tbody id="ytvhtHistoryTable"></tbody></table>
    <div id="ytvhtNoHistory"></div><div id="ytvhtPagination"></div>
    <div id="ytvhtAnalyticsContainer" style="display:none"></div>`;
  const updatePaginationUI = jest.fn();
  const context = {
    document,
    allHistoryRecords: [{ videoId: 'page-two', title: 'Page two', time: 10, duration: 100, timestamp: 1 }],
    currentPage: 2,
    totalPages: 3,
    searchQuery: '',
    ytvhtFeedContracts: { WATCH_COMPLETION_RATIO: 0.9 },
    updatePaginationUI,
    adjustContentDensity: jest.fn(),
    getContextualEmptyState: jest.fn(), renderEmptyState: jest.fn(),
    addTimestampToUrl: (url) => url, formatProgress: () => '', formatDate: () => '', sanitizeText: (text) => text,
    updateAnalytics: jest.fn(),
    chrome: { i18n: { getMessage: () => 'Remove' } },
    console
  };
  vm.runInNewContext(displaySource, context);

  context.displayHistoryPage();

  expect(document.getElementById('ytvhtPagination').style.display).toBe('flex');
  expect(updatePaginationUI).toHaveBeenCalledWith(2, 3);
  expect(document.querySelectorAll('#ytvhtHistoryTable tr')).toHaveLength(1);
});
