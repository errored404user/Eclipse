const { CommunityError } = require('./service.cjs');

const MAX_JSON_BYTES = 16 * 1024;

function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let raw = '';
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_JSON_BYTES) {
        reject(new CommunityError('Request body is too large.', 'PAYLOAD_TOO_LARGE', 413));
        request.destroy();
        return;
      }
      raw += chunk;
    });
    request.on('end', () => {
      if (!raw) return resolve({});
      try {
        const value = JSON.parse(raw);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
        resolve(value);
      } catch {
        reject(new CommunityError('Request body must be valid JSON.', 'INVALID_JSON'));
      }
    });
    request.on('error', reject);
  });
}

function parseCookies(request) {
  return Object.fromEntries(String(request.headers.cookie || '').split(';').flatMap((pair) => {
    const index = pair.indexOf('=');
    if (index < 1) return [];
    try {
      return [[pair.slice(0, index).trim(), decodeURIComponent(pair.slice(index + 1).trim())]];
    } catch {
      return [];
    }
  }));
}

function sessionToken(request) {
  const authorization = String(request.headers.authorization || '');
  if (authorization.startsWith('Bearer ')) return authorization.slice(7).trim();
  return parseCookies(request).eclipse_community_session || '';
}

function isDesktopRequest(request) {
  return request.headers['x-eclipse-desktop'] === '1';
}

function clientIp(request, service) {
  const forwarded = service.env?.COMMUNITY_TRUST_PROXY === 'true' ? request.headers['x-forwarded-for'] : '';
  return String(forwarded || request.socket.remoteAddress || '').split(',')[0].trim().slice(0, 128);
}

function assertSameOrigin(request, service) {
  if (!service.config?.publicUrl || isDesktopRequest(request) || String(request.headers.authorization || '').startsWith('Bearer ')) return;
  const origin = String(request.headers.origin || '');
  if (origin && origin !== new URL(service.config.publicUrl).origin) {
    throw new CommunityError('Cross-origin Community requests are not allowed.', 'INVALID_ORIGIN', 403);
  }
  if (String(request.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') {
    throw new CommunityError('Cross-site Community requests are not allowed.', 'INVALID_ORIGIN', 403);
  }
}

function sessionCookie(token, request, service) {
  const secure = new URL(service.config.publicUrl).protocol === 'https:';
  return `eclipse_community_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${secure ? '; Secure' : ''}`;
}

function clearSessionCookie(request, service) {
  const secure = new URL(service.config.publicUrl || 'http://localhost').protocol === 'https:';
  return `eclipse_community_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

function errorBody(error) {
  if (error instanceof CommunityError) return { status: error.status, body: { error: error.message, code: error.code } };
  return { status: 500, body: { error: 'Eclipse Community encountered an unexpected error.', code: 'INTERNAL_ERROR' } };
}

function verifyPage(message, status = 200) {
  const title = status === 200 ? 'Eclipse Community verified' : 'Eclipse Community verification failed';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="margin:0;display:grid;min-height:100vh;place-items:center;background:#0b0910;color:#f3efff;font:16px system-ui"><main style="max-width:430px;padding:32px;border:1px solid #4e4267;border-radius:16px;background:#1c1726"><h1>${title}</h1><p>${message}</p><p>You can return to Eclipse.</p></main></body></html>`;
}

async function handleCommunityApi({ request, response, url, service, sendJson }) {
  const base = '/api/community';
  const route = url.pathname.slice(base.length) || '/';
  const method = request.method || 'GET';
  try {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) assertSameOrigin(request, service);
    if (route === '/status' && method === 'GET') return sendJson(response, 200, service.status());

    if (route === '/auth/verify' && method === 'GET') {
      try {
        const result = await service.verifyEmail(url.searchParams.get('token'));
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'", 'X-Content-Type-Options': 'nosniff' });
        response.end(verifyPage(result.verified ? 'Your email is verified. Mutual friend requests and private chat are now available.' : 'Verification could not be completed.'));
      } catch (error) {
        const message = error instanceof CommunityError ? error.message : 'Verification could not be completed.';
        response.writeHead(error instanceof CommunityError ? error.status : 500, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'", 'X-Content-Type-Options': 'nosniff' });
        response.end(verifyPage(message, error instanceof CommunityError ? error.status : 500));
      }
      return;
    }

    if (route === '/auth/register' && method === 'POST') {
      const body = await readJson(request);
      const result = await service.register({ ...body, ip: clientIp(request, service) });
      return sendJson(response, 201, result);
    }

    if (route === '/auth/login' && method === 'POST') {
      const body = await readJson(request);
      const result = await service.login({ ...body, ip: clientIp(request, service) });
      const headers = isDesktopRequest(request) ? {} : { 'Set-Cookie': sessionCookie(result.sessionToken, request, service) };
      if (!isDesktopRequest(request)) delete result.sessionToken;
      return sendJson(response, 200, result, headers);
    }

    if (route === '/auth/logout' && method === 'POST') {
      const result = await service.logout(sessionToken(request));
      return sendJson(response, 200, result, { 'Set-Cookie': clearSessionCookie(request, service) });
    }

    if (route === '/auth/me' && method === 'GET') return sendJson(response, 200, await service.currentUser(sessionToken(request)));
    if (route === '/auth/resend-verification' && method === 'POST') return sendJson(response, 200, await service.resendVerification(sessionToken(request), clientIp(request, service)));
    if (route === '/friends' && method === 'GET') return sendJson(response, 200, await service.listFriends(sessionToken(request)));
    if (route === '/users/lookup' && method === 'GET') return sendJson(response, 200, await service.lookupUser(sessionToken(request), url.searchParams.get('username')));

    if (route === '/friend-requests' && method === 'POST') {
      const body = await readJson(request);
      return sendJson(response, 201, await service.sendFriendRequest(sessionToken(request), body.username));
    }

    const requestMatch = route.match(/^\/friend-requests\/([^/]+)\/(accept|decline)$/);
    if (requestMatch && method === 'POST') return sendJson(response, 200, await service.respondToFriendRequest(sessionToken(request), requestMatch[1], requestMatch[2]));

    if (route === '/messages' && method === 'GET') return sendJson(response, 200, await service.messages(sessionToken(request), url.searchParams.get('friend')));
    if (route === '/messages' && method === 'POST') {
      const body = await readJson(request);
      return sendJson(response, 201, await service.sendMessage(sessionToken(request), body.friend, body.body));
    }

    if (route === '/place-invites' && method === 'POST') {
      const body = await readJson(request);
      return sendJson(response, 201, await service.sendPlaceInvite(sessionToken(request), body.friend, body.placeId));
    }

    if (route === '/blocks' && method === 'POST') {
      const body = await readJson(request);
      return sendJson(response, 201, await service.blockUser(sessionToken(request), body.username));
    }

    if (route === '/reports' && method === 'POST') {
      const body = await readJson(request);
      return sendJson(response, 201, await service.reportUser(sessionToken(request), body));
    }

    return sendJson(response, 404, { error: 'Community endpoint not found.', code: 'NOT_FOUND' });
  } catch (error) {
    const { status, body } = errorBody(error);
    if (!(error instanceof CommunityError)) console.error('Eclipse Community API failed:', error);
    return sendJson(response, status, body);
  }
}

module.exports = { handleCommunityApi };
