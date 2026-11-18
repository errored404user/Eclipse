const crypto = require('node:crypto');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');

const SESSION_DAYS = 30;
const VERIFICATION_HOURS = 24;
const MESSAGE_LIMIT = 1500;
const PLACE_ID_LIMIT = 999_999_999_999_999;
const USERNAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}$/;
const EMAIL_PATTERN = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

const schema = `
  CREATE TABLE IF NOT EXISTS eclipse_community_users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    username_key TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ
  );
  CREATE TABLE IF NOT EXISTS eclipse_community_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES eclipse_community_users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS eclipse_community_sessions_user_idx ON eclipse_community_sessions(user_id);
  CREATE TABLE IF NOT EXISTS eclipse_community_email_verifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES eclipse_community_users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS eclipse_community_friend_requests (
    id TEXT PRIMARY KEY,
    requester_id TEXT NOT NULL REFERENCES eclipse_community_users(id) ON DELETE CASCADE,
    recipient_id TEXT NOT NULL REFERENCES eclipse_community_users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'blocked')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    responded_at TIMESTAMPTZ,
    CHECK (requester_id <> recipient_id)
  );
  CREATE INDEX IF NOT EXISTS eclipse_community_friend_requests_pair_idx ON eclipse_community_friend_requests(requester_id, recipient_id, status);
  CREATE UNIQUE INDEX IF NOT EXISTS eclipse_community_friend_requests_active_pair_idx
    ON eclipse_community_friend_requests (LEAST(requester_id, recipient_id), GREATEST(requester_id, recipient_id))
    WHERE status IN ('pending', 'accepted');
  CREATE INDEX IF NOT EXISTS eclipse_community_friend_requests_recipient_idx ON eclipse_community_friend_requests(recipient_id, status);
  CREATE TABLE IF NOT EXISTS eclipse_community_blocks (
    blocker_id TEXT NOT NULL REFERENCES eclipse_community_users(id) ON DELETE CASCADE,
    blocked_id TEXT NOT NULL REFERENCES eclipse_community_users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id <> blocked_id)
  );
  CREATE TABLE IF NOT EXISTS eclipse_community_messages (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL REFERENCES eclipse_community_users(id) ON DELETE CASCADE,
    recipient_id TEXT NOT NULL REFERENCES eclipse_community_users(id) ON DELETE CASCADE,
    body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND ${MESSAGE_LIMIT}),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (sender_id <> recipient_id)
  );
  CREATE INDEX IF NOT EXISTS eclipse_community_messages_pair_idx ON eclipse_community_messages(sender_id, recipient_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS eclipse_community_place_invites (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL REFERENCES eclipse_community_users(id) ON DELETE CASCADE,
    recipient_id TEXT NOT NULL REFERENCES eclipse_community_users(id) ON DELETE CASCADE,
    place_id BIGINT NOT NULL CHECK (place_id > 0 AND place_id <= ${PLACE_ID_LIMIT}),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (sender_id <> recipient_id)
  );
  CREATE INDEX IF NOT EXISTS eclipse_community_place_invites_pair_idx ON eclipse_community_place_invites(sender_id, recipient_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS eclipse_community_moderation_events (
    id TEXT PRIMARY KEY,
    actor_id TEXT REFERENCES eclipse_community_users(id) ON DELETE SET NULL,
    subject_id TEXT REFERENCES eclipse_community_users(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    reason TEXT,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS eclipse_community_moderation_events_subject_idx ON eclipse_community_moderation_events(subject_id, created_at DESC);
`;

class CommunityError extends Error {
  constructor(message, code = 'COMMUNITY_ERROR', status = 400) {
    super(message);
    this.name = 'CommunityError';
    this.code = code;
    this.status = status;
  }
}

function cleanUsername(value) {
  const username = String(value || '').trim().replace(/^@+/, '').slice(0, 32);
  if (!USERNAME_PATTERN.test(username)) throw new CommunityError('Use a 3–32 character Eclipse username with letters, numbers, dots, underscores, or dashes.', 'INVALID_USERNAME');
  return username;
}

