# LookUp — Claude Code Instructions

## Project Overview
A 3-part AI-powered study assistant:
- `extension/` — Chrome MV3 side panel (captures screenshots, audio, text selections)
- `gateway/` — Express.js local server on port **18789**, calls Groq API, also serves the dashboard
- `dashboard/` — Next.js app (static export) served by the gateway at port **18789**

## Architecture
- **AI**: Groq SDK, model `meta-llama/llama-4-scout-17b-16e-instruct` (vision), `whisper-large-v3-turbo` (audio)
- **Database**: `better-sqlite3` SQLite at `data/lookup.db`
- **Notes**: Markdown files saved to `notes/`
- **Gateway is the source of truth** — extension and dashboard both talk only to `localhost:18789`
- **Data paths**: use `process.pkg` guard — when running as exe, paths are relative to `process.execPath`; in dev, relative to project root

## Gateway Endpoints
`/action`, `/session`, `/transcribe`, `/ask`, `/ask-screen`, `/health`, `/notes`, `/stats`, `/activity`, `/chat`, `/conversations/*`, `/command`, `/folders`, `/settings/preferences`

## Key Conventions
- Gateway uses **ES Modules** (`"type": "module"`) — always use `import/export`, never `require()`
- Gateway binds to `127.0.0.1:18789` (not `0.0.0.0`) — local only by design
- CORS allows: `chrome-extension://`, `localhost`, `127.0.0.1`
- API key loaded from `.env` as `GROQ_API_KEY` (in dev: `gateway/.env`, in prod: next to exe)
- Groq client is a **lazy Proxy** in `gateway/groq.js` — instantiated on first use, throws a clear error if key missing
- Dashboard is a **Next.js static export** (`output: 'export'`). Dynamic routes need `generateStaticParams()`
- `express.static` serves `dashboard/out/` in dev, `www/` folder next to exe in prod (pkg virtual FS doesn't work with static serving)

## Build / Distribution
```bash
# Gateway dev
cd gateway && npm start          # production (node)
cd gateway && npm run dev        # watch mode

# Dashboard dev
cd dashboard && npm run dev      # dev server (port 3000)
cd dashboard && npm run build    # static export → dashboard/out/

# Build the exe
cd dashboard && npm run build                    # step 1: build dashboard
cp -r dashboard/out dist/www                     # step 2: copy static files next to exe
cd gateway && npm run build                      # step 3: esbuild → bundle.cjs, then pkg → LookUp.exe
```

The build pipeline: `gateway/index.js` → esbuild (`build.js`) → `bundle.cjs` → `@yao-pkg/pkg` → `dist/LookUp.exe`

## dist/ layout (what gets shipped)
```
dist/
  LookUp.exe       ← pkg binary (gateway bundled)
  .env             ← user pastes GROQ_API_KEY here
  README.txt       ← setup instructions
  extension/       ← load unpacked in Chrome
  www/             ← pre-built Next.js dashboard (real files, not inside exe)
```

## Things to Avoid
- Do NOT use `pkg` (Vercel's original) — it's abandoned. Use `@yao-pkg/pkg`
- Do NOT hardcode `localhost:3000` anywhere — dashboard is served from port 18789
- Do NOT use CommonJS (`require`) in the gateway — it's ESM only
- Do NOT add `.env` to git — it contains the live Groq API key
- Do NOT commit `dist/`, `LookUp/`, `LookUp.zip`, or `gateway/bundle.cjs` — all are build artifacts

## Next Planned Work
1. **Grandma-proof UX**: first-run setup screen in the dashboard (paste API key via UI, no file editing), hide the CMD window via `.vbs` launcher
2. **Chrome Web Store publish**: package `extension/` for submission
3. **Auto-update banner**: gateway checks GitHub Releases on startup, shows "Update available" in the dashboard
