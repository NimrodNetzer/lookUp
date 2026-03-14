# LookUp Extension

Chrome MV3 extension — fully standalone, no local server required.

## Setup (dev)

```bash
cd extension
npm install
npm run build      # compiles src/ → built/
```

Then in Chrome:
1. Go to `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** → select this `extension/` folder
4. Click the LookUp icon → paste your [Groq API key](https://console.groq.com/keys)

## Dev workflow

```bash
npm run dev        # watch mode — rebuilds on file changes
```

After each rebuild, go to `chrome://extensions/` → click **↺** to reload the extension.

## Build output

`npm run build` outputs to `extension/built/` (git-ignored). The zip for Chrome Web Store submission should include `built/` but exclude `node_modules/`, `src/`, and build config files.

## Architecture

- All AI calls go directly to `https://api.groq.com` (no local gateway)
- All data stored in IndexedDB + `chrome.storage.local`
- Dashboard (`built/dashboard.html`) and Chat (`built/chat.html`) are bundled React pages opened as `chrome-extension://` URLs