function cleanEmail(value) {
  const email = String(value || '').trim().toLowerCase().slice(0, 254);
  if (!EMAIL_PATTERN.test(email)) throw new CommunityError('Enter a valid email address.', 'INVALID_EMAIL');
  return email;
}

function cleanPassword(value) {
  const password = String(value || '');
  if (password.length < 12 || password.length > 256) throw new CommunityError('Use a password between 12 and 256 characters.', 'INVALID_PASSWORD');
  return password;
}

function cleanMessage(value) {
  const body = String(value || '').trim();
  if (!body || body.length > MESSAGE_LIMIT) throw new CommunityError(`Messages must be between 1 and ${MESSAGE_LIMIT} characters.`, 'INVALID_MESSAGE');
  return body;
}

function cleanPlaceId(value) {
  const placeId = String(value || '').trim();
  if (!/^\d{1,15}$/.test(placeId)) throw new CommunityError('Enter a valid official Roblox place ID.', 'INVALID_PLACE_ID');
  const numericPlaceId = Number(placeId);
  if (!Number.isSafeInteger(numericPlaceId) || numericPlaceId < 1 || numericPlaceId > PLACE_ID_LIMIT) {
    throw new CommunityError('Enter a valid official Roblox place ID.', 'INVALID_PLACE_ID');
  }
  return numericPlaceId;
}

function cleanReportReason(value) {
  const reason = String(value || '').trim().slice(0, 120);
  if (!reason) throw new CommunityError('Select a report reason.', 'INVALID_REPORT');
  return reason;
}

function toPublicUser(row) {
  return { id: row.id, username: row.username, createdAt: row.created_at };
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : String(value || '');
}

function secretHash(secret, value) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('base64url')) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve({ salt, hash: derivedKey.toString('base64') });
    });
  });
}

async function verifyPassword(password, salt, expectedHash) {
  const { hash } = await hashPassword(password, salt);
  const expected = Buffer.from(expectedHash, 'base64');
  const actual = Buffer.from(hash, 'base64');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function addDuration(daysOrHours, unit) {
  const date = new Date();
  if (unit === 'hours') date.setHours(date.getHours() + daysOrHours);
  else date.setDate(date.getDate() + daysOrHours);
  return date;
}

function configuredEnvironment(env) {
  const required = ['DATABASE_URL', 'COMMUNITY_SESSION_SECRET', 'COMMUNITY_SMTP_URL', 'COMMUNITY_EMAIL_FROM', 'COMMUNITY_PUBLIC_URL'];
  const missing = required.filter((key) => !String(env[key] || '').trim());
  const publicUrl = String(env.COMMUNITY_PUBLIC_URL || '').trim();
  if (!missing.length) {
    try {
      const url = new URL(publicUrl);
      if (url.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && url.hostname === 'localhost')) missing.push('a secure COMMUNITY_PUBLIC_URL');
    } catch {
      missing.push('a valid COMMUNITY_PUBLIC_URL');
    }
  }
  if (String(env.COMMUNITY_SESSION_SECRET || '').length > 0 && String(env.COMMUNITY_SESSION_SECRET).length < 32) missing.push('a COMMUNITY_SESSION_SECRET of at least 32 characters');
  return { enabled: missing.length === 0, missing, publicUrl };
}

class CommunityService {
  constructor(env = process.env, logger = console) {
    this.env = env;
    this.logger = logger;
    this.config = configuredEnvironment(env);
    this.pool = null;
    this.transporter = null;
    this.started = false;
    this.startError = '';
    this.rateBuckets = new Map();
  }

  async start() {
    if (!this.config.enabled || this.started) return this.status();
    try {
      this.pool = new Pool({ connectionString: this.env.DATABASE_URL, ssl: this.env.COMMUNITY_DATABASE_SSL === 'false' ? false : { rejectUnauthorized: true } });
      this.transporter = nodemailer.createTransport(this.env.COMMUNITY_SMTP_URL);
      await this.pool.query(schema);
      await this.pool.query('DELETE FROM eclipse_community_sessions WHERE expires_at <= NOW()');
      await this.pool.query('DELETE FROM eclipse_community_email_verifications WHERE expires_at <= NOW()');
      await this.transporter.verify();
      this.started = true;
      this.startError = '';
    } catch (error) {
      this.startError = 'The Community service could not connect to its required infrastructure.';
      this.logger.error?.('Eclipse Community startup failed:', error);
      await this.pool?.end().catch(() => {});
      this.pool = null;
      this.transporter = null;
    }
    return this.status();
  }

