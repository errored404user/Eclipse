const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, 'app');
const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml'
};

http.createServer((request, response) => {
  const requestPath = new URL(request.url, 'http://localhost').pathname;
  const filename = requestPath === '/' ? 'index.html' : requestPath.slice(1);
  const resolved = path.resolve(root, filename);

  if (!resolved.startsWith(`${root}${path.sep}`) || !fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  response.writeHead(200, {
    'Content-Type': types[path.extname(resolved)] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'"
  });
  fs.createReadStream(resolved).pipe(response);
}).listen(process.env.PORT || 4173, '0.0.0.0', () => {
  console.log(`Eclipse UI prototype available on port ${process.env.PORT || 4173}`);
});
