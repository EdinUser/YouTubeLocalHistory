/** @jest-environment jsdom */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PLAYLIST_ID = 'PLQga0f7orXVB8fZObVcpXuX-2swTybQqR';
const PLAYLIST_URL = `https://www.youtube.com/playlist?list=${PLAYLIST_ID}`;

function createHelpers() {
  document.body.innerHTML = `
    <div id="playlist-title">Controlled playlist</div>
    <ytd-playlist-video-renderer>
      <a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ" title="Fixture video">
        <span id="video-title">Fixture video</span>
      </a>
    </ytd-playlist-video-renderer>
  `;
  const contextWindow = {
    location: { search: `?list=${PLAYLIST_ID}`, pathname: '/playlist' },
  };
  const context = {
    document,
    window: contextWindow,
    location: contextWindow.location,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    Date,
    console,
  };
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'content-playlists.js'),
    'utf8'
  );
  vm.runInNewContext(source, context);

  return contextWindow.YTVHTContentPlaylists.create({
    log: jest.fn(),
    getStorage: jest.fn(),
    getPlaylistRetryTimeout: jest.fn(),
    setPlaylistRetryTimeout: jest.fn(),
  });
}

test('detected YouTube playlists are canonical reference records, not imported video collections', () => {
  const record = createHelpers().getPlaylistInfo();

  expect(record).toEqual(expect.objectContaining({
    playlistId: PLAYLIST_ID,
    title: 'Controlled playlist',
    url: PLAYLIST_URL,
    thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    timestamp: expect.any(Number),
  }));
  expect(record).not.toHaveProperty('localItems');
  expect(record).not.toHaveProperty('videoCount');
});
