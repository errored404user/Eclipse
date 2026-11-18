const { EventEmitter } = require('node:events');
const net = require('node:net');
const path = require('node:path');

const DISCORD_IPC_VERSION = 1;
const MAX_PACKET_BYTES = 1024 * 1024;
const APPLICATION_ID_PATTERN = /^\d{17,20}$/;
const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const ACTIVITY_DISPLAYS = Object.freeze(['open-eclipse', 'minimal']);

function normalizeApplicationId(value) {
  const applicationId = String(value || '').trim();
  return APPLICATION_ID_PATTERN.test(applicationId) ? applicationId : '';
}

function normalizeAssetKey(value) {
  const assetKey = String(value || '').trim();
  return ASSET_KEY_PATTERN.test(assetKey) ? assetKey : 'eclipse';
}

function normalizeActivityDisplay(value) {
  return ACTIVITY_DISPLAYS.includes(value) ? value : 'open-eclipse';
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

function openEclipseActivity(startedAt = Date.now(), options = {}) {
  const activityDisplay = normalizeActivityDisplay(options.activityDisplay);
  const imageAssetKey = normalizeAssetKey(options.imageAssetKey);
  return {
    details: 'Open Eclipse',
    ...(activityDisplay === 'open-eclipse' ? { state: 'Roblox launcher' } : {}),
    assets: {
      large_image: imageAssetKey,
      large_text: 'Eclipse'
    },
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
    this.imageAssetKey = 'eclipse';
    this.activityDisplay = 'open-eclipse';
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
      imageAssetKey: this.imageAssetKey,
      activityDisplay: this.activityDisplay,
      connected: this.connected,
      connecting: this.connecting,
      reason
    };
  }

  emitStatus() {
    this.emit('status', this.status());
  }

  configure(options = {}) {
    const { applicationId, enabled, imageAssetKey, activityDisplay } = options;
    const hasApplicationId = Object.hasOwn(options, 'applicationId');
    const hasEnabled = Object.hasOwn(options, 'enabled');
    const hasImageAssetKey = Object.hasOwn(options, 'imageAssetKey');
    const hasActivityDisplay = Object.hasOwn(options, 'activityDisplay');
    const nextApplicationId = hasApplicationId
      ? normalizeApplicationId(applicationId) || this.environmentApplicationId
      : this.applicationId;
    const nextImageAssetKey = hasImageAssetKey ? normalizeAssetKey(imageAssetKey) : this.imageAssetKey;
    const nextActivityDisplay = hasActivityDisplay ? normalizeActivityDisplay(activityDisplay) : this.activityDisplay;
    const changedApplication = nextApplicationId !== this.applicationId;
    const changedPresentation = nextImageAssetKey !== this.imageAssetKey || nextActivityDisplay !== this.activityDisplay;
    if (changedApplication) {
      this.clearAndDisconnect();
      this.applicationId = nextApplicationId;
    }
    this.imageAssetKey = nextImageAssetKey;
    this.activityDisplay = nextActivityDisplay;
    if (hasEnabled) this.enabled = enabled === true;
    if (!this.enabled || !this.applicationId) {
      this.clearAndDisconnect();
      this.emitStatus();
      return this.status();
    }
    if (changedPresentation && this.connected) this.publishOpenEclipse();
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
      args: {
        pid: process.pid,
        activity: openEclipseActivity(this.startedAt, {
          imageAssetKey: this.imageAssetKey,
          activityDisplay: this.activityDisplay
        })
      },
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
  ACTIVITY_DISPLAYS,
  APPLICATION_ID_PATTERN,
  ASSET_KEY_PATTERN,
  DiscordPresence,
  createDiscordPresence,
  normalizeActivityDisplay,
  normalizeApplicationId,
  normalizeAssetKey,
  openEclipseActivity,
  ipcPaths
};
