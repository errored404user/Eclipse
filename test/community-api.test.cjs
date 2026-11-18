const http = require('node:http');
const test = require('node:test');
const assert = require('node:assert/strict');
const { handleCommunityApi } = require('../community/api.cjs');
const { configuredCommunityUrl } = require('../electron/community-api.cjs');
const { CommunityError, cleanEmail, cleanPlaceId, cleanUsername, configuredEnvironment, databasePoolSize } = require('../community/service.cjs');

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
    listChats: async (token) => {
      calls.push(['chats', token]);
      return { chats: [{ id: 'user-2', username: 'nova.eclipse' }], incoming: [], outgoing: [] };
    },
    sendMessageRequest: async (token, username) => {
      calls.push(['message-request', token, username]);
      return { requestId: 'request-1', username, pending: true };
    },
    respondToMessageRequest: async (token, id, action) => {
      calls.push(['respond-message-request', token, id, action]);
      return { requestId: id, action, contactUsername: 'nova.eclipse' };
    },
    conversations: async (token, contact) => {
      calls.push(['conversation', token, contact]);
      return { contact: { id: 'user-2', username: contact }, messages: [], placeInvites: [] };
    },
    sendMessage: async (token, contact, body) => {
      calls.push(['send-message', token, contact, body]);
      return { id: 'message-1', body };
    },
    sendPlaceInvite: async (token, contact, placeId) => {
      calls.push(['place-invite', token, contact, placeId]);
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
  assert.equal(databasePoolSize({}), 2);
  assert.equal(databasePoolSize({ COMMUNITY_DATABASE_POOL_MAX: '1' }), 1);
  assert.equal(databasePoolSize({ COMMUNITY_DATABASE_POOL_MAX: '250' }), 2);
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

test('Community API keeps a browser session in an HttpOnly cookie and routes accepted username-chat operations', async () => {
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

    const request = await fetch(`${base}/api/community/message-requests`, {
      method: 'POST',
      headers: { cookie: cookie.split(';')[0], 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'nova.eclipse' })
    });
    assert.equal(request.status, 201);
    assert.equal((await request.json()).pending, true);

    const response = await fetch(`${base}/api/community/message-requests/request-1/accept`, {
      method: 'POST',
      headers: { cookie: cookie.split(';')[0], 'content-type': 'application/json' },
      body: '{}'
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).contactUsername, 'nova.eclipse');

    const chats = await fetch(`${base}/api/community/chats`, { headers: { cookie: cookie.split(';')[0] } });
    assert.equal(chats.status, 200);
    assert.equal((await chats.json()).chats[0].username, 'nova.eclipse');

    const conversation = await fetch(`${base}/api/community/conversations?contact=nova.eclipse`, { headers: { cookie: cookie.split(';')[0] } });
    assert.equal(conversation.status, 200);
    assert.equal((await conversation.json()).contact.username, 'nova.eclipse');

    const message = await fetch(`${base}/api/community/conversations`, {
      method: 'POST',
      headers: { cookie: cookie.split(';')[0], 'content-type': 'application/json' },
      body: JSON.stringify({ contact: 'nova.eclipse', body: 'Eclipse hello' })
    });
    assert.equal(message.status, 201);
    assert.equal((await message.json()).body, 'Eclipse hello');

    const invite = await fetch(`${base}/api/community/place-invites`, {
      method: 'POST',
      headers: { cookie: cookie.split(';')[0], 'content-type': 'application/json' },
      body: JSON.stringify({ contact: 'nova.eclipse', placeId: '1818' })
    });
    assert.equal(invite.status, 201);
    assert.equal((await invite.json()).placeId, '1818');

    const legacyFriends = await fetch(`${base}/api/community/friends`, { headers: { cookie: cookie.split(';')[0] } });
    assert.equal(legacyFriends.status, 404);
    assert.deepEqual(calls, [
      ['me', 'opaque-session'],
      ['lookup', 'opaque-session', 'nova.eclipse'],
      ['message-request', 'opaque-session', 'nova.eclipse'],
      ['respond-message-request', 'opaque-session', 'request-1', 'accept'],
      ['chats', 'opaque-session'],
      ['conversation', 'opaque-session', 'nova.eclipse'],
      ['send-message', 'opaque-session', 'nova.eclipse', 'Eclipse hello'],
      ['place-invite', 'opaque-session', 'nova.eclipse', '1818']
    ]);
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
