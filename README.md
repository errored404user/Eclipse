# Eclipse

Eclipse is an early desktop launcher for official Roblox experiences.

## What works in this preview

- **Home** shows locally recorded recent launches and saved Roblox experiences.
- **Discover** loads live game names, player counts, ratings, creators, and thumbnails from Roblox’s official discovery and search APIs. Selectable Roblox-provided collections expose more choices than a single trending feed, alongside search and result pagination.
- **Library** saves official Roblox experiences locally on the current device; Eclipse does not invent or host custom games.
- **Community** connects to a separately deployed Eclipse Community service when it is configured. It uses a unique Eclipse username plus email/password account and email verification: search a username, send a message request, and open private text chat only after the recipient accepts. Official Roblox place invites are available in accepted private chats. It never asks for, links, stores, or uses Roblox credentials or Roblox identity. Blocking, reporting, rate limits, and moderation-ready audit records are included; media uploads are deliberately disabled until a separately hardened media pipeline exists.
- **Tools** can validate a Roblox place ID and start the installed Roblox Player through the official `roblox://experiences/start?placeId=…` protocol. The Windows desktop app shows an Eclipse Player Handoff window while the protocol is requested, then dismisses it after the handoff completes.
- **Fast Flags** has a dedicated sidebar destination for Windows-only Default, Performance, Balanced, and Quality rendering profiles; 1×, 2×, and 4× MSAA; mesh-detail and FRM-quality overrides; an Automatic, Direct3D 11, or Vulkan renderer preference; optional frame-rate targets; and a display-scaling option. Eclipse accepts only these bounded managed settings, merges only its managed keys into `ClientAppSettings.json`, and can remove only those keys again.
- **Integrations** keeps an optional local history of launch requests Eclipse starts. On the desktop app, Discord Rich Presence uses Discord’s local IPC connection to show **Open Eclipse** while Eclipse is running. It requires a public Discord Application ID, never asks for Discord credentials, and does not pretend to know Roblox server/gameplay state.
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

The browser preview fetches live Roblox discovery data through its local Node server. Launching a game hands off to the Roblox protocol registered on your computer. Community remains unavailable until the production service variables below are configured; this is intentional and does not create a public account service.

## Deploy Eclipse Community

Community is a separate Eclipse-native service that runs from this same Node server with PostgreSQL and a transactional SMTP provider. It is **not deployed by this repository or preview**. A public release needs a real HTTPS hostname, database, mail provider, session secret, reverse proxy/hosting, operations monitoring, and moderation process.

1. Copy `.env.example` to a private environment file or configure the variables in your host. Never commit the real values.
2. Point `DATABASE_URL` at a PostgreSQL database. The service creates its tables and indexes at startup and removes expired sessions/verification links.
3. Set `COMMUNITY_PUBLIC_URL` to the exact public HTTPS origin that serves Eclipse. It is used for email-verification links and same-origin protection.
4. Configure SMTP and a sender address that your provider authorizes. Startup verifies the SMTP connection before it exposes Community as enabled.
5. Put the app behind HTTPS. If a trusted reverse proxy supplies `X-Forwarded-For`, set `COMMUNITY_TRUST_PROXY=true` and make sure the proxy strips any client-provided version of that header.

For a containerized server, build and run the supplied `Dockerfile` with secrets injected by the hosting platform. The app listens on `PORT` (default `4173`); TLS should terminate at the platform or reverse proxy. See [`DEPLOYMENT.md`](DEPLOYMENT.md) for the environment contract, security boundaries, backups, and launch checklist.

The browser UI uses the Community API at the same public origin. The Electron app instead needs `ECLIPSE_COMMUNITY_API_URL=https://community.example` in its launch environment; the desktop bridge accepts HTTPS Community URLs only and keeps its opaque session token out of renderer storage.

## Run as a desktop application

Electron wraps the UI in a secure desktop window. The renderer has no Node.js access; it uses a narrow preload bridge for game discovery, official web handoff, and validated player launches.

```bash
npm install
npm run desktop:dev
```

### Enable Discord Rich Presence

Discord Rich Presence is functional in the desktop app through Discord Desktop’s local IPC socket. Create/configure an application named **Eclipse** in the Discord Developer Portal, then use its public **Application ID** either in **Integrations** or as a launch environment value:

```bash
ECLIPSE_DISCORD_CLIENT_ID=123456789012345678 npm run desktop:dev
```

Enable **Show Open Eclipse in Discord** in Integrations while Discord Desktop is running. The presence reads **Open Eclipse** / **Roblox launcher** and clears when Eclipse exits. An Application ID is public—not a client secret; never place a Discord client secret, bot token, or user token in Eclipse.

## Build a Windows EXE

Build on a 64-bit Windows machine with Node.js 22 or newer installed:

```bash
npm install
npm run dist:win
```

This creates a portable executable in `release/`, named similarly to:

```text
Eclipse-0.1.0-preview.24-x64.exe
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
