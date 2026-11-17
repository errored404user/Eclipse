# Eclipse

Eclipse is a privacy-first, Windows desktop hub for the **official Roblox client**. It provides a safe foundation for local launch profiles, saved experiences, installation diagnostics, and settings without modifying Roblox binaries or collecting Roblox credentials.

> **Status:** Early foundation. Eclipse is not affiliated with or endorsed by Roblox Corporation.

## What works today

- Detects common Windows Roblox client installation locations without changing them.
- Opens official Roblox game and catalog pages in the user's default browser, allowing Roblox's official flow to launch the client.
- Stores locally named launch profiles and favorite experience IDs in an atomic JSON state file.
- Provides input validation, bounded state, diagnostics, and a hardened Electron IPC boundary.
- Uses a native desktop UI with no remote web content, no Node.js access in the renderer, and no arbitrary IPC channels.

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
  main.js             Electron main process: state, diagnostics, browser launch, allow-listed IPC
  preload.js          Minimal context-isolated renderer bridge
  shared/state.js     Validated domain state and pure state helpers
  renderer/           Local HTML, CSS, and browser-only UI logic
test/state.test.js    Node unit tests for persisted-state behavior
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

## Product direction

The first version is an independent desktop hub, not a clone of another launcher:

1. safe official-client launch and diagnostics;
2. local profiles and saved experience library;
3. opt-in integrations such as Discord presence only after a dedicated implementation and policy review;
4. future official Roblox experiences/catalog integrations only through documented, approved APIs.
