const assert = require('node:assert/strict');
const test = require('node:test');
const { isUsableWindow, revealWindow } = require('../electron/window-visibility.cjs');

function mockWindow({ destroyed = false, minimized = false } = {}) {
  const calls = [];
  return {
    calls,
    isDestroyed: () => destroyed,
    isMinimized: () => minimized,
    restore: () => calls.push('restore'),
    setSkipTaskbar: (value) => calls.push(`skip:${value}`),
    show: () => calls.push('show'),
    focus: () => calls.push('focus')
  };
}

test('reveals a minimized Eclipse window and returns it to the taskbar', () => {
  const window = mockWindow({ minimized: true });
  assert.equal(isUsableWindow(window), true);
  assert.equal(revealWindow(window), true);
  assert.deepEqual(window.calls, ['restore', 'skip:false', 'show', 'focus']);
});

test('does not touch an unavailable or destroyed Eclipse window', () => {
  assert.equal(isUsableWindow(), false);
  assert.equal(revealWindow(), false);
  const destroyed = mockWindow({ destroyed: true });
  assert.equal(isUsableWindow(destroyed), false);
  assert.equal(revealWindow(destroyed), false);
  assert.deepEqual(destroyed.calls, []);
});

test('main process recovers a hidden single-instance window and has a visible failure fallback', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /app\.commandLine\.appendSwitch\('disable-gpu'\)/);
  assert.match(main, /app\.disableHardwareAcceleration\(\)/);
  assert.match(main, /Never let an invisible startup process keep the single-instance lock forever/);
  assert.match(main, /function recoverMainWindow\(\)/);
  assert.match(main, /else recoverMainWindow\(\);/);
  assert.match(main, /window\.isVisible\(\).*revealMainWindow\(window\)/);
  assert.match(main, /function showStartupError\(window\)/);
  assert.match(main, /window\.webContents\.on\('did-fail-load'/);
  assert.match(main, /window\.webContents\.on\('render-process-gone'/);
});
