// Generates icons/icon16.png, icon48.png, icon128.png for LookUp
// Run once: node generate-icons.mjs
import zlib from "zlib";
import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Minimal PNG encoder ───────────────────────────────────────────────────────
function crc32(buf) {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = t[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const tb = Buffer.from(type, "ascii");
  const lb = Buffer.allocUnsafe(4); lb.writeUInt32BE(data.length);
  const cb = Buffer.allocUnsafe(4); cb.writeUInt32BE(crc32(Buffer.concat([tb, data])));
  return Buffer.concat([lb, tb, data, cb]);
}

function encodePNG(pixels, size) {
  const sig  = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8]=8; ihdr[9]=6; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;

  const rows = [];
  for (let y = 0; y < size; y++) {
    rows.push(0);
    for (let x = 0; x < size; x++) {
      const i = (y*size+x)*4;
      rows.push(pixels[i], pixels[i+1], pixels[i+2], pixels[i+3]);
    }
  }
  const idat = zlib.deflateSync(Buffer.from(rows));
  return Buffer.concat([sig, pngChunk("IHDR",ihdr), pngChunk("IDAT",idat), pngChunk("IEND",Buffer.alloc(0))]);
}

// ── Icon drawing ──────────────────────────────────────────────────────────────
function lerp(a, b, t) { return a + (b-a)*t; }

function drawIcon(size) {
  const px = new Uint8Array(size*size*4);

  function set(x, y, r, g, b, a=255) {
    x = Math.round(x); y = Math.round(y);
    if (x<0||x>=size||y<0||y>=size) return;
    const i=(y*size+x)*4;
    // Alpha blend over existing
    const sa = a/255, da = px[i+3]/255;
    const oa = sa + da*(1-sa);
    if (oa===0) return;
    px[i]   = Math.round((r*sa + px[i]  *da*(1-sa))/oa);
    px[i+1] = Math.round((g*sa + px[i+1]*da*(1-sa))/oa);
    px[i+2] = Math.round((b*sa + px[i+2]*da*(1-sa))/oa);
    px[i+3] = Math.round(oa*255);
  }

  function circle(cx, cy, r, r2, g2, b2, a=255) {
    for (let y=Math.floor(cy-r-1); y<=cy+r+1; y++) {
      for (let x=Math.floor(cx-r-1); x<=cx+r+1; x++) {
        const d = Math.sqrt((x-cx)**2+(y-cy)**2);
        if (d <= r) {
          const aa = Math.max(0, Math.min(1, r-d+0.5));
          set(x, y, r2, g2, b2, Math.round(a*aa));
        }
      }
    }
  }

  function ring(cx, cy, outerR, innerR, r2, g2, b2) {
    for (let y=Math.floor(cy-outerR-1); y<=cy+outerR+1; y++) {
      for (let x=Math.floor(cx-outerR-1); x<=cx+outerR+1; x++) {
        const d = Math.sqrt((x-cx)**2+(y-cy)**2);
        if (d <= outerR && d >= innerR) {
          const aa = Math.min(1, outerR-d+0.5) * Math.min(1, d-innerR+0.5);
          set(x, y, r2, g2, b2, Math.round(255*aa));
        }
      }
    }
  }

  function line(x1, y1, x2, y2, w, r2, g2, b2) {
    const steps = Math.ceil(Math.sqrt((x2-x1)**2+(y2-y1)**2)*2);
    for (let i=0; i<=steps; i++) {
      const t=i/steps, cx=lerp(x1,x2,t), cy=lerp(y1,y2,t);
      circle(cx, cy, w/2, r2, g2, b2);
    }
  }

  const S = size;
  // Brand colors
  const [PR, PG, PB] = [124, 106, 245]; // purple #7c6af5
  const [TR, TG, TB] = [ 94, 234, 212]; // teal   #5eead4

  // ── Background: rounded rectangle filled with deep purple ──────────────────
  const rad = S * 0.22;
  for (let y=0; y<S; y++) {
    for (let x=0; x<S; x++) {
      const dx = Math.max(0, rad - x, x-(S-1-rad));
      const dy = Math.max(0, rad - y, y-(S-1-rad));
      const d  = Math.sqrt(dx*dx+dy*dy);
      const aa = Math.max(0, Math.min(1, rad-d+0.5));
      if (aa > 0) set(x, y, 22, 22, 40, Math.round(255*aa)); // #161628 bg
    }
  }

  // ── Magnifying glass ────────────────────────────────────────────────────────
  const scale = S / 128;

  // lens circle (ring)
  const lcx = S * 0.42, lcy = S * 0.40;
  const lOuter = S * 0.27, lInner = S * 0.18;
  const strokeW = S * 0.085;

  ring(lcx, lcy, lOuter, lInner, 255, 255, 255);

  // inner fill: gradient purple→teal
  for (let y=Math.floor(lcy-lInner); y<=lcy+lInner; y++) {
    for (let x=Math.floor(lcx-lInner); x<=lcx+lInner; x++) {
      const d = Math.sqrt((x-lcx)**2+(y-lcy)**2);
      if (d < lInner) {
        const t = ((x-lcx+lInner)/(lInner*2));
        const r2 = Math.round(lerp(PR, TR, t));
        const g2 = Math.round(lerp(PG, TG, t));
        const b2 = Math.round(lerp(PB, TB, t));
        const aa = Math.min(1, lInner-d+0.5);
        set(x, y, r2, g2, b2, Math.round(255*aa));
      }
    }
  }

  // handle
  const hx1 = lcx + lOuter*0.68, hy1 = lcy + lOuter*0.68;
  const hx2 = S*0.83, hy2 = S*0.83;
  const hw = S * 0.09;
  line(hx1, hy1, hx2, hy2, hw, 255, 255, 255);

  // round cap at end of handle in teal
  circle(hx2, hy2, hw/2+S*0.01, TR, TG, TB);

  // small lightning bolt ⚡ in white inside lens
  if (size >= 48) {
    const bx = lcx, by = lcy;
    const bs = lInner * 0.55;
    // bolt: top-right → mid-left → bottom-right
    const pts = [
      [bx+bs*0.3, by-bs],
      [bx-bs*0.2, by+bs*0.1],
      [bx+bs*0.15,by+bs*0.1],
      [bx-bs*0.3, by+bs],
    ];
    for (let i=0; i<pts.length-1; i++) {
      line(pts[i][0],pts[i][1],pts[i+1][0],pts[i+1][1], S*0.045, 255,255,255);
    }
  } else {
    // at 16px just put a bright dot
    circle(lcx, lcy, lInner*0.35, 255, 255, 255);
  }

  return px;
}

// ── Generate all sizes ────────────────────────────────────────────────────────
const iconsDir = path.join(__dirname, "icons");
fs.mkdirSync(iconsDir, { recursive: true });

for (const size of [16, 48, 128]) {
  const pixels = drawIcon(size);
  const png    = encodePNG(pixels, size);
  const out    = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(out, png);
  console.log(`✓ icon${size}.png  (${png.length} bytes)`);
}
console.log("Done — reload the extension in chrome://extensions");
