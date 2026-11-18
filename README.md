# Eclipse

Eclipse is a desktop client experience in early development.

## Current prototype

This repository currently contains the first **Home screen + app shell** visual prototype:

- integrated title bar and Eclipse ring mark;
- grouped left navigation for Home, Discover, Library, Tools, and Settings;
- account footer and responsive mobile navigation;
- obsidian/violet layered-surface visual system with a subtle starfield;
- hybrid Home overview for activity, presence, and client health.

Run it locally with Node.js 22+:

```bash
npm start
```

Then open `http://localhost:4173`. Verify syntax with:

```bash
npm run check
```

The prototype is intentionally dependency-free and uses no network calls. It is a visual foundation for the native Eclipse desktop client.
