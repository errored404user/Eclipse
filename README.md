# Eclipse

Eclipse is a desktop client experience in early development.

## Current milestone

This repository contains the first **Home screen + app shell** prototype:

- integrated title bar and Eclipse ring mark;
- grouped navigation for Home, Discover, Library, Tools, and Settings;
- account footer and responsive navigation;
- obsidian/violet layered-surface visual system with a subtle starfield;
- hybrid Home overview for activity, presence, and client health.

The UI uses mock content and lightweight interaction states. It does not yet launch or manage Roblox.

## Run in a browser

Requires Node.js 22 or newer.

```bash
npm install
npm start
```

Open `http://localhost:4173`.

## Run as a desktop application

Electron wraps the existing UI in a secure desktop window and enables the custom minimize, maximize/restore, and close controls.

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
Eclipse-0.1.0-preview.1-x64-portable.exe
```

To create a conventional Windows installer with Start menu and desktop shortcut options instead:

```bash
npm run dist:win:installer
```

That creates an NSIS installer in `release/`.

> The first EXE build downloads Electron’s Windows runtime and packaging dependencies. Windows SmartScreen may display a warning until Eclipse has code signing and established reputation.

## Verification

```bash
npm run check
```
