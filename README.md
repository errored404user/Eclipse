# Eclipse

Eclipse is an early desktop launcher for official Roblox experiences.

## What works in this preview

- **Home** shows locally recorded recent launches and saved Roblox experiences.
- **Discover** loads live game names, player counts, ratings, creators, and thumbnails from Roblox’s official discovery and search APIs.
- **Library** saves official Roblox experiences locally on the current device; Eclipse does not invent or host custom games.
- **Tools** can validate a Roblox place ID and start the installed Roblox Player through the official `roblox://experiences/start?placeId=…` protocol.
- **Accounts** always open official Roblox sign-in, sign-up, and download pages. Eclipse never requests, stores, or submits Roblox passwords, cookies, or authentication tokens.
- **Settings** persist only Eclipse interface preferences locally.

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
Eclipse-0.1.0-preview.3-x64-portable.exe
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
