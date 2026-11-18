# Eclipse

Eclipse is a Windows desktop bootstrapper and launcher for official Roblox experiences.

## What works in this preview

- **Home** shows locally recorded recent launches and saved Roblox experiences.
- **Discover** loads live game names, player counts, ratings, creators, and thumbnails from Roblox’s official discovery and search APIs. Selectable Roblox-provided collections expose more choices than a single trending feed, alongside search and result pagination.
- **Library** saves official Roblox experiences locally on the current device; Eclipse does not invent or host custom games.
- **Community** connects to a separately deployed Eclipse Community service when it is configured. It uses a unique Eclipse username plus email/password account and email verification: search a username, send a message request, and open private text chat only after the recipient accepts. Official Roblox place invites are available in accepted private chats. It never asks for, links, stores, or uses Roblox credentials or Roblox identity. Blocking, reporting, rate limits, and moderation-ready audit records are included; media uploads are deliberately disabled until a separately hardened media pipeline exists.
- **Eclipse bootstrapper (Windows desktop)** detects the installed Roblox Player, checks Roblox’s official Windows Player release service before Eclipse launches, and downloads only the official Roblox installer when installation or an update is needed. Eclipse verifies the installer with Windows Authenticode before it runs, then confirms the installed version. It does not change the system `roblox://` association.
- **Tools** validates a Roblox place ID, asks the bootstrapper to prepare the official Player, then requests the existing official `roblox://experiences/start?placeId=…` protocol handler. The Eclipse Player Handoff reports Eclipse-owned install/handoff stages only—it never claims Roblox game or server state.
- **Fast Flags** has a dedicated sidebar destination for Windows-only Default, Performance, Balanced, and Quality rendering profiles; 1×, 2×, and 4× MSAA; mesh-detail and FRM-quality overrides; an Automatic, Direct3D 11, or Vulkan renderer preference; optional frame-rate targets; and a display-scaling option. Eclipse accepts only these bounded managed settings, merges only its managed keys into `ClientAppSettings.json`, and can remove only those keys again. During an official Player update, Eclipse carries only those managed keys into the new Player folder.
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

Community is a separate Eclipse-native service backed by PostgreSQL and transactional SMTP. This repository includes a Vercel serverless entry point (`api/index.js`) that routes the browser UI and `/api/community` through the same HTTPS origin. The service **intentionally remains unavailable** until its database, mail transport, session secret, and public URL are all configured.

1. Create a Vercel project for this repository. The included `vercel.json` rewrites all requests to the serverless Community entry point.
2. Provision a real PostgreSQL database and a transactional SMTP provider. Do not use invented connection strings or a personal mailbox as a production mail relay.
3. Set the encrypted Production environment variables in Vercel: `DATABASE_URL`, `COMMUNITY_SESSION_SECRET`, `COMMUNITY_SMTP_URL`, `COMMUNITY_EMAIL_FROM`, and `COMMUNITY_PUBLIC_URL`. Generate and retain a random session secret of at least 32 characters; never commit any of these values.
4. Set `COMMUNITY_PUBLIC_URL` to the exact deployed `https://` origin, then redeploy. It is used for verification links and same-origin protection. On Vercel, set `COMMUNITY_TRUST_PROXY=true` so the service can use Vercel's trusted forwarded client address for its baseline throttles. Keep `COMMUNITY_DATABASE_POOL_MAX` low (the default is `2`) to protect your PostgreSQL connection limit.
5. Confirm SMTP delivery and the Community health/status endpoint only after deployment. Startup verifies SMTP and initializes the PostgreSQL schema before it exposes Community as enabled.

For a containerized server, build and run the supplied `Dockerfile` with secrets injected by the hosting platform. The app listens on `PORT` (default `4173`); TLS should terminate at the platform or reverse proxy. See [`DEPLOYMENT.md`](DEPLOYMENT.md) for the environment contract, Vercel steps, security boundaries, backups, and launch checklist.

The browser UI uses the Community API at the same public origin. The Electron app instead needs `ECLIPSE_COMMUNITY_API_URL=https://community.example` in its launch environment; the desktop bridge accepts HTTPS Community URLs only and keeps its opaque session token out of renderer storage.

## Run as a desktop application

Electron wraps the UI in a secure desktop window. The renderer has no Node.js access; it uses narrow preload bridges for game discovery, bootstrapper status/update operations, official web handoff, and validated player launches. Bootstrapper filesystem, download, signature-validation, and process work stays in Electron’s main process.

```bash
npm install
npm run desktop:dev
```

### Official Roblox Player bootstrapper

The first bootstrapper release is **Windows desktop only**. Before an Eclipse launch it checks `WindowsPlayer` release metadata from Roblox’s official client-settings service. If Roblox Player is missing or out of date, Eclipse downloads the official web installer from Roblox’s download endpoint and falls back only to Roblox’s official setup CDN launcher if that endpoint is unavailable. It checks that the download is a Windows executable, requires a valid Windows Authenticode signature, runs it, and confirms the new Player version folder.

Eclipse does not download Roblox Player from third-party mirrors, never accepts Roblox credentials, and does not register itself as the `roblox://` protocol handler. If an update check is temporarily unavailable but an installed Player exists, Eclipse leaves the installed Player in place and requests the existing Roblox protocol handoff; if no Player is installed, it asks you to retry when Roblox’s official deployment service is reachable.

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

The test suite uses mocked responses from the fixed official Roblox endpoints. It verifies discovery response mapping, thumbnail attachment, strict place-ID validation, official Windows Player version/installer validation, managed Fast Flag migration, and the message-request Community contract without sending live Roblox requests.
