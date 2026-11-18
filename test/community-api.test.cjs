const http = require('node:http');
const test = require('node:test');
const assert = require('node:assert/strict');
const { handleCommunityApi } = require('../community/api.cjs');
const { configuredCommunityUrl } = require('../electron/community-api.cjs');
const { CommunityError, cleanEmail, cleanPlaceId, cleanUsername, configuredEnvironment } = require('../community/service.cjs');

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  response.end(JSON.stringify(body));
}

async function withApiServer(run) {
  const calls = [];
  const service = {
    config: { publicUrl: 'http://localhost' },
    status: () => ({ enabled: true, identity: 'Eclipse email and password accounts', mediaUploads: false }),
    login: async ({ email }) => ({ user: { id: 'user-1', username: 'orbit.eclipse' }, emailVerified: true, expiresAt: '2030-01-01T00:00:00.000Z', sessionToken: email === 'person@example.com' ? 'opaque-session' : '' }),
    currentUser: async (token) => {
      calls.push(['me', token]);
      if (token !== 'opaque-session') throw new CommunityError('Sign in to Eclipse Community first.', 'AUTH_REQUIRED', 401);
      return { user: { id: 'user-1', username: 'orbit.eclipse' }, emailVerified: true };
    },
    lookupUser: async (token, username) => {
      calls.push(['lookup', token, username]);
      return { user: { id: 'user-2', username: 'nova.eclipse' } };
    },
    sendPlaceInvite: async (token, friend, placeId) => {
      calls.push(['place-invite', token, friend, placeId]);
      return { id: 'invite-1', placeId: String(placeId) };
    },
    logout: async () => ({ loggedOut: true })
  };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    handleCommunityApi({ request, response, url, service, sendJson }).catch((error) => {
      sendJson(response, 500, { error: error.message });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`, calls);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('Community configuration requires production identity, database, mail, and HTTPS settings', () => {
  const disabled = configuredEnvironment({});
  assert.equal(disabled.enabled, false);
  assert.deepEqual(disabled.missing, ['DATABASE_URL', 'COMMUNITY_SESSION_SECRET', 'COMMUNITY_SMTP_URL', 'COMMUNITY_EMAIL_FROM', 'COMMUNITY_PUBLIC_URL']);
  const enabled = configuredEnvironment({
    DATABASE_URL: 'postgresql://eclipse:secret@db.example/eclipsedb',
    COMMUNITY_SESSION_SECRET: 'x'.repeat(32),
    COMMUNITY_SMTP_URL: 'smtps://user:secret@smtp.example',
    COMMUNITY_EMAIL_FROM: 'Eclipse <community@example.com>',
    COMMUNITY_PUBLIC_URL: 'https://community.example'
  });
  assert.equal(enabled.enabled, true);
  assert.equal(cleanUsername('@orbit.eclipse'), 'orbit.eclipse');
  assert.throws(() => cleanUsername('no'), { code: 'INVALID_USERNAME' });
  assert.throws(() => cleanUsername('a bad name'), { code: 'INVALID_USERNAME' });
  assert.equal(cleanEmail('Person@Example.com'), 'person@example.com');
  assert.throws(() => cleanEmail('person@example.com,attacker.example'), { code: 'INVALID_EMAIL' });
  assert.equal(cleanPlaceId('1818'), 1818);
  assert.throws(() => cleanPlaceId('0'), { code: 'INVALID_PLACE_ID' });
  assert.throws(() => cleanPlaceId('https://roblox.com/games/1818'), { code: 'INVALID_PLACE_ID' });
  assert.equal(configuredCommunityUrl({ ECLIPSE_COMMUNITY_API_URL: 'https://community.example/' }), 'https://community.example');
  assert.equal(configuredCommunityUrl({ ECLIPSE_COMMUNITY_API_URL: 'http://community.example' }), '');
  assert.equal(configuredCommunityUrl({ ECLIPSE_COMMUNITY_API_URL: 'not a URL' }), '');
});

test('Community API keeps a browser session in an HttpOnly cookie and routes verified username lookup', async () => {
  await withApiServer(async (base, calls) => {
    const login = await fetch(`${base}/api/community/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'person@example.com', password: 'safe password string' })
    });
    assert.equal(login.status, 200);
    const loginBody = await login.json();
    assert.equal('sessionToken' in loginBody, false);
    const cookie = login.headers.get('set-cookie');
    assert.match(cookie, /^eclipse_community_session=opaque-session;/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);

    const me = await fetch(`${base}/api/community/auth/me`, { headers: { cookie: cookie.split(';')[0] } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.username, 'orbit.eclipse');

    const lookup = await fetch(`${base}/api/community/users/lookup?username=nova.eclipse`, { headers: { cookie: cookie.split(';')[0] } });
    assert.equal(lookup.status, 200);
    assert.equal((await lookup.json()).user.username, 'nova.eclipse');

    const invite = await fetch(`${base}/api/community/place-invites`, {
      method: 'POST',
      headers: { cookie: cookie.split(';')[0], 'content-type': 'application/json' },
      body: JSON.stringify({ friend: 'nova.eclipse', placeId: '1818' })
    });
    assert.equal(invite.status, 201);
    assert.equal((await invite.json()).placeId, '1818');
    assert.deepEqual(calls, [['me', 'opaque-session'], ['lookup', 'opaque-session', 'nova.eclipse'], ['place-invite', 'opaque-session', 'nova.eclipse', '1818']]);
  });
});

test('Community API rejects cross-origin state changes before calling the service', async () => {
  await withApiServer(async (base) => {
    const response = await fetch(`${base}/api/community/auth/logout`, {
      method: 'POST',
      headers: { origin: 'https://attacker.example', 'content-type': 'application/json' },
      body: '{}'
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'INVALID_ORIGIN');
  });
});
