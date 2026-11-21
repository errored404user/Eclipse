# Eclipse

Eclipse is a Windows desktop bootstrapper and launcher for official Roblox experiences.

## What works in Eclipse v2

- **Home** shows locally recorded recent launches and saved Roblox experiences.
- **Discover** loads live game names, player counts, ratings, creators, and thumbnails from Roblox’s official discovery and search APIs. Selectable Roblox-provided collections expose more choices than a single trending feed, alongside search and result pagination. Individual cards save to the local Library, and a single “Add all to Library” action saves every currently visible result at once while respecting the 120-game local limit. Eclipse also keeps a bounded local snapshot with visible freshness information, renders it immediately while official data refreshes, and can show that snapshot when Roblox discovery is temporarily unavailable.
- **Game details** exposes official public-server lists. You can save a local per-experience server-finder preference for sort, availability, and Roblox-reported ping, then compare the currently returned page after a refresh. These controls only organize current Roblox responses; Eclipse does not measure latency, reserve servers, control matchmaking, or retain expired server IDs.
- **Library** saves official Roblox experiences locally on the current device; Eclipse does not invent or host custom games. Create bounded local collections, manually order collections and games within a collection, pin games, add private tags and notes, then search or sort your local library. Collections and notes never modify Roblox.
- **History** records a bounded local list of successful Eclipse-to-Roblox Player handoff requests. It supports relaunching, pinning remembered game details into Library, JSON export, and confirmed clearing; it never claims to know Roblox connection or gameplay results.
- **Eclipse bootstrapper (Windows desktop)** detects the installed Roblox Player, checks Roblox’s official Windows Player release service before Eclipse launches, and downloads only the official Roblox installer when installation or an update is needed. Eclipse verifies the installer with Windows Authenticode before it runs, then confirms the installed version. It does not change the system `roblox://` association.
- **Tools** validates a Roblox place ID, asks the bootstrapper to prepare the official Player, then requests the existing official `roblox://experiences/start?placeId=…` protocol handler. The Eclipse Player Handoff reports Eclipse-owned install/handoff stages only—it never claims Roblox game or server state.
- **Fast Flags** has a dedicated sidebar destination for Windows-only Default, Performance, Balanced, and Quality rendering profiles; 1×, 2×, and 4× MSAA; mesh-detail and FRM-quality overrides; an Automatic, Direct3D 11, or Vulkan renderer preference; a one-click Maximum performance preset (lowest visual load: no shadows, grass, bloom, or post-processing, with prerendering and hyperthreading flags); optional frame-rate targets, including an uncapped mode that writes a 9,999 FPS target and removes Roblox's 240 FPS clamp; and a display-scaling option. A bounded Fast Flag editor also lets you add up to 50 custom FVariable entries (FFlag/DFFlag/FInt/DFInt/FString/DFString/FLog/DFLog names with bounded values); Eclipse tracks the custom keys it writes so Reset removes them and Player updates carry them forward. Roblox, the display, and hardware can still limit the final frame rate, and Roblox decides which local flags it accepts. Eclipse accepts only these bounded managed settings, merges only its managed keys into `ClientAppSettings.json`, and can remove only those keys again. During an official Player update, Eclipse carries only those managed keys into the new Player folder.
- **Mods** is a Windows-only local Player Packs workspace for validated texture/UI and sound assets. Its guided tutorial and Pack Creator scan the installed Player for eligible existing targets, then turn selected local media into a shareable `.eclipsepack`; you can also import a local `.eclipsepack` ZIP or developer manifest folder. Packs apply only while Roblox Player is closed, use versioned original-file backups, and restore in one click. Packages never contain code: executables, scripts, injectors, DLLs, credentials, network permissions, arbitrary paths, and undeclared files are rejected. An official Player update or repair restores originals, disables every active pack, and marks it for compatibility review rather than migrating it automatically.
- **Integrations** can enable or pause the local recording of Eclipse launch requests. On the desktop app, Discord Rich Presence uses Discord’s local IPC connection to show **Open Eclipse** while Eclipse is running. It requires a public Discord Application ID, never asks for Discord credentials, and does not pretend to know Roblox server/gameplay state.
- **Eclipse profile** is a single-click local editor in the sidebar for an optional display name and profile image. JPEG, PNG, and WebP images are center-cropped to a bounded local avatar; no image is uploaded. The profile creates no online account, never requests Roblox credentials, and is not connected to a Roblox account.
- **Settings** persist only Eclipse interface preferences locally, including Reduce interface motion, high contrast, interface scale, and an on-by-default Eclipse performance mode. A first-run guide explains Player readiness, local workspace data, and explicit-change controls. Performance mode removes expensive blur, glow, shadows, and decorative animation from the software-rendered desktop workspace; it can be turned off if the fuller visual treatment is preferred. Settings can export/import a validated, bounded `eclipse-local-backup/v1` of Eclipse-owned Library, collections, server-finder preferences, history, preferences, local profile, and saved Fast Flag profiles; Roblox credentials and Player files are never included. When a public GitHub Release feed is available, desktop builds offer a non-blocking check that only reports and opens a newer published release when you choose—it never downloads or installs anything automatically. If that feed is unavailable, Eclipse says so instead of claiming that the build is up to date.

