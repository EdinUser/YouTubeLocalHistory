const http = require('node:http');

function startStaticFixtureServer(routes) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const route = routes[url.pathname];

    if (!route) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(`Unknown fixture route: ${url.pathname}`);
      return;
    }

    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      // A static fixture must be incapable of loading the captured site's
      // resources. Extension assets remain permitted for injected UI checks.
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: chrome-extension: moz-extension:;",
    });
    response.end(route);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        close() {
          return new Promise((closeResolve, closeReject) => {
            server.close((error) => {
              if (error) {
                closeReject(error);
                return;
              }
              closeResolve();
            });
          });
        },
      });
    });
  });
}

module.exports = {
  startStaticFixtureServer,
};
