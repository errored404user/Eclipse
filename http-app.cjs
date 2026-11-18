const fs = require('node:fs');
const path = require('node:path');
const { listGames } = require('./shared/roblox-api.cjs');
const { createCommunityService } = require('./community/service.cjs');
const { handleCommunityApi } = require('./community/api.cjs');

const types = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
});

const csp = "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'";

function sendJson(response, status, body, extraHeaders = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...extraHeaders
  });
  response.end(JSON.stringify(body));
}

function staticHeaders(filename) {
  return {
    'Content-Type': types[path.extname(filename)] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  };
}

function createEclipseHttpApp({ env = process.env, staticRoot = path.join(process.cwd(), 'app'), logger = console } = {}) {
  const root = path.resolve(staticRoot);
  const community = createCommunityService(env, logger);
  let startup = null;

  async function startCommunity() {
    if (community.started) return community.status();
    if (!startup) {
      startup = community.start().finally(() => {
        startup = null;
      });
    }
    return startup;
  }

  async function requestHandler(request, response) {
    await startCommunity();
    const url = new URL(request.url, 'http://localhost');

    if (url.pathname.startsWith('/api/community')) {
      await handleCommunityApi({ request, response, url, service: community, sendJson });
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
      } catch {
        sendJson(response, 502, { error: 'Roblox discovery is unavailable. Please try again.' });
      }
      return;
    }

    if (!['GET', 'HEAD'].includes(request.method || 'GET')) {
      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }

    const filename = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const resolved = path.resolve(root, filename);
    if (!resolved.startsWith(`${root}${path.sep}`) || !fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    response.writeHead(200, staticHeaders(resolved));
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    fs.createReadStream(resolved).pipe(response);
  }

  return {
    community,
    close: () => community.close(),
    requestHandler,
    start: startCommunity
  };
}

module.exports = { createEclipseHttpApp, csp, sendJson };
