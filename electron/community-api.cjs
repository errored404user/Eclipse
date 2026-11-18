const { URL } = require('node:url');

function configuredCommunityUrl(env = process.env) {
  const value = String(env.ECLIPSE_COMMUNITY_API_URL || '').trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return '';
    return url.href.replace(/\/$/, '');
  } catch {
    return '';
  }
}

function createCommunityApi(env = process.env) {
  const baseUrl = configuredCommunityUrl(env);
  let sessionToken = '';

  async function request(path, { method = 'GET', body } = {}) {
    if (!baseUrl) throw new Error('Set ECLIPSE_COMMUNITY_API_URL to the HTTPS Eclipse Community service URL in order to use online Community from the desktop app.');
    const response = await fetch(`${baseUrl}/api/community${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        'X-Eclipse-Desktop': '1',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Eclipse Community request failed.');
    if (payload.sessionToken) {
      sessionToken = payload.sessionToken;
      delete payload.sessionToken;
    }
    return payload;
  }

  return {
    status: () => baseUrl
      ? request('/status')
      : Promise.resolve({ enabled: false, reason: 'Set ECLIPSE_COMMUNITY_API_URL to an HTTPS Eclipse Community service URL to use online Community from the desktop app.' }),
    register: (details) => request('/auth/register', { method: 'POST', body: details }),
    login: (details) => request('/auth/login', { method: 'POST', body: details }),
    logout: async () => {
      try { return await request('/auth/logout', { method: 'POST' }); }
      finally { sessionToken = ''; }
    },
    me: () => request('/auth/me'),
    resendVerification: () => request('/auth/resend-verification', { method: 'POST' }),
    chats: () => request('/chats'),
    lookup: (username) => request(`/users/lookup?username=${encodeURIComponent(username)}`),
    requestChat: (username) => request('/message-requests', { method: 'POST', body: { username } }),
    respondToMessageRequest: (id, action) => request(`/message-requests/${encodeURIComponent(id)}/${encodeURIComponent(action)}`, { method: 'POST' }),
    conversation: (contact) => request(`/conversations?contact=${encodeURIComponent(contact)}`),
    sendMessage: (contact, body) => request('/conversations', { method: 'POST', body: { contact, body } }),
    sendPlaceInvite: (contact, placeId) => request('/place-invites', { method: 'POST', body: { contact, placeId } }),
    block: (username) => request('/blocks', { method: 'POST', body: { username } }),
    report: (details) => request('/reports', { method: 'POST', body: details })
  };
}

module.exports = { configuredCommunityUrl, createCommunityApi };
