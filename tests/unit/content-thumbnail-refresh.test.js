const fs = require('fs');
const path = require('path');

require('../../src/content-thumbnails');

const TARGET_VIDEO_ID = 'target12345';
const OTHER_VIDEO_ID = 'other123456';

function createHelpers(getVideo) {
  return window.YTVHTContentThumbnails.create({
    log: jest.fn(),
    getStorage: () => ({ getVideo }),
    getCurrentSettings: () => ({
      debug: false,
      overlayTitle: 'Viewed',
      overlayLabelSize: 'medium',
      accentColor: 'blue',
      showProgressBar: true
    }),
    updateOverlayCSS: jest.fn(),
    overlayColors: { blue: '#3ea6ff' },
    overlayLabelSizeMap: { medium: { fontSize: 12, bar: 4 } },
    getAccentOverlayColor: () => '#3ea6ff',
    pendingOperations: new Map()
  });
}

function card(videoId) {
  return `
    <ytd-rich-item-renderer>
      <ytd-thumbnail>
        <a id="thumbnail" href="/watch?v=${videoId}"><img id="img"></a>
      </ytd-thumbnail>
    </ytd-rich-item-renderer>`;
}

describe('targeted thumbnail refresh', () => {
  let originalRequestAnimationFrame;
  let originalCancelAnimationFrame;

  beforeEach(() => {
    document.body.innerHTML = `${card(TARGET_VIDEO_ID)}${card(OTHER_VIDEO_ID)}`;
    originalRequestAnimationFrame = global.requestAnimationFrame;
    originalCancelAnimationFrame = global.cancelAnimationFrame;
    global.requestAnimationFrame = (callback) => {
      callback();
      return 1;
    };
    global.cancelAnimationFrame = jest.fn();
  });

  afterEach(() => {
    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
    document.body.innerHTML = '';
  });

  test('refreshes only cards matching changed video IDs and deduplicates the input', async () => {
    const getVideo = jest.fn().mockResolvedValue(null);
    const helpers = createHelpers(getVideo);

    helpers.processThumbnailsForVideoIds([
      TARGET_VIDEO_ID,
      TARGET_VIDEO_ID,
      'invalid"selector'
    ]);
    await Promise.resolve();

    expect(getVideo).toHaveBeenCalledTimes(1);
    expect(getVideo).toHaveBeenCalledWith(TARGET_VIDEO_ID);
    expect(getVideo).not.toHaveBeenCalledWith(OTHER_VIDEO_ID);
  });

  test('guards overlay startup so overlapping initialization schedules one scan cycle', () => {
    const content = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'content.js'),
      'utf8'
    );

    expect(content).toContain('let nativeThumbnailOverlaysStarted = false');
    expect(content).toContain('if (nativeThumbnailOverlaysStarted) return');
    expect(content).toContain('nativeThumbnailOverlaysStarted = true');
    expect(content).toContain('processExistingThumbnails();\n        setTimeout(() => {\n            processExistingThumbnails();\n        }, 2000);');
  });

  test('focus refreshes rescan cards only when overlay presentation settings changed', () => {
    const content = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'content.js'),
      'utf8'
    );

    expect(content).toContain('function overlayPresentationChanged(previous, next)');
    expect(content).toContain("['overlayTitle', 'overlayLabelSize', 'overlayColor', 'accentColor']");
    expect(content).toContain('overlayPresentationChanged(previousSettings, settings)');
  });
});
