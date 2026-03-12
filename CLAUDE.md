# LookUp — Claude Code Instructions

## Project Overview
A 3-part AI-powered study assistant:
- `extension/` — Chrome MV3 side panel (captures screenshots, audio, text selections)
- `gateway/` — Express.js local server on port **18789**, calls Groq API
- `dashboard/` — Next.js app on port **3000** for browsing saved notes & conversations

## Architecture
- **AI**: Groq SDK, model `meta-llama/llama-4-scout-17b-16e-instruct` (vision), `whisper-large-v3-turbo` (audio)
- **Database**: `better-sqlite3` SQLite at `data/lookup.db` (relative to gateway root)
- **Notes**: Markdown files saved to `notes/` (relative to gateway root)
- **Gateway is the source of truth** — extension and dashboard both talk only to `localhost:18789`

## Gateway Endpoints
`/action`, `/session`, `/transcribe`, `/ask`, `/ask-screen`, `/health`, `/notes`, `/stats`, `/activity`, `/chat`, `/conversations/*`, `/command`, `/folders`

## Key Conventions
- Gateway uses **ES Modules** (`"type": "module"`) — always use `import/export`, never `require()`
- Gateway binds to `127.0.0.1:18789` (not `0.0.0.0`) — local only by design
- CORS allows: `chrome-extension://`, `localhost`, `127.0.0.1`
- API key loaded from `gateway/.env` as `GROQ_API_KEY`

## Dev Commands
```bash
# Gateway
cd gateway && npm start          # production
cd gateway && npm run dev        # watch mode

# Dashboard
cd dashboard && npm run dev      # dev server (port 3000)
cd dashboard && npm run build    # production build / static export
```

## Current Branch Strategy
- `main` — stable
- `Features` — active development branch

## Planned Work (approved plan)
Bundling into a single Windows `.exe` for distribution:
1. Next.js static export (`dashboard/out/`)
2. Gateway serves static files + auto-opens browser
3. Extension URL swap: port 3000 → 18789
4. `better-sqlite3` → `sql.js` migration (needed for `@yao-pkg/pkg` bundling)
5. Wrap with `@yao-pkg/pkg` into `LookUp.exe`

## Things to Avoid
- Do NOT use `pkg` (Vercel's original) — it's abandoned. Use `@yao-pkg/pkg`
- Do NOT hardcode `localhost:3000` anywhere — dashboard will be served from port 18789
- Do NOT use CommonJS (`require`) in the gateway — it's ESM only
- Do NOT add `.env` to git — it contains the live Groq API key
