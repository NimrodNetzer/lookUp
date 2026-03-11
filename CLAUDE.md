# CLAUDE.md — LookUp Codebase Guide

LookUp is a full-stack AI-powered learning platform consisting of three components:
1. **Chrome Extension** — captures screenshots, audio, and text selections
2. **Gateway API** — Express.js backend that calls Groq LLM and persists notes
3. **Dashboard** — Next.js web app for reviewing and organizing notes

---

## Repository Structure

```
lookUp/
├── extension/          # Chrome MV3 extension (vanilla JS)
│   ├── manifest.json
│   ├── background.js   # Service worker — opens side panel on icon click
│   ├── content.js      # Text selection detection (injected into all pages)
│   ├── sidepanel.js    # Main extension UI logic (~544 lines)
│   ├── sidepanel.html  # Extension UI (styles embedded, loads sidepanel.js)
│   ├── generate-icons.mjs
│   └── icons/
├── gateway/            # Node.js Express API server
│   ├── index.js        # All routes (~495 lines)
│   ├── db.js           # SQLite layer (better-sqlite3, ~196 lines)
│   ├── groq.js         # Groq SDK + prompts (~278 lines)
│   ├── list-models.js  # Utility to list available Groq models
│   ├── test.js         # Local test script: node test.js <image> [mode]
│   ├── package.json
│   └── package-lock.json
├── dashboard/          # Next.js 14 app (App Router, TypeScript)
│   ├── app/
│   │   ├── layout.tsx          # Root layout (KaTeX CSS, metadata)
│   │   ├── page.tsx            # Home page — learning hub
│   │   ├── chat/page.tsx       # Full-page chat interface
│   │   ├── note/[filename]/page.tsx
│   │   ├── globals.css
│   │   └── components/
│   │       ├── LearningHub.tsx     # Folder nav, breadcrumbs, drag-and-drop (~446 lines)
│   │       ├── NotesList.tsx       # Filtering, sorting, merge, move (~464 lines)
│   │       ├── CommandChat.tsx     # AI natural-language organizer (~110 lines)
│   │       ├── FlashcardViewer.tsx # Flip card UI (~64 lines)
│   │       └── FolderTree.tsx      # Folder hierarchy display
│   ├── package.json
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   └── next.config.mjs
├── notes/              # Runtime markdown notes storage (gitignored)
├── data/               # SQLite database: data/lookup.db (gitignored)
└── image.png
```

---

## Tech Stack

| Layer      | Technology                                                       |
|------------|------------------------------------------------------------------|
| Extension  | Chrome MV3, vanilla JavaScript                                   |
| Gateway    | Node.js (ES modules), Express 4, better-sqlite3, Groq SDK 0.9   |
| Dashboard  | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS 3   |
| AI         | Groq API — `meta-llama/llama-4-scout-17b-16e-instruct` + Whisper |
| Storage    | Markdown files (notes), JSON sidecar files (flashcards), SQLite  |

---

## Development Setup

