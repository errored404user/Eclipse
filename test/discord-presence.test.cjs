const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createDiscordPresence,
  ipcPaths,
  normalizeApplicationId,
  openEclipseActivity
} = require('../electron/discord-presence.cjs');

function packet(opcode, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(8);
  header.writeInt32LE(opcode, 0);
  header.writeInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function packetReader(onPacket) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 8) {
      const opcode = buffer.readInt32LE(0);
      const length = buffer.readInt32LE(4);
      if (buffer.length < 8 + length) return;
      const body = JSON.parse(buffer.subarray(8, 8 + length).toString('utf8'));
      buffer = buffer.subarray(8 + length);
      onPacket(opcode, body);
    }
  };
}

async function waitFor(predicate, timeout = 1_500) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for Discord IPC activity.');
}

test('normalizes public Discord application IDs and produces the Open Eclipse activity', () => {
  assert.equal(normalizeApplicationId(' 123456789012345678 '), '123456789012345678');
  assert.equal(normalizeApplicationId('not-a-client-id'), '');
  assert.equal(normalizeApplicationId('1234'), '');
  assert.deepEqual(openEclipseActivity(12_345), {
    details: 'Open Eclipse',
    state: 'Roblox launcher',
    timestamps: { start: 12 },
    instance: false
  });
  const windowsPath = ipcPaths('win32')[0];
  assert.deepEqual([...windowsPath.slice(0, 9)].map((character) => character.charCodeAt(0)), [92, 92, 63, 92, 112, 105, 112, 101, 92]);
});

test('uses Discord local IPC to publish and clear Open Eclipse presence', async (context) => {
  const isWindows = process.platform === 'win32';
  const directory = isWindows ? '' : await fs.mkdtemp(path.join(os.tmpdir(), 'eclipse-discord-'));
  const socketPath = isWindows ? ipcPaths('win32')[0] : path.join(directory, 'discord-ipc-0');
  const received = [];
  const server = net.createServer((socket) => {
    socket.on('data', packetReader((opcode, payload) => {
      received.push({ opcode, payload });
      if (opcode === 0) socket.write(packet(1, { evt: 'READY', data: { v: 1 } }));
    }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  });

  const presence = createDiscordPresence({
    applicationId: '123456789012345678',
    environment: isWindows ? {} : { XDG_RUNTIME_DIR: directory },
    platform: isWindows ? 'win32' : 'linux',
    logger: { debug() {} }
  });
  context.after(() => presence.close());

  const initial = presence.configure({ enabled: true });
  assert.equal(initial.enabled, true);
  const activityPacket = await waitFor(() => received.find(({ payload }) => payload?.cmd === 'SET_ACTIVITY' && payload?.args?.activity));
  assert.equal(activityPacket.opcode, 1);
  assert.equal(activityPacket.payload.args.activity.details, 'Open Eclipse');
  assert.equal(activityPacket.payload.args.activity.state, 'Roblox launcher');
  assert.equal(presence.status().connected, true);

  presence.close();
  const clearPacket = await waitFor(() => received.find(({ payload }) => payload?.cmd === 'SET_ACTIVITY' && payload?.args?.activity === null));
  assert.equal(clearPacket.opcode, 1);
});