  async close() {
    await this.pool?.end();
    this.pool = null;
    this.started = false;
  }

  status() {
    const reason = this.started ? '' : this.startError || (this.config.enabled ? 'Starting Community service…' : `Set ${this.config.missing.join(', ')} to enable Eclipse Community.`);
    return {
      enabled: this.started,
      reason,
      identity: 'Eclipse email and password accounts',
      messageRequests: 'Username message requests with recipient acceptance',
      privateMessages: this.started,
      officialPlaceInvites: this.started,
      mediaUploads: false,
      uploadLimitBytes: 0,
      messageLimit: MESSAGE_LIMIT,
      moderation: ['block', 'report', 'audit-records']
    };
  }

  ensureEnabled() {
    if (!this.started || !this.pool) throw new CommunityError(this.status().reason || 'Community is unavailable.', 'COMMUNITY_UNAVAILABLE', 503);
  }

  limit(key, limit, windowMs) {
    const now = Date.now();
    if (this.rateBuckets.size > 10_000) {
      for (const [bucketKey, value] of this.rateBuckets) {
        if (value.resetAt <= now) this.rateBuckets.delete(bucketKey);
      }
      if (this.rateBuckets.size > 10_000) this.rateBuckets.clear();
    }
    const bucket = this.rateBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    bucket.count += 1;
    if (bucket.count > limit) throw new CommunityError('Too many requests. Please wait and try again.', 'RATE_LIMITED', 429);
  }

  async register({ email, username, password, ip = '' }) {
    this.ensureEnabled();
    this.limit(`register:${ip || email}`, 5, 60 * 60 * 1000);
    const safeEmail = cleanEmail(email);
    const safeUsername = cleanUsername(username);
    const safePassword = cleanPassword(password);
    const { salt, hash } = await hashPassword(safePassword);
    const id = crypto.randomUUID();
    try {
      await this.pool.query(
        'INSERT INTO eclipse_community_users (id, username, username_key, email, password_hash, password_salt) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, safeUsername, safeUsername.toLowerCase(), safeEmail, hash, salt]
      );
    } catch (error) {
      if (error?.code === '23505') throw new CommunityError('That Eclipse username or email is already in use.', 'IDENTITY_TAKEN', 409);
      throw error;
    }
    await this.createAndSendVerification(id, safeEmail, ip);
    return { pendingVerification: true, username: safeUsername, message: 'Check your email to verify this Eclipse account before sending a message request or chatting.' };
  }

  async createAndSendVerification(userId, email, ip = '') {
    this.ensureEnabled();
    this.limit(`verification:${ip || userId}`, 4, 60 * 60 * 1000);
    const token = randomToken();
    const id = crypto.randomUUID();
    const tokenHash = secretHash(this.env.COMMUNITY_SESSION_SECRET, token);
    await this.pool.query('DELETE FROM eclipse_community_email_verifications WHERE user_id = $1', [userId]);
    await this.pool.query(
      'INSERT INTO eclipse_community_email_verifications (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
      [id, userId, tokenHash, addDuration(VERIFICATION_HOURS, 'hours')]
    );
    const verifyUrl = new URL('/api/community/auth/verify', this.config.publicUrl);
    verifyUrl.searchParams.set('token', token);
    try {
      await this.transporter.sendMail({
        from: this.env.COMMUNITY_EMAIL_FROM,
        to: email,
        subject: 'Verify your Eclipse Community account',
        text: `Verify your Eclipse Community account within ${VERIFICATION_HOURS} hours: ${verifyUrl.href}`,
        html: `<p>Verify your Eclipse Community account within ${VERIFICATION_HOURS} hours.</p><p><a href="${verifyUrl.href}">Verify Eclipse account</a></p>`
      });
    } catch (error) {
      this.logger.error?.('Eclipse Community email delivery failed:', error);
      throw new CommunityError('Verification email delivery is unavailable. Please try again later.', 'EMAIL_UNAVAILABLE', 503);
    }
  }

