"use client";

/**
 * Fixed full-viewport SVG background for the main dashboard page.
 * Dark cosmic theme: deep blue-black base, flowing purple→teal wave ribbon,
 * subtle grid, glowing dots and hex shapes.
 */
export default function CosmicBg() {
  // Points sampled along the wave path for the glowing dots
  const dots: [number, number][] = [
    [55,  820], [210, 620], [390, 260], [570, 150],
    [730, 185], [900, 290], [1060, 480], [1220, 660],
    [1360, 480], [1480, 220],
  ];

  // Hexagon helper: returns SVG polygon points string for a flat-top hex
  function hex(cx: number, cy: number, r: number) {
    return Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 180) * (60 * i - 30);
      return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
    }).join(" ");
  }

  const WAVE =
    "M -150,950 C 100,850 280,60 680,175 C 1080,290 1140,820 1540,80";

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        overflow: "hidden",
        pointerEvents: "none",
        background: "#02020b",
      }}
    >
      <svg
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* ── Grid ─────────────────────────────────────────────────── */}
          <pattern id="cbGrid" width="58" height="58" patternUnits="userSpaceOnUse">
            <path d="M 58 0 L 0 0 0 58" fill="none" stroke="rgba(70,50,170,0.07)" strokeWidth="0.6" />
          </pattern>

          {/* ── Wave gradient: purple → teal ──────────────────────── */}
          <linearGradient id="cbWave" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="#3a1e8f" />
            <stop offset="35%"  stopColor="#7c6af5" />
            <stop offset="65%"  stopColor="#7c6af5" />
            <stop offset="100%" stopColor="#5eead4" />
          </linearGradient>

          {/* ── Centre-line glow ──────────────────────────────────── */}
          <filter id="cbGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="5" result="b1" />
            <feGaussianBlur stdDeviation="12" result="b2" in="SourceGraphic" />
            <feMerge>
              <feMergeNode in="b2" />
              <feMergeNode in="b1" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* ── Outer ribbon soft glow ────────────────────────────── */}
          <filter id="cbRibbonGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="22" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* ── Dot glow ──────────────────────────────────────────── */}
          <filter id="cbDotGlow" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* ── Corner ambient gradients ──────────────────────────── */}
          <radialGradient id="cbAmbient1" cx="0%" cy="0%" r="55%">
            <stop offset="0%" stopColor="#2a15a0" stopOpacity="0.28" />
            <stop offset="100%" stopColor="transparent" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="cbAmbient2" cx="100%" cy="100%" r="45%">
            <stop offset="0%" stopColor="#1a4040" stopOpacity="0.18" />
            <stop offset="100%" stopColor="transparent" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* ── Base fill ─────────────────────────────────────────────── */}
        <rect width="1440" height="900" fill="#02020b" />

        {/* ── Grid ──────────────────────────────────────────────────── */}
        <rect width="1440" height="900" fill="url(#cbGrid)" />

        {/* ── Corner ambient glows ──────────────────────────────────── */}
        <rect width="1440" height="900" fill="url(#cbAmbient1)" />
        <rect width="1440" height="900" fill="url(#cbAmbient2)" />

        {/* ── Wide ribbon (outer glow volume) ───────────────────────── */}
        <path
          d={WAVE}
          fill="none"
          stroke="url(#cbWave)"
          strokeWidth="160"
          strokeOpacity="0.09"
          strokeLinecap="round"
          filter="url(#cbRibbonGlow)"
        />

        {/* ── Mid ribbon ────────────────────────────────────────────── */}
        <path
          d={WAVE}
          fill="none"
          stroke="url(#cbWave)"
          strokeWidth="80"
          strokeOpacity="0.13"
          strokeLinecap="round"
        />

        {/* ── Thin inner ribbon ─────────────────────────────────────── */}
        <path
          d={WAVE}
          fill="none"
          stroke="url(#cbWave)"
          strokeWidth="30"
          strokeOpacity="0.22"
          strokeLinecap="round"
        />

        {/* ── Bright centre line with glow ──────────────────────────── */}
        <path
          d={WAVE}
          fill="none"
          stroke="url(#cbWave)"
          strokeWidth="2.5"
          strokeLinecap="round"
          filter="url(#cbGlow)"
        />

        {/* ── Glowing dots along the wave ───────────────────────────── */}
        {dots.map(([cx, cy], i) => (
          <g key={i} filter="url(#cbDotGlow)">
            <circle cx={cx} cy={cy} r="5.5" fill="rgba(160,140,255,0.55)" />
            <circle cx={cx} cy={cy} r="2.5" fill="rgba(230,225,255,0.95)" />
          </g>
        ))}

        {/* ── Hex geometric shapes ──────────────────────────────────── */}
        <polygon points={hex(1300, 58,  42)} fill="none" stroke="rgba(100,80,210,0.22)" strokeWidth="1.5" />
        <polygon points={hex(1300, 58,  28)} fill="none" stroke="rgba(100,80,210,0.10)" strokeWidth="0.8" />

        <polygon points={hex(490,  545, 52)} fill="none" stroke="rgba(90,70,200,0.18)"  strokeWidth="1.5" />

        <polygon points={hex(1060, 530, 48)} fill="none" stroke="rgba(60,180,160,0.16)" strokeWidth="1.5" />
        <polygon points={hex(1060, 530, 32)} fill="none" stroke="rgba(60,180,160,0.08)" strokeWidth="0.8" />

        <polygon points={hex(160,  110, 35)} fill="none" stroke="rgba(100,80,210,0.12)" strokeWidth="1.2" />

        {/* ── Floating symbol glyphs ────────────────────────────────── */}
        <text x="455" y="490" fontSize="26" fill="rgba(140,120,255,0.28)" fontStyle="italic" fontFamily="serif">ƒ+</text>
        <text x="960" y="300" fontSize="20" fill="rgba(80,200,180,0.22)" fontFamily="monospace">⬡</text>
        <text x="820" y="700" fontSize="18" fill="rgba(120,100,240,0.20)" fontFamily="monospace">▣</text>

        {/* ── Thin connecting lines between some dots ───────────────── */}
        {dots.slice(0, -1).map(([x1, y1], i) => {
          const [x2, y2] = dots[i + 1];
          return (
            <line
              key={i}
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke="rgba(120,100,230,0.12)"
              strokeWidth="0.8"
            />
          );
        })}
      </svg>
    </div>
  );
}
