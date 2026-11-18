# Eclipse

Eclipse is an early desktop launcher for official Roblox experiences.

## What works in this preview

- **Home** shows locally recorded recent launches and saved Roblox experiences.
- **Discover** loads live game names, player counts, ratings, creators, and thumbnails from Roblox’s official discovery and search APIs. Selectable Roblox-provided collections expose more choices than a single trending feed, alongside search and result pagination.
- **Library** saves official Roblox experiences locally on the current device; Eclipse does not invent or host custom games.
- **Community** is an explicit local-only shell for bounded connection-request drafts, targeted direct-message drafts, session-only image/GIF previews, and official Roblox place-invite drafts. It does not transmit data, deliver chats, contact people, upload media, or create online accounts. A future service will use Eclipse-native accounts—not Roblox identities or credentials—and must include mutual-friend, block/report, upload-limit, and moderation-record controls before online messaging or media is enabled.
- **Tools** can validate a Roblox place ID and start the installed Roblox Player through the official `roblox://experiences/start?placeId=…` protocol. The Windows desktop app shows an Eclipse Player Handoff window while the protocol is requested, then dismisses it after the handoff completes.
- **Fast Flags** has a dedicated sidebar destination for Windows-only Default, Performance, Balanced, and Quality rendering profiles; 1×, 2×, and 4× MSAA; mesh-detail and FRM-quality overrides; an Automatic, Direct3D 11, or Vulkan renderer preference; optional frame-rate targets; and a display-scaling option. Eclipse accepts only these bounded managed settings, merges only its managed keys into `ClientAppSettings.json`, and can remove only those keys again.
- **Integrations** keeps an optional local history of launch requests Eclipse starts. It also stores Discord Rich Presence display preferences, while clearly showing that publishing Rich Presence still needs an Eclipse Discord application ID and a local Discord desktop connection.
- **Eclipse profile** is a single-click local editor in the sidebar for an optional display name and profile image. JPEG, PNG, and WebP images are center-cropped to a bounded local avatar; no image is uploaded. The profile creates no online account, never requests Roblox credentials, and is not connected to a Roblox account.
- **Settings** persist only Eclipse interface preferences locally, including a Reduce interface motion option that also suppresses Eclipse animations.

> Eclipse is not affiliated with Roblox. Availability, rankings, game details, and the player-launch protocol are controlled by Roblox and may change.

## Run in a browser

Requires Node.js 22 or newer.

```bash
npm install
npm start
```

Open `http://localhost:4173`.

The browser preview fetches live Roblox discovery data through its local Node server. Launching a game hands off to the Roblox protocol registered on your computer.

## Run as a desktop application

Electron wraps the UI in a secure desktop window. The renderer has no Node.js access; it uses a narrow preload bridge for game discovery, official web handoff, and validated player launches.

```bash
npm install
npm run desktop:dev
```

## Build a Windows EXE

Build on a 64-bit Windows machine with Node.js 22 or newer installed:

```bash
npm install
npm run dist:win
```

This creates a portable executable in `release/`, named similarly to:

```text
Eclipse-0.1.0-preview.22-x64.exe
```

To create a conventional Windows installer with Start menu and desktop shortcut options instead:

```bash
npm run dist:win:installer
```

That creates an NSIS installer in `release/`.

### Build from GitHub

The repository includes a manual **Build Windows EXE** GitHub Actions workflow. Run it from the Actions tab, then download the `Eclipse-Windows-Portable` artifact after it completes.

> The first EXE build downloads Electron’s Windows runtime and packaging dependencies. Windows SmartScreen may display a warning until Eclipse has code signing and established reputation.

## Verification

```bash
npm run check
npm run test
```

The test suite uses mocked responses from the fixed official Roblox endpoints. It verifies response mapping, thumbnail attachment, and strict place-ID validation without sending network requests.
