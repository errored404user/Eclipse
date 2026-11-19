const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('builds an NSIS Eclipse installer that launches the installed app after setup', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'build-windows-exe.yml'), 'utf8');

  assert.equal(packageJson.scripts['dist:win'], 'electron-builder --win nsis --x64 --publish never');
  assert.equal(packageJson.scripts['dist:win:portable'], 'electron-builder --win portable --x64 --publish never');
  assert.deepEqual(packageJson.build.electronLanguages, ['en-US']);
  assert.match(packageJson.build.nsis.artifactName, /-Setup-/);
  assert.doesNotMatch(packageJson.build.win.artifactName, /-Setup-/);
  assert.equal(packageJson.build.nsis.oneClick, false);
  assert.equal(packageJson.build.nsis.allowToChangeInstallationDirectory, true);
  assert.equal(packageJson.build.nsis.createDesktopShortcut, true);
  assert.equal(packageJson.build.nsis.createStartMenuShortcut, true);
  assert.equal(packageJson.build.nsis.runAfterFinish, true);
  assert.equal(packageJson.build.nsis.deleteAppDataOnUninstall, false);
  assert.match(workflow, /Build Windows installer/);
  assert.match(workflow, /name: Eclipse-Windows-Installer/);
  assert.match(workflow, /path: release\/\*-Setup-\*\.exe/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /Publish Windows installer to GitHub release/);
  assert.match(workflow, /gh release (create|upload)/);
});
