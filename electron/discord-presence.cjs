const { EventEmitter } = require('node:events');
const net = require('node:net');
const path = require('node:path');

const DISCORD_IPC_VERSION = 1;
const MAX_PACKET_BYTES = 1024 * 1024;
const APPLICATION_ID_PATTERN = /^\d{17,20}$/;

function normalizeApplicationId(value) {
  const applicationId = String(value || '').trim();
  return APPLICATION_ID_PATTERN.test(applicationId) ? applicationId : '';
}

function ipcPaths(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    return Array.from({ length: 10 }, (_value, index) => `\\\\?\\pipe\\discord-ipc-${index}`);
  }
  const directories = [
    env.XDG_RUNTIME_DIR,
    env.TMPDIR,
    env.TMP,
    env.TEMP,
    '/tmp'
  ].filter(Boolean);
  return [...new Set(directories)].flatMap((directory) => (
    Array.from({ length: 10 }, (_value, index) => path.join(directory, `discord-ipc-${index}`))
  ));
}

function openEclipseActivity(startedAt = Date.now()) {
  return {
    details: 'Open Eclipse',
    state: 'Roblox launcher',
    timestamps: { start: Math.floor(startedAt / 1000) },
    instance: false
  };
}

function connectSocket(socketPath) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      socket.removeListener('error', onError);
      socket.removeListener('connect', onConnect);
      callback(value);
    };
    const onError = (error) => finish(reject, error);
    const onConnect = () => finish(resolve, socket);
    socket.once('error', onError);
    socket.once('connect', onConnect);
    socket.setTimeout(1200, () => finish(reject, new Error('Discord IPC connection timed out.')));
  });
}

class DiscordPresence extends EventEmitter {
  constructor({ applicationId = '', environment = process.env, platform = process.platform, logger = console } = {}) {
    super();
    this.environment = environment;
    this.platform = platform;
    this.logger = logger;
    this.environmentApplicationId = normalizeApplicationId(environment.ECLIPSE_DISCORD_CLIENT_ID);
    this.applicationId = normalizeApplicationId(applicationId) || this.environmentApplicationId;
    this.enabled = false;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.connecting = false;
    this.connected = false;
    this.handshaken = false;
    this.retryTimer = null;
    this.retryDelay = 1_000;
    this.startedAt = Date.now();
  }

  status() {
    const configured = Boolean(this.applicationId);
    let reason = '';
    if (!configured) reason = 'Add a Discord Application ID to enable Rich Presence.';
    else if (!this.enabled) reason = 'Rich Presence is turned off.';
    else if (this.connected) reason = 'Connected to Discord Desktop.';
    else if (this.connecting) reason = 'Connecting to Discord Desktop…';
    else reason = 'Waiting for Discord Desktop to be available.';
    return {
      supported: true,
      configured,
      enabled: this.enabled,
      connected: this.connected,
      connecting: this.connecting,
      reason
    };
  }

  emitStatus() {
    this.emit('status', this.status());
  }

  configure(options = {}) {
    const { applicationId, enabled } = options;
    const hasApplicationId = Object.hasOwn(options, 'applicationId');
    const hasEnabled = Object.hasOwn(options, 'enabled');
    const nextApplicationId = hasApplicationId
      ? normalizeApplicationId(applicationId) || this.environmentApplicationId
      : this.applicationId;
    const changedApplication = nextApplicationId !== this.applicationId;
    if (changedApplication) {
      this.clearAndDisconnect();
      this.applicationId = nextApplicationId;
    }
    if (hasEnabled) this.enabled = enabled === true;
    if (!this.enabled || !this.applicationId) {
      this.clearAndDisconnect();
      this.emitStatus();
      return this.status();
    }
    this.connect();
    this.emitStatus();
    return this.status();
  }