> Eclipse is not affiliated with Roblox. Availability, rankings, game details, and the player-launch protocol are controlled by Roblox and may change.

## Run in a browser

Requires Node.js 22 or newer.

```bash
npm install
npm start
```

Open `http://localhost:4173`.

Browser mode fetches live Roblox discovery data through its local Node server. Launching a game hands off to the Roblox protocol registered on your computer.

## Run as a desktop application

Electron wraps the UI in a secure desktop window. The renderer has no Node.js access; it uses narrow preload bridges for game discovery, bootstrapper status/update operations, official web handoff, and validated player launches. Bootstrapper filesystem, download, signature-validation, and process work stays in Electron’s main process.

```bash
npm install
npm run desktop:dev
```

### Official Roblox Player bootstrapper

The first bootstrapper release is **Windows desktop only**. Before an Eclipse launch it checks `WindowsPlayer` release metadata from Roblox’s official client-settings service. If Roblox Player is missing or out of date, Eclipse downloads the official web installer from Roblox’s download endpoint and falls back only to Roblox’s official setup CDN launcher if that endpoint is unavailable. It checks that the download is a Windows executable, requires a valid Windows Authenticode signature, runs it, and confirms the new Player version folder.

Eclipse does not download Roblox Player from third-party mirrors, never accepts Roblox credentials, and does not register itself as the `roblox://` protocol handler. If an update check is temporarily unavailable but an installed Player exists, Eclipse leaves the installed Player in place and requests the existing Roblox protocol handoff; if no Player is installed, it asks you to retry when Roblox’s official deployment service is reachable.

### Local Player Packs

Player Packs are intentionally a constrained local-asset workflow, not an extension, loader, or injection system. Import a `.eclipsepack` archive (a ZIP with `manifest.json`) or select a local developer folder. A pack declares each asset and the only supported targets are existing files under `content/textures/**` and `content/sounds/**` in the installed Player version.

```json
{
  "schema": "eclipse-player-pack/v1",
  "id": "violet-interface",
  "name": "Violet Interface",
  "version": "1.0.0",
  "description": "A local visual pack",
  "assets": [
    {
      "source": "assets/interface.png",
      "target": "content/textures/interface.png",
      "kind": "texture"
    }
  ]
}
```

Only PNG/JPEG/WebP texture files and OGG/MP3/WAV sound files with matching content signatures and target extensions are accepted. Eclipse limits package size, asset count, asset size, and total extraction size; rejects archive traversal, undeclared archive entries, external folder symlinks, duplicate targets, and non-regular Player files; and keeps all imported data and backups in Electron user data. Roblox Player must be completely closed before enabling, disabling, restoring, or removing an active pack. If Player is updated or repaired through Eclipse, originals are restored first and all active packs are disabled for manual compatibility review.

### Enable Discord Rich Presence

Discord Rich Presence is functional in the desktop app through Discord Desktop’s local IPC socket. Create/configure an application named **Eclipse** in the Discord Developer Portal, then use its public **Application ID** either in **Integrations** or as a launch environment value:

```bash
ECLIPSE_DISCORD_CLIENT_ID=123456789012345678 npm run desktop:dev
```

Enable **Show Open Eclipse in Discord** in Integrations while Discord Desktop is running. The presence reads **Open Eclipse** / **Roblox launcher** and clears when Eclipse exits. An Application ID is public—not a client secret; never place a Discord client secret, bot token, or user token in Eclipse.

## Build the Windows installer

Build on a 64-bit Windows machine with Node.js 22 or newer installed:

```bash
npm install
npm run dist:win
```

This creates an NSIS installer in `release/`, named similarly to:

```text
Eclipse-Setup-2.0.5-x64.exe
```

Run that setup executable to choose an installation folder and create Start menu/Desktop shortcuts. The final installer page has **Launch Eclipse** selected by default, so it opens the installed Eclipse application after setup completes. The installer preserves Eclipse’s local data when it is removed.

A portable package remains available only for developer troubleshooting:

```bash
npm run dist:win:portable
```

### Build from GitHub

The repository includes a manual **Build Windows EXE** GitHub Actions workflow. Run it from the Actions tab, then download the `Eclipse-Windows-Installer` artifact after it completes.

> The first EXE build downloads Electron’s Windows runtime and packaging dependencies. Windows SmartScreen may display a warning until Eclipse has code signing and established reputation.

## Verification

```bash
npm run check
npm run test
```

The test suite uses mocked responses from fixed official Roblox endpoints. It verifies discovery response mapping, thumbnail attachment, strict place-ID validation, official Windows Player version and installer validation, and managed Fast Flag migration without sending live Roblox requests.
