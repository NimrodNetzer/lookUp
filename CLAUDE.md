# LookUp — Claude Code Instructions

## Project Overview
A study assistant with two modes:

**Classic Mode (gateway + exe):**
- `extension/` — Chrome MV3 side panel (captures screenshots, audio, text selections)
- `gateway/` — Express.js local server on port **18789**, calls Groq API, also serves the dashboard
- `dashboard/` — Next.js app (static export) served by the gateway at port **18789**

**Extension Mode (standalone, no server needed):**
- `extension/` — Fully self-contained Chrome extension
- Calls Groq API directly from the extension (`https://api.groq.com`)
- All data stored in IndexedDB + `chrome.storage.local` — no gateway, no exe
- Dashboard and chat page bundled as Vite/React pages inside the extension (`built/`)
- Distributable as a zip — users just load unpacked in Chrome

## Architecture

### Classic Mode
- **AI**: Groq SDK, model `meta-llama/llama-4-scout-17b-16e-instruct` (vision), `whisper-large-v3-turbo` (audio)
- **Database**: `better-sqlite3` SQLite at `data/lookup.db`
- **Notes**: Markdown files saved to `notes/`
- **Gateway is the source of truth** — extension and dashboard both talk only to `localhost:18789`
- **Data paths**: use `process.pkg` guard — when running as exe, paths are relative to `process.execPath`; in dev, relative to project root

### Extension Mode
- **AI**: Direct REST calls to `https://api.groq.com/openai/v1` using fetch
- **Models**: `meta-llama/llama-4-scout-17b-16e-instruct` (vision/chat), `whisper-large-v3-turbo` (audio)
- **Storage**: IndexedDB (notes, conversations, messages, folders) + `chrome.storage.local` (API key, prefs)
- **Key files**:
  - `extension/storage.js` — all DB operations (Notes, Conversations, Messages, Folders, Settings)
  - `extension/groq-client.js` — direct Groq API calls, `chatStream()` async generator for SSE streaming
  - `extension/src/` — React components (see layout section for full list)
  - `extension/vite.config.js` — multi-page build (dashboard.html + chat.html → `built/`)
- **Build output**: `extension/built/` — do NOT edit manually, always rebuild via Vite
- **Notes field**: uses `mode` (not `type`), `modified` alias alongside `updatedAt`

## Gateway Endpoints (Classic Mode)
`/action`, `/session`, `/transcribe`, `/ask`, `/ask-screen`, `/health`, `/notes`, `/stats`, `/activity`, `/chat`, `/conversations/*`, `/command`, `/folders`, `/settings/preferences`, `/setup/status`, `/setup/apikey`

