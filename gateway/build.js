// Bundles gateway/index.js → gateway/bundle.cjs using esbuild.
// better-sqlite3 is marked external (native .node addon — pkg handles it separately).
import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["index.js"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "bundle.cjs",
  external: ["better-sqlite3"],
  // Polyfill import.meta.url for CJS and wrap in async IIFE for top-level await.
  // __importMetaUrl is defined in the banner so define can reference it by name.
  define: { "import.meta.url": "__importMetaUrl" },
  banner: { js: '(async () => { const __importMetaUrl = require("url").pathToFileURL(__filename).href;' },
  footer: { js: "})();" },
});

console.log("✓ bundle.cjs written");
