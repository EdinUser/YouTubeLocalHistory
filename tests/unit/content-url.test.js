describe('content URL helpers', () => {
  const createHelpers = () => window.YTVHTContentUrls.create({
    log: jest.fn(),
    getStorage: () => ({ getVideo: jest.fn() }),
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  test('preserves the canonical Shorts route for the current Short', () => {
    window.history.replaceState({}, '', '/shorts/dQw4w9WgXcQ?feature=share');

    expect(createHelpers().getCleanVideoUrl())
      .toBe('https://www.youtube.com/shorts/dQw4w9WgXcQ');
  });
});