  async verifyEmail(token) {
    this.ensureEnabled();
    const tokenHash = secretHash(this.env.COMMUNITY_SESSION_SECRET, String(token || ''));
    const result = await this.pool.query(
      `DELETE FROM eclipse_community_email_verifications
       WHERE token_hash = $1 AND expires_at > NOW()
       RETURNING user_id`,
      [tokenHash]
    );
    if (!result.rowCount) throw new CommunityError('This verification link is invalid or expired.', 'INVALID_VERIFICATION', 400);
    const userId = result.rows[0].user_id;
    await this.pool.query('UPDATE eclipse_community_users SET email_verified = TRUE WHERE id = $1', [userId]);
    await this.audit(null, userId, 'email_verified', 'account', userId, '', {});
    return { verified: true };
  }

  async login({ email, password, ip = '' }) {
    this.ensureEnabled();
    this.limit(`login:${ip || email}`, 10, 15 * 60 * 1000);
    const safeEmail = cleanEmail(email);
    const safePassword = String(password || '');
    const result = await this.pool.query('SELECT * FROM eclipse_community_users WHERE email = $1', [safeEmail]);
    const user = result.rows[0];
    if (!user || !(await verifyPassword(safePassword, user.password_salt, user.password_hash))) {
      throw new CommunityError('Email or password is incorrect.', 'INVALID_LOGIN', 401);
    }
    const session = await this.createSession(user.id);
    await this.pool.query('UPDATE eclipse_community_users SET last_seen_at = NOW() WHERE id = $1', [user.id]);
    return { user: toPublicUser(user), emailVerified: user.email_verified, sessionToken: session.token, expiresAt: session.expiresAt };
  }

  async createSession(userId) {
    const token = randomToken();
    const expiresAt = addDuration(SESSION_DAYS, 'days');
    await this.pool.query(
      'INSERT INTO eclipse_community_sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
      [crypto.randomUUID(), userId, secretHash(this.env.COMMUNITY_SESSION_SECRET, token), expiresAt]
    );
    return { token, expiresAt: expiresAt.toISOString() };
  }

