const { createEclipseHttpApp } = require('../http-app.cjs');

const app = createEclipseHttpApp();

module.exports = async (request, response) => {
  try {
    await app.requestHandler(request, response);
  } catch (error) {
    console.error('Request error:', error);
    if (!response.headersSent) {
      response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    }
    response.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