## Key Conventions
- Gateway uses **ES Modules** (`"type": "module"`) — always use `import/export`, never `require()`
- Gateway binds to `127.0.0.1:18789` (not `0.0.0.0`) — local only by design
- CORS allows: `chrome-extension://`, `localhost`, `127.0.0.1`
- API key loaded from `.env` as `GROQ_API_KEY` (in dev: `gateway/.env`, in prod: next to exe)
- Groq client is a **lazy Proxy** in `gateway/groq.js` — instantiated on first use, throws a clear error if key missing
- Dashboard is a **Next.js static export** (`output: 'export'`). Dynamic routes need `generateStaticParams()`
- `express.static` serves `dashboard/out/` in dev, `www/` folder next to exe in prod (pkg virtual FS doesn't work with static serving)
- Vite must use `base: ""` (empty string) — Chrome extensions need relative asset paths, not absolute `/assets/...`

## Math / Symbol Rendering

Math rendering is fully supported across all surfaces:

- **Groq prompts**: `buildSystemPrompt()` in `extension/groq-client.js` instructs the AI to use LaTeX notation — inline `$...$` and block `$$...$$`. All modes (summary, explain, quiz, flashcard, audio) inherit this.
- **Sidepanel** (`sidepanel.js` / `sidepanel.html`): Uses **KaTeX** (`vendor/katex.min.js` + `vendor/katex.min.css`). `renderMath(expr, displayMode)` calls `katex.renderToString()`. Falls back to escaped plain text if KaTeX is unavailable.
- **Dashboard note viewer** (`dashboard/app/note/[filename]/`): Uses `remark-math` + `rehype-katex` with `ReactMarkdown`. KaTeX CSS loaded globally in `layout.tsx`.
- **KaTeX vendor files**: `extension/vendor/katex.min.js`, `extension/vendor/katex.min.css`, `extension/vendor/fonts/` — committed to git (same pattern as jszip/pdf vendor files). Sourced from `node_modules/katex/dist/`.

## Testing

Both the gateway and extension have automated test suites using **Vitest**.

### Gateway tests (`gateway/tests/`)
```bash
cd gateway && npm test           # run all tests once
cd gateway && npm run test:watch # watch mode
```
| File | What it covers |
|------|----------------|
| `routes.test.js` | All API routes (mocked db + groq + fs) |
| `db.test.js` | SQLite layer — all db.js functions |
| `groq-helpers.test.js` | Prompt builders, slug/timestamp helpers |
| `security.test.js` | CORS, auth, input validation |
| `e2e.test.js` | End-to-end flow with real SQLite (in-memory) |

### Extension tests (`extension/tests/`)
```bash
cd extension && npm test             # run all unit tests once
cd extension && npm run test:watch   # watch mode
cd extension && npm run test:e2e     # Playwright e2e tests
cd extension && npm run test:e2e:ui  # Playwright interactive UI
```
| File | What it covers |
|------|----------------|
| `storage.test.js` | IndexedDB + chrome.storage (fake-indexeddb mock) |
| `groq-client.test.js` | API calls, chatStream(), token tracking |
| `components.test.jsx` | React components (Vitest + jsdom) |
| `components-extended.test.jsx` | Additional component tests |
| `noteviewer-parsing.test.js` | Markdown + math rendering pipeline |
| `security.test.js` | API key handling, XSS, input sanitisation |
| `setup.js` | Shared mock setup (chrome APIs, fetch, IndexedDB) |

### E2E tests (`extension/e2e/`)
Uses **Playwright** (`playwright.config.js`). Tests run against the built extension.
| File | What it covers |
|------|----------------|
| `chat.test.js` | Chat page flows |
| `dashboard.test.js` | Dashboard page flows |
| `fixtures.js` | Shared Playwright fixtures |

### Run all tests
```bash
# Gateway
cd gateway && npm test

# Extension (unit)
cd extension && npm test

# Extension (e2e)
cd extension && npm run test:e2e
```

Always run tests after touching `groq-client.js`, `storage.js`, `sidepanel.js`, gateway routes, or `db.js`.

---

## Dev Workflow — How to See Changes Live

### Working on the Gateway (`gateway/`)
```bash
cd gateway && npm run dev        # starts gateway on :18789 with auto-reload
```
Dashboard is served at **http://localhost:18789** automatically (no separate step).

### Working on the Dashboard (`dashboard/`)
The dashboard is a Next.js static export — changes are NOT hot-reloaded from the gateway.
Two options:

**Option A — Fast iteration (Next.js dev server, hot-reload):**
```bash
# Terminal 1
cd gateway && npm run dev        # gateway must run for API calls

# Terminal 2
cd dashboard && npm run dev      # Next.js dev server → http://localhost:3000
```
Open **http://localhost:3000**. Changes reflect instantly.

**Option B — Test exactly as production:**
```bash
cd dashboard && npm run build    # rebuild static export → dashboard/out/
cd gateway && npm run dev        # gateway serves dashboard/out/ at :18789
```
Open **http://localhost:18789**. Must re-run `npm run build` after each dashboard change.

### Working on the Extension (`extension/`)

**Extension Mode (React components, storage, groq-client):**
```bash
cd extension && npm run build    # rebuild → extension/built/
# Then in chrome://extensions/ → ↺ refresh LookUp
```

**Watch mode (auto-rebuild on save):**
```bash
cd extension && npm run dev      # Vite watch mode
# Still need to ↺ refresh in chrome://extensions/ after each rebuild
```

**Files that don't need a rebuild** (plain JS, loaded directly):
- `extension/sidepanel.js`, `extension/manifest.json`, `extension/storage.js`, `extension/groq-client.js`
- Just reload the extension in `chrome://extensions/`

### Typical full-stack dev session (Classic Mode)
```bash
# Terminal 1 — gateway (auto-reloads on gateway file changes)
cd gateway && npm run dev

# Terminal 2 — dashboard hot-reload
cd dashboard && npm run dev
# Open http://localhost:3000

# Extension changes: edit → refresh in chrome://extensions/
```

---

## Build / Distribution

### Classic Mode (exe)
```bash
# Gateway dev
cd gateway && npm start          # production (node)
cd gateway && npm run dev        # watch mode

# Dashboard dev
cd dashboard && npm run dev      # dev server (port 3000)
cd dashboard && npm run build    # static export → dashboard/out/

# Build the exe (two steps)
cd dashboard && npm run build    # step 1: static export → dashboard/out/
cd gateway && npm run build      # step 2: esbuild bundle → copies www + writes .vbs → pkg → LookUp.exe
```

The build pipeline: `gateway/index.js` → esbuild (`build.js`) → `bundle.cjs` → `@yao-pkg/pkg` → `dist/LookUp.exe`
`build.js` also copies `dashboard/out/ → dist/www/` and writes `dist/Start LookUp.vbs` automatically.

### Extension Mode (Chrome Web Store / zip)
```bash
cd extension && npm install      # first time only
cd extension && npm run build    # Vite build → extension/built/
```

To share with someone: zip the `extension/` folder (including `built/`, `vendor/`, excluding `node_modules/` and `src/`).
Users load unpacked in Chrome — no server, no Node.js needed. API key entered on first launch.

## dist/ layout (Classic Mode — what gets shipped)
```
dist/
  LookUp.exe          ← pkg binary (gateway bundled)
  Start LookUp.vbs    ← launcher — hides CMD window; users double-click this
  README.txt          ← setup instructions (no .env editing needed)
  extension/          ← load unpacked in Chrome
  www/                ← pre-built Next.js dashboard (real files, not inside exe)
```
Note: no `.env` needed in dist anymore — first-run setup screen handles API key entry.

## extension/ layout (Extension Mode)
```
extension/
  manifest.json
  sidepanel.html / sidepanel.js   ← capture UI (screenshots, audio, text, zoom, focus mode)
  storage.js                      ← IndexedDB + chrome.storage.local
  groq-client.js                  ← direct Groq API, chatStream() generator
  mic-permission.html / mic-permission.js   ← mic permission prompt page
  pdf-viewer.html / pdf-viewer.js           ← in-extension PDF viewer
  src/                            ← React source (do not reference directly from manifest)
    App.jsx                       ← root + routing
    ChatPage.jsx                  ← conversation/chat UI
    HomePage.jsx                  ← main dashboard/home
    NotesList.jsx                 ← notes list component
    NoteViewer.jsx                ← note detail/viewer
    LearningHub.jsx               ← learning hub page
    CommandChat.jsx               ← command/quick chat
    GlobalSearch.jsx              ← cross-note search
    FlashcardViewer.jsx           ← flashcard review UI
    CosmicBg.jsx                  ← background animation
    chat-main.jsx                 ← Vite entry for chat.html
    dashboard-main.jsx            ← Vite entry for dashboard.html
    globals.css
  dashboard.html / chat.html      ← Vite entry points
  vite.config.js / tailwind.config.js / postcss.config.js / package.json
  playwright.config.js            ← Playwright e2e config
  vendor/                         ← third-party JS bundles (committed to git)
    katex.min.js / katex.min.css / fonts/   ← KaTeX math rendering
    jszip.min.js                  ← ZIP export
    pdf.min.js / pdf.worker.min.js          ← PDF.js
  tests/                          ← Vitest unit test suite
  e2e/                            ← Playwright e2e tests
    chat.test.js / dashboard.test.js / fixtures.js
  built/                          ← Vite output (gitignored, must build before loading)
    dashboard.html
    chat.html
    assets/
```

### Sidepanel Features
- **Zoom controls**: Ctrl+wheel, Ctrl+±, Ctrl+0. Persisted via `Settings.setPreferences({ sidepanelZoom })`. Steps defined in `ZOOM_STEPS` with `BASE_ZOOM = 0.9`.
- **Focus mode**: toggle via `#focusModeBtn` / `#exitFocusBtn`. Stored in `chrome.storage.local`. Applies `body.classList.toggle("focus-mode")`.

## Things to Avoid
- Do NOT use `pkg` (Vercel's original) — it's abandoned. Use `@yao-pkg/pkg`
- Do NOT hardcode `localhost:3000` anywhere — dashboard is served from port 18789
- Do NOT use CommonJS (`require`) in the gateway — it's ESM only
- Do NOT add `.env` to git — it contains the live Groq API key
- Do NOT commit `dist/`, `LookUp/`, `LookUp.zip`, or `gateway/bundle.cjs` — all are build artifacts
- Do NOT commit `extension/built/` or `extension/node_modules/` — build artifacts
- Do NOT use absolute Vite `base` (`/assets/...`) — Chrome extensions need relative paths (`base: ""`)
- Do NOT use `type` field for notes — use `mode` everywhere in extension storage
- Do NOT edit `extension/built/` manually — always rebuild via `npm run build`

## Manifest Permissions
All declared permissions are actively used. Key ones:
- `"windows"` — required for window picker (`chrome.windows.*` in sidepanel.js and ChatPage.jsx)
- `"tabs"` — `chrome.tabs.create`, `tabs.query`, `captureVisibleTab`
- `"tabCapture"` — audio recording via `getMediaStreamId`
- `"offscreen"` — mic recording via offscreen document
- `<all_urls>` host permission — required for content script (text selection on all pages) + `captureVisibleTab` on any tab. Must be justified in Web Store listing.

### Web-Accessible Resources
- `mic-permission.html` / `mic-permission.js` — mic permission prompt (opened as a tab)
- `pdf-viewer.html` / `pdf-viewer.js` — PDF viewer page (opened as a tab)

## Next Planned Work
1. **Chrome Web Store publish**: submit `extension/` zip for review
2. **Auto-update banner**: gateway checks GitHub Releases on startup, shows "Update available" in the dashboard

## Recently Shipped Features
- **Zoom controls** in sidepanel (Ctrl+wheel / Ctrl+± / Ctrl+0), persisted to preferences
- **Focus mode** in sidepanel — hides non-essential UI for distraction-free reading
- **Playwright e2e tests** (`extension/e2e/`) covering chat and dashboard flows
- **PDF viewer** (`pdf-viewer.html/js`) — in-extension PDF rendering via PDF.js
- **FlashcardViewer**, **LearningHub**, **CommandChat**, **GlobalSearch** — new React pages
- **Feedback & usage tracking** in ChatMenuDropdown
- **Portfolio/contact links** in footer and navigation
