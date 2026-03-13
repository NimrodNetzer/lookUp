// Bundles gateway/index.js → gateway/bundle.cjs using esbuild,
// then copies dashboard/out → dist/www and writes dist/Start LookUp.vbs.
import * as esbuild from "esbuild";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");

// ── 1. esbuild bundle ─────────────────────────────────────────────────────────
await esbuild.build({
  entryPoints: ["index.js"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "bundle.cjs",
  external: ["better-sqlite3"],
  define: { "import.meta.url": "__importMetaUrl" },
  banner: { js: '(async () => { const __importMetaUrl = require("url").pathToFileURL(__filename).href;' },
  footer: { js: "})();" },
});
console.log("✓ bundle.cjs written");

// ── 2. Copy dashboard/out → dist/www ─────────────────────────────────────────
const dashOut = path.join(ROOT, "dashboard", "out");
const distWww = path.join(DIST, "www");
if (fs.existsSync(dashOut)) {
  fs.rmSync(distWww, { recursive: true, force: true });
  fs.cpSync(dashOut, distWww, { recursive: true });
  console.log("✓ dashboard/out → dist/www");
} else {
  console.warn("⚠ dashboard/out not found — run `cd dashboard && npm run build` first");
}

// ── 3. Write dist/Start LookUp.vbs ───────────────────────────────────────────
const vbs = `Set sh = CreateObject("WScript.Shell")\nsh.Run chr(34) & "LookUp.exe" & chr(34), 0\nSet sh = Nothing\n`;
fs.writeFileSync(path.join(DIST, "Start LookUp.vbs"), vbs, "utf-8");
console.log("✓ dist/Start LookUp.vbs written");