  async connect() {
    if (!this.enabled || !this.applicationId || this.socket || this.connecting) return;
    this.connecting = true;
    this.emitStatus();
    let socket;
    try {
      const candidates = ipcPaths(this.platform, this.environment);
      let lastError;
      for (const candidate of candidates) {
        try {
          socket = await connectSocket(candidate);
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!socket) throw lastError || new Error('Discord IPC was not found.');
      if (!this.enabled || !this.applicationId) {
        socket.destroy();
        return;
      }
      this.socket = socket;
      this.buffer = Buffer.alloc(0);
      socket.setTimeout(0);
      socket.on('data', (chunk) => this.handleData(chunk));
      socket.on('error', () => this.handleDisconnect());
      socket.on('close', () => this.handleDisconnect());
      this.send(0, { v: DISCORD_IPC_VERSION, client_id: this.applicationId });
    } catch (error) {
      if (this.enabled && this.applicationId) this.scheduleRetry(error);
    } finally {
      this.connecting = false;
      this.emitStatus();
    }
  }

  send(opcode, payload) {
    if (!this.socket || this.socket.destroyed) return false;
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const header = Buffer.alloc(8);
    header.writeInt32LE(opcode, 0);
    header.writeInt32LE(body.length, 4);
    try {
      this.socket.write(Buffer.concat([header, body]));
      return true;
    } catch {
      return false;
    }
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    while (this.buffer.length >= 8) {
      const opcode = this.buffer.readInt32LE(0);
      const length = this.buffer.readInt32LE(4);
      if (length < 0 || length > MAX_PACKET_BYTES) {
        this.clearAndDisconnect();
        return;
      }
      if (this.buffer.length < 8 + length) return;
      const raw = this.buffer.subarray(8, 8 + length);
      this.buffer = this.buffer.subarray(8 + length);
      let payload;
      try {
        payload = JSON.parse(raw.toString('utf8'));
      } catch {
        this.clearAndDisconnect();
        return;
      }
      this.handlePacket(opcode, payload);
    }
  }

  handlePacket(opcode, payload) {
    if (opcode === 3) {
      this.send(4, payload);
      return;
    }
    if (opcode === 2) {
      this.handleDisconnect();
      return;
    }
    if (opcode !== 1) return;
    if (payload?.evt === 'READY') {
      this.handshaken = true;
      this.connected = true;
      this.retryDelay = 1_000;
      this.publishOpenEclipse();
      this.emitStatus();
    }
  }

  publishOpenEclipse() {
    if (!this.enabled || !this.connected || !this.handshaken) return false;
    return this.send(1, {
      cmd: 'SET_ACTIVITY',
      args: { pid: process.pid, activity: openEclipseActivity(this.startedAt) },
      nonce: `eclipse-${Date.now()}`
    });
  }

  clearActivity() {
    if (!this.connected || !this.handshaken) return false;
    return this.send(1, {
      cmd: 'SET_ACTIVITY',
      args: { pid: process.pid, activity: null },
      nonce: `eclipse-clear-${Date.now()}`
    });
  }

  handleDisconnect() {
    const wasConnected = this.connected || this.connecting || this.socket;
    this.connected = false;
    this.handshaken = false;
    this.connecting = false;
    const socket = this.socket;
    this.socket = null;
    if (socket && !socket.destroyed) socket.destroy();
    if (this.enabled && this.applicationId) this.scheduleRetry();
    if (wasConnected) this.emitStatus();
  }

  scheduleRetry(error) {
    if (!this.enabled || !this.applicationId || this.retryTimer) return;
    if (error) this.logger.debug?.('Discord Rich Presence is waiting for Discord Desktop:', error.message);
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
    this.retryTimer.unref?.();
  }

  clearAndDisconnect() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.clearActivity();
    this.connected = false;
    this.handshaken = false;
    this.connecting = false;
    const socket = this.socket;
    this.socket = null;
    if (socket && !socket.destroyed) socket.end();
  }

  close() {
    this.enabled = false;
    this.clearAndDisconnect();
    this.emitStatus();
  }
}

function createDiscordPresence(options) {
  return new DiscordPresence(options);
}

module.exports = {
  APPLICATION_ID_PATTERN,
  DiscordPresence,
  createDiscordPresence,
  normalizeApplicationId,
  openEclipseActivity,
  ipcPaths
};