### Prerequisites
- Node.js (v18+)
- A [Groq API key](https://console.groq.com)

### Environment
Create `gateway/.env`:
```
GROQ_API_KEY=your_key_here
```
There is no `.env.example` — add one if missing.

### Running Gateway
```bash
cd gateway
npm install
npm run dev        # node --watch index.js
# OR
npm start          # node index.js
```
Gateway listens on `http://localhost:18789` (localhost only).

### Running Dashboard
```bash
cd dashboard
npm install
npm run dev        # next dev (port 3000 by default)
npm run build      # production build
npm start          # serve production build
```

### Loading the Extension
1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `extension/` folder

### Testing the Gateway Manually
```bash
cd gateway
node test.js path/to/image.jpg [mode]
# mode options: summary (default), explain, quiz, flashcard
```

---

## Gateway API Reference

Base URL: `http://localhost:18789`

| Method | Path                        | Purpose                                     |
|--------|-----------------------------|---------------------------------------------|
| GET    | `/health`                   | Health check                                |
| POST   | `/action`                   | Analyze single screenshot                   |
| POST   | `/session`                  | Analyze multi-page screenshots              |
| POST   | `/ask-screen`               | Screenshot + user question                  |
| POST   | `/ask`                      | Text selection query (no image)             |
| POST   | `/transcribe`               | Audio capture + transcription + summary     |
| GET    | `/notes`                    | List all notes (with metadata)              |
| GET    | `/notes/:filename`          | Get single note content                     |
| PATCH  | `/notes/:filename`          | Update note metadata (course, title, folder)|
| DELETE | `/notes/:filename`          | Delete a note                               |
| POST   | `/notes/merge`              | Merge multiple notes into one               |
| GET    | `/stats`                    | Total notes, streak, weekly captures        |
| GET    | `/activity`                 | 365-day activity data (for heatmap)         |
| POST   | `/chat`                     | Send message to persistent conversation     |
| GET    | `/conversations/active`     | Get current active conversation             |
| POST   | `/chat/clear`               | Clear/reset active conversation             |
| GET    | `/settings/preferences`     | Get user preferences                        |
| POST   | `/settings/preferences`     | Save user preferences                       |
| GET    | `/folders`                  | Get full folder tree                        |
| POST   | `/folders`                  | Create a folder                             |
| PATCH  | `/folders/:id`              | Rename a folder                             |
| DELETE | `/folders/:id`              | Delete a folder (cascade deletes children)  |
| POST   | `/command`                  | Natural language organization command       |

### Analysis Modes (`/action`, `/session`)
- `summary` — Structured overview with key concepts
- `explain` — Conversational deep explanation (beginner-friendly)
- `quiz` — 5 Q&A questions
- `flashcard` — JSON array of `{front, back}` pairs
- `session` — Multi-slide unified narrative summary (only for `/session`)

### CORS
Allowed origins: `chrome-extension://*`, `http://localhost:*`, `http://127.0.0.1:*`

---

## Database Schema (SQLite — `data/lookup.db`)

```sql
-- Daily activity for streak calculation
CREATE TABLE activity (
  date TEXT PRIMARY KEY,   -- YYYY-MM-DD
  count INTEGER DEFAULT 0
);

-- Key-value settings store
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Nested folder hierarchy
CREATE TABLE folders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  parent_id  INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Persistent chat conversations
CREATE TABLE conversations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT,
  messages   TEXT NOT NULL DEFAULT '[]',  -- JSON array
  folder_id  INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

---

## File Storage Conventions

Notes are stored in the `notes/` directory as markdown files:

**Filename format**: `YYYY-MM-DDTHH.MM.SS_slug.md`
- Example: `2024-01-15T14.30.00_lecture-5-intro-to-ml.md`
- Generated by `makeTimestamp()` + `makeSlug()` in `gateway/index.js`

**YAML frontmatter** (in each `.md` file):
```yaml
---
title: "Lecture 5: Intro to ML"
mode: summary
course: CS101
folder_id: 3
timestamp: 2024-01-15T14.30.00
---
```

**Flashcard sidecar files**: `<same-name>.cards.json`
- Array of `{front: string, back: string}` objects
- Only created when mode is `flashcard`

---

## Key Code Conventions

### Gateway (`index.js`)
- All routes are in a single file — no router splitting
- Helper functions defined before routes: `makeTimestamp()`, `makeSlug()`, `saveNote()`, `mergeNotes()`, `updateNoteFrontmatter()`
- Notes written to `../notes/` relative to `gateway/` (i.e., repo root `notes/`)
- Base64-encoded images sent from extension, decoded in gateway before Groq call
- Audio sent as raw bytes, saved to temp file, transcribed via Whisper, then deleted

### Groq Integration (`groq.js`)
- All LLM calls go through dedicated functions — do not call `groq.chat.completions.create()` directly from `index.js`
- Temperature: `0.4` for analysis, `0.6` for chat, `0.1` for command parsing
- System prompt enforces privacy: detects passwords, SSNs, credit card numbers and refuses to include them in output
- `processCommand()` returns structured JSON actions (`merge`, `rename`, `categorize`)

### Database (`db.js`)
- Uses synchronous better-sqlite3 (no async/await needed for DB calls)
- All DB initialization happens at module load — tables created with `IF NOT EXISTS`
- Conversations stored as JSON-serialized message arrays in a TEXT column

### Dashboard Components
- Dashboard uses Next.js App Router — prefer Server Components for data fetching, Client Components for interactivity
- `'use client'` is required for components using `useState`, `useEffect`, drag-and-drop, etc.
- `LearningHub.tsx` and `NotesList.tsx` are large client components — consider extracting sub-components when adding features
- Notes list page uses `revalidate: 0` to always fetch fresh data

### Extension
- `content.js` must handle the case where `chrome.runtime` is undefined (e.g., Gemini pages block it)
- Text selection debounced at 250ms; minimum 3 characters before relaying
- Gateway health checked every 10 seconds; status shown in side panel UI
- All API calls go to `http://127.0.0.1:18789` (not localhost — avoids some browser DNS issues)

### Styling
- Dark theme across all surfaces — do not introduce light theme elements without a theme toggle
- Color palette:
  - Background: `#0f0f13`
  - Surface: `#1a1a2e`
  - Accent purple: `#7c6af5`
  - Accent teal: `#5eead4`
- Type badges are color-coded by mode (summary, explain, quiz, flashcard, session, audio)
- KaTeX CSS is loaded globally in `layout.tsx` for math rendering

---

## Architecture Decisions

1. **Local-first**: All data stays on the user's machine. No external database, no user accounts.
2. **Markdown storage**: Notes are plain markdown files — human-readable, easily backed up, version-controllable.
3. **No ORM**: Raw better-sqlite3 for simplicity and zero overhead.
4. **Single API file**: All gateway routes in `index.js` for discoverability — split only when the file exceeds maintainability.
5. **ES Modules throughout**: Both gateway and dashboard use ESM (`"type": "module"` in gateway).
6. **Mode-based prompting**: The `mode` parameter drives the entire prompt and output format — new modes are added by extending the `modePrompts` object in `groq.js`.

---

## Adding New Features

### New Analysis Mode
1. Add a new key to `modePrompts` in `gateway/groq.js`
2. Add the mode option to the dropdown in `extension/sidepanel.html`
3. Handle rendering of the new output format in `extension/sidepanel.js`
4. Add a type badge color in `dashboard/app/components/NotesList.tsx`

### New Gateway Endpoint
1. Add the route in `gateway/index.js`
2. If it needs DB access, add a helper in `gateway/db.js`
3. Update the API Reference table in this file

### New Dashboard Page
1. Create `dashboard/app/<route>/page.tsx`
2. Mark as `'use client'` only if interactivity is needed
3. Fetch from gateway using `fetch('http://localhost:18789/...')`

---

## Testing

There is no automated test suite. Testing is manual:
- **Gateway**: Use `gateway/test.js` or send HTTP requests directly (curl, Postman, etc.)
- **Extension**: Load unpacked in Chrome DevTools, use console for debugging
- **Dashboard**: `npm run dev` and test in browser

When adding significant features, consider adding a test case to `gateway/test.js`.

---

## Common Issues

| Issue | Solution |
|-------|----------|
| Gateway not reachable from extension | Ensure gateway is running on port 18789; check CORS origin matches extension ID |
| `GROQ_API_KEY` errors | Create `gateway/.env` with a valid key |
| Notes not showing in dashboard | Check `notes/` directory exists at repo root; dashboard reads from `../notes/` relative to `gateway/` |
| SQLite errors on first run | `data/` directory is created automatically; ensure write permissions |
| Extension content script errors on some pages | Expected — `chrome.runtime` may be blocked; handled with try/catch in `content.js` |
