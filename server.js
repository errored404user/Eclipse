const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { getGameDetails, listGameServers, listGames } = require('./shared/roblox-api.cjs');

const root = path.join(__dirname, 'app');
const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml'
};
const csp = "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'";

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': csp
  });
  response.end(JSON.stringify(body));
}

http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');

  if (url.pathname === '/api/roblox/game-details') {
    if (request.method !== 'GET') {
      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }
    try {
      sendJson(response, 200, await getGameDetails(url.searchParams.get('universeId') ?? ''));
    } catch (error) {
      sendJson(response, 502, { error: 'Roblox game details are unavailable. Please try again.' });
    }
    return;
  }

  if (url.pathname === '/api/roblox/game-servers') {
    if (request.method !== 'GET') {
      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }
    try {
      sendJson(response, 200, await listGameServers(url.searchParams.get('placeId') ?? '', url.searchParams.get('cursor') ?? ''));
    } catch (error) {
      sendJson(response, 502, { error: 'Roblox servers are unavailable. Please try again.' });
    }
    return;
  }

  if (url.pathname === '/api/roblox/games') {
    if (request.method !== 'GET') {
      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }
    try {
      const result = await listGames({
        query: url.searchParams.get('query') ?? '',
        cursor: url.searchParams.get('cursor') ?? ''
      });
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 502, { error: 'Roblox discovery is unavailable. Please try again.' });
    }
    return;
  }

  const filename = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const resolved = path.resolve(root, filename);
  if (!resolved.startsWith(`${root}${path.sep}`) || !fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  response.writeHead(200, {
    'Content-Type': types[path.extname(resolved)] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': csp
  });
  fs.createReadStream(resolved).pipe(response);
}).listen(process.env.PORT || 4173, '0.0.0.0', () => {
  console.log(`Eclipse UI prototype available on port ${process.env.PORT || 4173}`);
});