  async userForToken(token) {
    this.ensureEnabled();
    if (!token) throw new CommunityError('Sign in to Eclipse Community first.', 'AUTH_REQUIRED', 401);
    const result = await this.pool.query(
      `SELECT u.* FROM eclipse_community_sessions s
       JOIN eclipse_community_users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
      [secretHash(this.env.COMMUNITY_SESSION_SECRET, token)]
    );
    if (!result.rowCount) throw new CommunityError('Your Eclipse Community session has expired. Sign in again.', 'AUTH_REQUIRED', 401);
    return result.rows[0];
  }

  async currentUser(token) {
    const user = await this.userForToken(token);
    return { user: toPublicUser(user), emailVerified: user.email_verified };
  }

  async logout(token) {
    this.ensureEnabled();
    if (token) await this.pool.query('DELETE FROM eclipse_community_sessions WHERE token_hash = $1', [secretHash(this.env.COMMUNITY_SESSION_SECRET, token)]);
    return { loggedOut: true };
  }

  async resendVerification(token, ip = '') {
    const user = await this.userForToken(token);
    if (user.email_verified) return { emailVerified: true };
    await this.createAndSendVerification(user.id, user.email, ip);
    return { pendingVerification: true };
  }

  async assertVerified(token) {
    const user = await this.userForToken(token);
    if (!user.email_verified) throw new CommunityError('Verify your Eclipse account email before sending message requests or using private chat.', 'EMAIL_UNVERIFIED', 403);
    return user;
  }

  async findUserByUsername(username) {
    const safeUsername = cleanUsername(username);
    const result = await this.pool.query('SELECT * FROM eclipse_community_users WHERE username_key = $1', [safeUsername.toLowerCase()]);
    if (!result.rowCount) throw new CommunityError('No Eclipse Community user was found with that username.', 'USER_NOT_FOUND', 404);
    return result.rows[0];
  }

  async lookupUser(token, username) {
    const user = await this.assertVerified(token);
    this.limit(`lookup:${user.id}`, 30, 60 * 1000);
    const found = await this.findUserByUsername(username);
    if (found.id === user.id) throw new CommunityError('That is your Eclipse Community account.', 'SELF_LOOKUP');
    if (!found.email_verified) throw new CommunityError('No verified Eclipse Community user was found with that username.', 'USER_NOT_FOUND', 404);
    return { user: toPublicUser(found) };
  }

  async isBlocked(firstId, secondId) {
    const result = await this.pool.query(
      'SELECT 1 FROM eclipse_community_blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1) LIMIT 1',
      [firstId, secondId]
    );
    return Boolean(result.rowCount);
  }

  async hasAcceptedChat(firstId, secondId) {
    const result = await this.pool.query(
      `SELECT 1 FROM eclipse_community_friend_requests
       WHERE status = 'accepted' AND ((requester_id = $1 AND recipient_id = $2) OR (requester_id = $2 AND recipient_id = $1))
       LIMIT 1`,
      [firstId, secondId]
    );
    return Boolean(result.rowCount);
  }

  async listChats(token) {
    const user = await this.assertVerified(token);
    const [chats, incoming, outgoing] = await Promise.all([
      this.pool.query(
        `SELECT u.id, u.username, u.created_at, r.id AS chat_id, COALESCE(r.responded_at, r.created_at) AS accepted_at
         FROM eclipse_community_friend_requests r
         JOIN eclipse_community_users u ON u.id = CASE WHEN r.requester_id = $1 THEN r.recipient_id ELSE r.requester_id END
         WHERE r.status = 'accepted' AND (r.requester_id = $1 OR r.recipient_id = $1)
         ORDER BY u.username_key`,
        [user.id]
      ),
      this.pool.query(
        `SELECT r.id, r.created_at, u.id AS user_id, u.username
         FROM eclipse_community_friend_requests r JOIN eclipse_community_users u ON u.id = r.requester_id
         WHERE r.recipient_id = $1 AND r.status = 'pending' ORDER BY r.created_at DESC`,
        [user.id]
      ),
      this.pool.query(
        `SELECT r.id, r.created_at, u.id AS user_id, u.username
         FROM eclipse_community_friend_requests r JOIN eclipse_community_users u ON u.id = r.recipient_id
         WHERE r.requester_id = $1 AND r.status = 'pending' ORDER BY r.created_at DESC`,
        [user.id]
      )
    ]);
    return {
      chats: chats.rows.map((row) => ({ id: row.id, username: row.username, acceptedAt: toIso(row.accepted_at) })),
      incoming: incoming.rows.map((row) => ({ id: row.id, username: row.username, createdAt: toIso(row.created_at) })),
      outgoing: outgoing.rows.map((row) => ({ id: row.id, username: row.username, createdAt: toIso(row.created_at) }))
    };
  }

  async sendMessageRequest(token, username) {
    const sender = await this.assertVerified(token);
    const recipient = await this.findUserByUsername(username);
    if (sender.id === recipient.id) throw new CommunityError('You cannot send a message request to your own Eclipse account.', 'SELF_MESSAGE_REQUEST');
    if (await this.isBlocked(sender.id, recipient.id)) throw new CommunityError('This message request cannot be sent.', 'MESSAGE_REQUEST_BLOCKED', 403);
    const existing = await this.pool.query(
      `SELECT id, status FROM eclipse_community_friend_requests
       WHERE (requester_id = $1 AND recipient_id = $2) OR (requester_id = $2 AND recipient_id = $1)
       ORDER BY created_at DESC LIMIT 1`,
      [sender.id, recipient.id]
    );
    if (existing.rowCount && ['pending', 'accepted'].includes(existing.rows[0].status)) {
      throw new CommunityError(existing.rows[0].status === 'accepted' ? 'A private chat with that Eclipse username is already open.' : 'A message request is already waiting for a response.', 'MESSAGE_REQUEST_EXISTS', 409);
    }
    const id = crypto.randomUUID();
    try {
      await this.pool.query(
        `INSERT INTO eclipse_community_friend_requests (id, requester_id, recipient_id, status)
         VALUES ($1, $2, $3, 'pending')`,
        [id, sender.id, recipient.id]
      );
    } catch (error) {
      if (error?.code === '23505') throw new CommunityError('A message request is already waiting for a response.', 'MESSAGE_REQUEST_EXISTS', 409);
      throw error;
    }
    await this.audit(sender.id, recipient.id, 'message_request_created', 'message_request', id, '', {});
    return { requestId: id, username: recipient.username, pending: true };
  }

  async respondToMessageRequest(token, requestId, action) {
    const recipient = await this.assertVerified(token);
    if (!['accept', 'decline'].includes(action)) throw new CommunityError('Unsupported message-request action.', 'INVALID_ACTION');
    const result = await this.pool.query(
      `UPDATE eclipse_community_friend_requests
       SET status = $1, responded_at = NOW()
       WHERE id = $2 AND recipient_id = $3 AND status = 'pending'
       RETURNING requester_id`,
      [action === 'accept' ? 'accepted' : 'declined', String(requestId || ''), recipient.id]
    );
    if (!result.rowCount) throw new CommunityError('That pending message request could not be found.', 'REQUEST_NOT_FOUND', 404);
    const requesterId = result.rows[0].requester_id;
    const requester = await this.pool.query('SELECT username FROM eclipse_community_users WHERE id = $1', [requesterId]);
    await this.audit(recipient.id, requesterId, action === 'accept' ? 'message_request_accepted' : 'message_request_declined', 'message_request', String(requestId), '', {});
    return { action, requestId: String(requestId), contactUsername: requester.rows[0]?.username || '' };
  }

  async conversations(token, username) {
    const user = await this.assertVerified(token);
    const contact = await this.findUserByUsername(username);
    if (!(await this.hasAcceptedChat(user.id, contact.id)) || await this.isBlocked(user.id, contact.id)) {
      throw new CommunityError('Private chat opens only after the recipient accepts your message request.', 'CHAT_NOT_ACCEPTED', 403);
    }
    const [messages, placeInvites] = await Promise.all([
      this.pool.query(
        `SELECT m.id, m.body, m.created_at, m.sender_id, u.username AS sender_username
         FROM eclipse_community_messages m JOIN eclipse_community_users u ON u.id = m.sender_id
         WHERE (m.sender_id = $1 AND m.recipient_id = $2) OR (m.sender_id = $2 AND m.recipient_id = $1)
         ORDER BY m.created_at DESC LIMIT 100`,
        [user.id, contact.id]
      ),
      this.pool.query(
        `SELECT i.id, i.place_id, i.created_at, i.sender_id, u.username AS sender_username
         FROM eclipse_community_place_invites i JOIN eclipse_community_users u ON u.id = i.sender_id
         WHERE (i.sender_id = $1 AND i.recipient_id = $2) OR (i.sender_id = $2 AND i.recipient_id = $1)
         ORDER BY i.created_at DESC LIMIT 100`,
        [user.id, contact.id]
      )
    ]);
    return {
      contact: toPublicUser(contact),
      messages: messages.rows.reverse().map((row) => ({ id: row.id, body: row.body, createdAt: toIso(row.created_at), senderId: row.sender_id, senderUsername: row.sender_username })),
      placeInvites: placeInvites.rows.reverse().map((row) => ({ id: row.id, placeId: String(row.place_id), createdAt: toIso(row.created_at), senderId: row.sender_id, senderUsername: row.sender_username }))
    };
  }

  async sendMessage(token, username, body) {
    const sender = await this.assertVerified(token);
    this.limit(`message:${sender.id}`, 40, 60 * 1000);
    const recipient = await this.findUserByUsername(username);
    if (!(await this.hasAcceptedChat(sender.id, recipient.id)) || await this.isBlocked(sender.id, recipient.id)) {
      throw new CommunityError('Private chat opens only after the recipient accepts your message request.', 'CHAT_NOT_ACCEPTED', 403);
    }
    const id = crypto.randomUUID();
    const safeBody = cleanMessage(body);
    const result = await this.pool.query(
      `INSERT INTO eclipse_community_messages (id, sender_id, recipient_id, body)
       VALUES ($1, $2, $3, $4) RETURNING created_at`,
      [id, sender.id, recipient.id, safeBody]
    );
    return { id, body: safeBody, createdAt: toIso(result.rows[0].created_at), senderId: sender.id, senderUsername: sender.username };
  }

  async sendPlaceInvite(token, username, placeId) {
    const sender = await this.assertVerified(token);
    this.limit(`place-invite:${sender.id}`, 20, 60 * 1000);
    const recipient = await this.findUserByUsername(username);
    if (!(await this.hasAcceptedChat(sender.id, recipient.id)) || await this.isBlocked(sender.id, recipient.id)) {
      throw new CommunityError('Official Roblox place invites are available only in accepted private chats.', 'CHAT_NOT_ACCEPTED', 403);
    }
    const safePlaceId = cleanPlaceId(placeId);
    const id = crypto.randomUUID();
    const result = await this.pool.query(
      `INSERT INTO eclipse_community_place_invites (id, sender_id, recipient_id, place_id)
       VALUES ($1, $2, $3, $4) RETURNING created_at`,
      [id, sender.id, recipient.id, safePlaceId]
    );
    await this.audit(sender.id, recipient.id, 'place_invite_created', 'place_invite', id, '', { placeId: safePlaceId });
    return { id, placeId: String(safePlaceId), createdAt: toIso(result.rows[0].created_at), senderId: sender.id, senderUsername: sender.username };
  }

  async blockUser(token, username) {
    const blocker = await this.assertVerified(token);
    const blocked = await this.findUserByUsername(username);
    if (blocker.id === blocked.id) throw new CommunityError('You cannot block your own Eclipse account.', 'SELF_BLOCK');
    await this.pool.query('INSERT INTO eclipse_community_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [blocker.id, blocked.id]);
    await this.pool.query(
      `UPDATE eclipse_community_friend_requests SET status = 'blocked', responded_at = NOW()
       WHERE ((requester_id = $1 AND recipient_id = $2) OR (requester_id = $2 AND recipient_id = $1)) AND status IN ('pending', 'accepted')`,
      [blocker.id, blocked.id]
    );
    await this.audit(blocker.id, blocked.id, 'block', 'user', blocked.id, '', {});
    return { blocked: true, username: blocked.username };
  }

  async reportUser(token, { username, messageId, reason, details }) {
    const reporter = await this.assertVerified(token);
    const subject = await this.findUserByUsername(username);
    const safeReason = cleanReportReason(reason);
    const safeDetails = String(details || '').trim().slice(0, 1000);
    const eventId = crypto.randomUUID();
    await this.pool.query(
      `INSERT INTO eclipse_community_moderation_events (id, actor_id, subject_id, event_type, entity_type, entity_id, reason, details)
       VALUES ($1, $2, $3, 'report', $4, $5, $6, $7::jsonb)`,
      [eventId, reporter.id, subject.id, messageId ? 'message' : 'user', messageId ? String(messageId).slice(0, 80) : null, safeReason, JSON.stringify({ note: safeDetails })]
    );
    return { reported: true, eventId };
  }

  async audit(actorId, subjectId, eventType, entityType, entityId, reason, details) {
    await this.pool.query(
      `INSERT INTO eclipse_community_moderation_events (id, actor_id, subject_id, event_type, entity_type, entity_id, reason, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [crypto.randomUUID(), actorId, subjectId, eventType, entityType, entityId || null, reason || null, JSON.stringify(details || {})]
    );
  }
}

function createCommunityService(env, logger) {
  return new CommunityService(env, logger);
}

module.exports = {
  CommunityError,
  MESSAGE_LIMIT,
  PLACE_ID_LIMIT,
  cleanEmail,
  cleanPlaceId,
  cleanUsername,
  configuredEnvironment,
  createCommunityService
};
