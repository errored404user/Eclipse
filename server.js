const http = require('node:http');
const { createEclipseHttpApp } = require('./http-app.cjs');

const app = createEclipseHttpApp();
const port = Number(process.env.PORT || 4173);
const server = http.createServer((request, response) => {
  app.requestHandler(request, response).catch((error) => {
    console.error('Request error:', error);
    if (!response.headersSent) {
      response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    }
    response.end(JSON.stringify({ error: 'Internal server error' }));
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Eclipse Community server running on http://0.0.0.0:${port}`);
});

async function shutdown() {
  server.close();
  await app.close();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
