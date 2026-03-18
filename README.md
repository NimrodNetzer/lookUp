# LookUp — Study Sensei

> An AI-powered study assistant that lives in your browser's side panel.
> Capture screens, record audio, select text — and get instant summaries, explanations, flashcards, and Q&A, powered by Groq.

---

## Features

| Capture | Learn | Organise |
|---------|-------|----------|
| Screenshot any tab | AI summaries & explanations | Save notes as markdown |
| Record tab audio (Whisper) | Quiz & flashcard generation | Folders + global search |
| Highlight text on any page | Math rendering (KaTeX) | Full conversation history |
| PDF viewer built-in | Learning Hub | Dashboard with note browser |

**New in recent releases:**
- **Focus mode** — hide the UI chrome for distraction-free reading
- **Zoom controls** — Ctrl+wheel / Ctrl+± / Ctrl+0, persisted across sessions
- **Flashcard viewer** — review AI-generated flashcards from any note
- **Learning Hub** — curated study flows in one place
- **Global search** — search across all notes and conversations at once
- **Command chat** — quick-fire questions without opening a full conversation

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
4. Click the LookUp icon → enter your Groq API key

### Option B — Chrome Web Store *(coming soon)*

Search for **LookUp Study Sensei** and click **Add to Chrome**.

---

## Tech stack

| Layer | What |
|-------|------|
| Extension UI | React 18 + Tailwind CSS, bundled with Vite |
| AI | [Groq API](https://console.groq.com) — `llama-4-scout-17b` (vision/chat), `whisper-large-v3-turbo` (audio) |
| Math rendering | KaTeX (inline `$...$` and block `$$...$$`) |
| Storage | IndexedDB (notes, conversations, folders) + `chrome.storage.local` (key, prefs) |
| PDF | PDF.js (vendor bundle) — in-extension PDF viewer |
| Build | Vite multi-page build → `extension/built/` |

Everything runs entirely in your browser. Your data is sent only to Groq for AI processing and stored locally on your device.

---

## Project structure

```
extension/              ← standalone Chrome extension
  manifest.json
  sidepanel.html/js     ← capture UI (zoom, focus mode, screenshots, audio)
  storage.js            ← IndexedDB + chrome.storage.local
  groq-client.js        ← Groq API calls + SSE streaming
  mic-permission.html   ← mic permission prompt
  pdf-viewer.html       ← built-in PDF viewer
  src/                  ← React pages & components
    ChatPage.jsx          conversations
    HomePage.jsx          home/dashboard
    NoteViewer.jsx        note detail
    LearningHub.jsx       study flows
    FlashcardViewer.jsx   flashcard review
    GlobalSearch.jsx      cross-note search
    CommandChat.jsx       quick chat
    NotesList.jsx         notes list
  vendor/               ← bundled third-party libs (KaTeX, PDF.js, JSZip)
  built/                ← Vite output (gitignored — run npm run build)
  tests/                ← Vitest unit tests
  e2e/                  ← Playwright end-to-end tests

gateway/                ← Classic Mode: Express.js local server (port 18789)
dashboard/              ← Classic Mode: Next.js dashboard (static export)
docs/                   ← GitHub Pages (privacy policy)
```

> **Classic Mode** (gateway + exe) is an alternative for power users who want a local SQLite database and a full desktop dashboard. The Chrome extension works identically in both modes.

---

## Dev workflow

### Extension Mode

```bash
# Watch mode — auto-rebuild on save
cd extension && npm run dev
# Reload in chrome://extensions/ after each build

# Single build
cd extension && npm run build
```

### Classic Mode

```bash
cd gateway && npm run dev       # Express server on :18789
cd dashboard && npm run dev     # Next.js hot-reload on :3000
```

---

## Testing

```bash
# Unit tests (gateway)
cd gateway && npm test

# Unit tests (extension)
cd extension && npm test

# End-to-end tests (Playwright)
cd extension && npm run test:e2e
cd extension && npm run test:e2e:ui   # interactive UI
```

---

## Privacy

LookUp sends your screenshots, audio, and text **only to Groq**, and only when you explicitly trigger an action. No analytics, no tracking, no data sent to any server we operate.

Full privacy policy: [docs/privacy-policy.html](docs/privacy-policy.html)

---

## Requirements

- Chrome 114+ (Side Panel API)
- A free [Groq API key](https://console.groq.com/keys)

---

## License

MIT
