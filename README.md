# LookUp — Study Sensei

> An AI-powered study assistant that lives in your browser's side panel.
> Capture screens, record audio, select text — and get instant summaries, formulas, and Q&A, powered by Groq.

---

## What it does

- **Screenshot capture** — grab your active tab and ask the AI anything about it
- **Audio transcription** — record tab audio and get a transcript via Groq Whisper
- **Text selection** — highlight text on any page and send it as context
- **Chat** — a persistent AI chat with full conversation history
- **Notes** — save AI responses as markdown notes, organised into folders
- **Dashboard** — browse and search all your saved notes and conversations

No server. No subscription. Just load the extension, paste your free [Groq API key](https://console.groq.com/keys), and go.

---

## Getting started

### Option A — Load unpacked (dev / personal use)

```bash
cd extension
npm install
npm run build
```

Then in Chrome:
1. Go to `chrome://extensions/`
2. Enable **Developer mode**
3. **Load unpacked** → select the `extension/` folder
4. Click the LookUp icon in the toolbar → enter your Groq API key

### Option B — Chrome Web Store *(coming soon)*

Search for **LookUp Study Sensei** in the Chrome Web Store and click **Add to Chrome**.

---

## Tech stack

| Layer | What |
|---|---|
| Extension UI | React 18 + Tailwind CSS, bundled with Vite |
| AI | [Groq API](https://console.groq.com) — `llama-4-scout-17b` (vision/chat), `whisper-large-v3-turbo` (audio) |
| Storage | IndexedDB (notes, conversations) + `chrome.storage.local` (key, prefs) |
| Build output | `extension/built/` — Vite multi-page build |

Everything runs entirely in your browser. Your data is sent only to Groq for AI processing and stored locally on your device.

---

## Project structure

```
extension/          ← standalone Chrome extension (Extension Mode)
  manifest.json
  sidepanel.html / sidepanel.js   ← capture UI
  storage.js                      ← IndexedDB + chrome.storage.local
  groq-client.js                  ← direct Groq API calls + SSE streaming
  src/                            ← React source (App, ChatPage, HomePage, NotesList…)
  built/                          ← Vite output (gitignored — run npm run build)

gateway/            ← Classic Mode: Express.js local server (port 18789)
dashboard/          ← Classic Mode: Next.js dashboard (static export)
docs/               ← GitHub Pages (privacy policy)
```

> **Classic Mode** (gateway + exe) is an alternative setup for power users who want a local SQLite database and a full desktop dashboard. The Chrome extension works identically in both modes.

---

## Dev workflow

```bash
# Extension Mode — watch + rebuild on save
cd extension && npm run dev
# Then reload in chrome://extensions/ after each build

# Classic Mode — gateway + dashboard
cd gateway && npm run dev          # Express server on :18789
cd dashboard && npm run dev        # Next.js hot-reload on :3000
```

---

## Privacy

LookUp sends your screenshots, audio, and text **only to Groq**, and only when you explicitly trigger an action. No analytics, no tracking, no data sent to any server we operate.

Full privacy policy: [docs/privacy-policy.html](docs/privacy-policy.html)

---

## Requirements

- Chrome 114+ (for Side Panel API)
- A free [Groq API key](https://console.groq.com/keys)

---

## License

MIT
