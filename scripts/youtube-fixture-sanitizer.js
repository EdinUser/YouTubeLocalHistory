async function sanitizeYouTubeFixturePage(page) {
  await page.evaluate(() => {
    document.head.replaceChildren();
    const removableSelectors = [
      'script', 'iframe', 'noscript', 'template', 'style', 'link', 'svg', 'canvas',
      'source', 'ytd-guide-renderer', 'tp-yt-app-drawer', 'ytd-masthead',
      'ytd-popup-container', 'yt-confirm-dialog-renderer',
      'iron-iconset-svg',
      '[class*="consent" i]', '[id*="consent" i]',
    ];
    document.querySelectorAll(removableSelectors.join(', ')).forEach((node) => node.remove());
    document.createTreeWalker(document, NodeFilter.SHOW_COMMENT).nextNode();
    const commentWalker = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
    const comments = [];
    while (commentWalker.nextNode()) comments.push(commentWalker.currentNode);
    comments.forEach((comment) => comment.remove());

    document.querySelectorAll('*').forEach((element) => {
      [...element.attributes].forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        if (
          name.startsWith('on')
          || ['src', 'srcset', 'poster', 'ping', 'action', 'style'].includes(name)
          || (name.startsWith('data-') && name !== 'data-ytlh-fixture')
        ) {
          element.removeAttribute(attribute.name);
        }
      });
    });

    document.querySelectorAll('a[href]').forEach((anchor) => {
      try {
        const url = new URL(anchor.getAttribute('href'), 'https://www.youtube.com');
        if (!/(^|\.)youtube\.com$/u.test(url.hostname)) {
          anchor.removeAttribute('href');
          return;
        }
        if (url.pathname === '/watch') {
          const videoId = url.searchParams.get('v');
          if (!videoId) {
            anchor.removeAttribute('href');
            return;
          }
          const playlistId = url.searchParams.get('list');
          anchor.setAttribute('href', `/watch?v=${encodeURIComponent(videoId)}${playlistId ? `&list=${encodeURIComponent(playlistId)}` : ''}`);
          return;
        }
        if (url.pathname === '/playlist') {
          const playlistId = url.searchParams.get('list');
          if (!playlistId) {
            anchor.removeAttribute('href');
            return;
          }
          anchor.setAttribute('href', `/playlist?list=${encodeURIComponent(playlistId)}`);
          return;
        }
        if (/^\/(?:@[^/]+|channel\/[^/]+)$/u.test(url.pathname)) {
          anchor.setAttribute('href', url.pathname);
          return;
        }
        anchor.removeAttribute('href');
      } catch {
        anchor.removeAttribute('href');
      }
    });
  });
}

module.exports = { sanitizeYouTubeFixturePage };
