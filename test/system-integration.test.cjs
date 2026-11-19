const assert = require('node:assert/strict');
const test = require('node:test');
const {
  navigationPage,
  navigationPageFromArguments,
  placeIdFromArguments,
  startupStatus,
  taskbarJumpList,
  taskbarTasks
} = require('../electron/system-integration.cjs');

test('limits Windows destinations to Eclipse-owned pages', () => {
  assert.equal(navigationPage('tools'), 'tools');
  assert.equal(navigationPage('FASTFLAGS'), 'fastflags');
  assert.equal(navigationPage('mods'), 'mods');
  assert.equal(navigationPage('optimization'), 'optimization');
  assert.equal(navigationPage('roblox://experiences/start'), '');
  assert.equal(navigationPageFromArguments(['--some-other-flag', '--eclipse-page=library']), 'library');
  assert.equal(navigationPageFromArguments(['--eclipse-page=../../settings']), '');
  assert.equal(placeIdFromArguments(['--eclipse-place=1818']), 1818);
  assert.equal(placeIdFromArguments(['--eclipse-place=1818&bad=1']), 0);
});

test('builds taskbar destinations without taking ownership of Roblox protocol links', () => {
  const tasks = taskbarTasks('C:\\Program Files\\Eclipse\\Eclipse.exe');
  assert.equal(tasks.length, 5);
  assert.deepEqual(tasks.map((task) => task.arguments), [
    '--eclipse-page=home',
    '--eclipse-page=discover',
    '--eclipse-page=library',
    '--eclipse-page=mods',
    '--eclipse-page=tools'
  ]);
  assert.equal(tasks.some((task) => task.program.includes('roblox:')), false);
  const jumpList = taskbarJumpList('C:\\Program Files\\Eclipse\\Eclipse.exe', [1818, 1818, 42]);
  assert.equal(jumpList[0].name, 'Eclipse destinations');
  assert.equal(jumpList[1].name, 'Recent Eclipse handoffs');
  assert.deepEqual(jumpList[1].items.map((item) => item.arguments), [
    '--eclipse-page=tools --eclipse-place=1818',
    '--eclipse-page=tools --eclipse-place=42'
  ]);
});

test('only exposes startup controls to packaged Windows Eclipse', () => {
  assert.equal(startupStatus({ platform: 'linux', isPackaged: true }).supported, false);
  assert.equal(startupStatus({ platform: 'win32', isPackaged: false }).supported, false);
  assert.deepEqual(startupStatus({ platform: 'win32', isPackaged: true, loginItemSettings: { openAtLogin: true } }), {
    supported: true,
    enabled: true,
    reason: ''
  });
});
