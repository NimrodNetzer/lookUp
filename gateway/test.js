/**
 * Quick test — sends a local image to the gateway and prints the result.
 * Usage: node test.js [path-to-image] [mode]
 * Example: node test.js ./sample.png summary
 */
import fs from "fs";
import path from "path";

const GATEWAY = "http://127.0.0.1:18789";
const imagePath = process.argv[2] ?? "./sample.png";
const mode = process.argv[3] ?? "summary";

if (!fs.existsSync(imagePath)) {
  console.error(`Image not found: ${imagePath}`);
  console.error("Usage: node test.js <path-to-image> [summary|explain|quiz]");
  process.exit(1);
}

const ext = path.extname(imagePath).slice(1).toLowerCase();
const mimeType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
const base64 = fs.readFileSync(imagePath).toString("base64");

console.log(`Sending ${imagePath} (${(base64.length / 1024).toFixed(1)} KB base64) in "${mode}" mode...`);

const res = await fetch(`${GATEWAY}/action`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ screenshot: base64, mimeType, mode, title: "test" }),
});

const data = await res.json();

if (!res.ok) {
  console.error("Gateway error:", data.error);
  process.exit(1);
}

console.log("\n--- Saved as:", data.filename, "---\n");
console.log(data.markdown);
