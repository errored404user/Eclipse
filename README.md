# Eclipse

Eclipse is a privacy-first, Windows desktop hub for the **official Roblox client**. It provides a safe foundation for local launch profiles, saved experiences, installation diagnostics, and customizable settings without modifying Roblox binaries or collecting Roblox credentials.

> **Status:** Early foundation. Eclipse is not affiliated with or endorsed by Roblox Corporation.

## Installation-first experience

Eclipse does not install, distribute, patch, or impersonate Roblox. On first launch it:

1. checks the conventional Windows location for the official Roblox Player;
2. opens only Roblox's official download page if the player is not found;
3. asks the user to complete Roblox's own installer; and
4. re-checks the local installation before unlocking any experience launch.

Experience launches are also enforced by the Electron main process, so a renderer change cannot bypass the local installation check.

## Launcher, integrations, and deployment

Eclipse opens with a compact launcher for the most common next steps:

- **Open Roblox** opens Roblox’s official home page in the default browser.
- **Configure Eclipse** opens the full local launchpad and settings workspace.
- **Deployment & installation** shows official installation status, links only to Roblox’s installer, and supports a local re-check. Eclipse does not choose client channels or domains, distribute Roblox, or modify its installation.

The **Integrations** page currently offers one optional local-only signal: whether `RobloxPlayerBeta.exe` is running on Windows. This check is off by default, is evaluated only when Eclipse refreshes its local dashboard, and does not read account, game, place, server, or activity-history data. It is never uploaded. Discord Rich Presence is visibly marked unavailable in this release; Eclipse makes no claim that it is active.

## What works today

- Detects common Windows Roblox client installation locations without changing them.
- Provides a setup-first onboarding flow and blocks experience launches until the official player is detected.
- Opens official Roblox game and catalog pages in the user's default browser, allowing Roblox's official flow to launch the client.
- Stores locally named launch profiles and favorite experience IDs in an atomic JSON state file.
- Provides fifteen validated, persisted settings that control theme, accent, density, text size, motion, contrast, focus mode, notifications, optional local activity presence, launch confirmation, navigation, library presentation, and diagnostic privacy.
- Provides input validation, bounded state, diagnostics, and a hardened Electron IPC boundary.
- Uses a native desktop UI with no remote web content, no Node.js access in the renderer, and no arbitrary IPC channels.

## Guarded FastFlags

Eclipse implements a narrow **Guarded FastFlags** page for reviewed client-side rendering and accessibility overrides. It is not a generic FastFlag editor.

- Roblox publishes a local FastFlag allowlist and can change it at any time. Read the current guidance at [Roblox’s FastFlag allowlist announcement](https://devforum.roblox.com/t/allowlist-for-local-client-configuration-via-fast-flags/3966569).
- Eclipse applies only its fixed catalog: texture quality, minimized grass motion, a DPI-scaling workaround, 1×/2×/4× anti-aliasing, and a mutually exclusive Direct3D 11/Vulkan/OpenGL renderer choice.
- It writes only `%LOCALAPPDATA%\\Roblox\\ClientSettings\\ClientAppSettings.json`, after detecting the official Roblox Player.
- It never touches cache files, IXP settings, binaries, networking, scheduling, or gameplay settings.
- Before modifying an existing configuration, Eclipse creates `ClientAppSettings.eclipse-backup.json` beside it. Restore defaults removes only Eclipse-managed keys and preserves unrelated entries.
- Malformed JSON or symbolic links are blocked rather than overwritten.

These controls are selected from an allowlisted local configuration route, but **they are not a promise against moderation action or instability**. Use Roblox defaults whenever a setting causes a problem, and restart Roblox after applying a change.

## Intentional safety boundaries

Eclipse does **not** implement or plan to implement:

- script execution, code injection, memory modification, bypasses, or client patching;
- Roblox credential, cookie, or token collection/storage;
- botting, gameplay automation, or macro execution;
- unsupported direct-launch tokens or emulation of Roblox authentication flows.

Local profiles are only labels and color preferences. They do not represent Roblox accounts or sessions.

## Architecture

```text
src/
  main.js                 Electron main process: state, diagnostics, official browser launch, allow-listed IPC
  preload.js              Minimal context-isolated renderer bridge
  shared/state.js         Validated state, settings schema, and pure state helpers
  shared/installation.js  Testable official-client readiness predicate
  shared/fastflags.js     Fixed FastFlag catalog, validation, and pure configuration transforms
  renderer/               Local HTML, CSS, and browser-only UI logic
test/state.test.js        Node unit tests for state, readiness, and guarded FastFlag behavior
```

The UI is intentionally separated from local system access. Future official integrations should be implemented as narrowly scoped main-process adapters, with explicit user consent and tests.

## Development

### Prerequisites

- Node.js 22 or newer
- Windows 10/11 for client-installation detection and production packaging

### Run

```bash
npm install
npm run check
npm test
npm start
```

The Electron application can be developed on non-Windows platforms, but its Roblox installation diagnostics will clearly report that Windows is the supported target.

### Build the Windows application

On a Windows x64 machine, create a distributable Eclipse application with:

```bash
npm install
npm run dist
```

`dist` runs syntax and unit checks before packaging. Its output is:

```text
release/Eclipse-win32-x64/Eclipse.exe
```

`Eclipse.exe` depends on the files in its generated directory. To distribute it, share or zip the entire `release/Eclipse-win32-x64` folder; do not move the EXE by itself. Use `npm run pack` only when you need a quick package without the pre-packaging validation steps.

The resulting executable is unsigned. Windows SmartScreen can warn users until the application is signed with an appropriate code-signing certificate.

## Product direction

The first version is an independent desktop hub, not a clone of another launcher:

1. safe official-client installation, launch, and diagnostics;
2. local profiles and saved experience library;
3. accessibility and personalization that has immediate local effect;
4. opt-in integrations such as Discord presence only after a dedicated implementation and policy review;
5. future official Roblox experiences/catalog integrations only through documented, approved APIs.
