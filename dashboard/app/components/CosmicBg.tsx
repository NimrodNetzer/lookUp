"use client";

/**
 * Fixed full-viewport SVG background.
 * variant="default" → main dashboard (dark cosmic, subtle wave)
 * variant="dark"    → chat page (same aesthetic, much dimmer so text is readable)
 */
interface Props {
  variant?: "default" | "dark";
}

export default function CosmicBg({ variant = "default" }: Props) {
  const dark = variant === "dark";

  // Convenience: scale an opacity value for the dark variant
  const o = (base: number) => dark ? base * 0.38 : base;

  const baseBg  = dark ? "#010108" : "#01010a";
  const gridOp  = dark ? 0.032 : 0.07;
  const gridOp2 = dark ? 0.042 : 0.09;

  const dots: [number, number][] = [
    [55,  820], [210, 620], [390, 260], [570, 150],
    [730, 185], [900, 290], [1060, 480], [1220, 660],
    [1360, 480], [1480, 220],
  ];

  function hex(cx: number, cy: number, r: number) {
    return Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 180) * (60 * i - 30);
      return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
    }).join(" ");
  }

  const WAVE = "M -150,950 C 100,850 280,60 680,175 C 1080,290 1140,820 1540,80";

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        overflow: "hidden",
        pointerEvents: "none",
        background: baseBg,
      }}
    >
      <svg
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* ── Fine grid ─────────────────────────────────────────────── */}
          <pattern id="cbGrid" width="58" height="58" patternUnits="userSpaceOnUse">
            <path d="M 58 0 L 0 0 0 58" fill="none" stroke={`rgba(70,50,170,${gridOp})`} strokeWidth="0.6" />
          </pattern>

          {/* ── Coarse grid overlay ────────────────────────────────────── */}
          <pattern id="cbGrid2" width="290" height="290" patternUnits="userSpaceOnUse">
            <path d="M 290 0 L 0 0 0 290" fill="none" stroke={`rgba(70,50,170,${gridOp2})`} strokeWidth="1" />
          </pattern>

          {/* ── Wave gradient: purple → teal ──────────────────────────── */}
          <linearGradient id="cbWave" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="#3a1e8f" />
            <stop offset="35%"  stopColor="#7c6af5" />
            <stop offset="65%"  stopColor="#7c6af5" />
            <stop offset="100%" stopColor="#5eead4" />
          </linearGradient>

          {/* ── Filters ───────────────────────────────────────────────── */}
          <filter id="cbGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="5" result="b1" />
            <feGaussianBlur stdDeviation="12" result="b2" in="SourceGraphic" />
            <feMerge>
              <feMergeNode in="b2" />
              <feMergeNode in="b1" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <filter id="cbRibbonGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="22" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <filter id="cbDotGlow" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* ── Ambient gradients ─────────────────────────────────────── */}
          <radialGradient id="cbAmbient1" cx="0%" cy="0%" r="55%">
            <stop offset="0%"   stopColor="#2a15a0" stopOpacity={dark ? 0.12 : 0.28} />
            <stop offset="100%" stopColor="transparent" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="cbAmbient2" cx="100%" cy="100%" r="45%">
            <stop offset="0%"   stopColor="#1a4040" stopOpacity={dark ? 0.08 : 0.18} />
            <stop offset="100%" stopColor="transparent" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="cbAmbient3" cx="85%" cy="25%" r="35%">
            <stop offset="0%"   stopColor="#0d2e2e" stopOpacity={dark ? 0.05 : 0.11} />
            <stop offset="100%" stopColor="transparent" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* ── Base & grids ──────────────────────────────────────────────── */}
        <rect width="1440" height="900" fill={baseBg} />
        <rect width="1440" height="900" fill="url(#cbGrid)" />
        <rect width="1440" height="900" fill="url(#cbGrid2)" />

        {/* ── Ambient corner glows ──────────────────────────────────────── */}
        <rect width="1440" height="900" fill="url(#cbAmbient1)" />
        <rect width="1440" height="900" fill="url(#cbAmbient2)" />
        <rect width="1440" height="900" fill="url(#cbAmbient3)" />

        {/* ── Wave ribbon ───────────────────────────────────────────────── */}
        <path d={WAVE} fill="none" stroke="url(#cbWave)"
          strokeWidth="160" strokeOpacity={dark ? o(0.09) : 0.045} strokeLinecap="round"
          filter="url(#cbRibbonGlow)" />
        <path d={WAVE} fill="none" stroke="url(#cbWave)"
          strokeWidth="80"  strokeOpacity={dark ? o(0.13) : 0.065} strokeLinecap="round" />
        <path d={WAVE} fill="none" stroke="url(#cbWave)"
          strokeWidth="30"  strokeOpacity={dark ? o(0.22) : 0.11} strokeLinecap="round" />
        <path d={WAVE} fill="none" stroke="url(#cbWave)"
          strokeWidth="2.5" strokeLinecap="round"
          strokeOpacity={dark ? 0.55 : 0.5}
          filter="url(#cbGlow)" />

        {/* ── Glowing dots along the wave ───────────────────────────────── */}
        {dots.map(([cx, cy], i) => (
          <g key={i} filter="url(#cbDotGlow)">
            <circle cx={cx} cy={cy} r="5.5" fill={`rgba(160,140,255,${o(0.55)})`} />
            <circle cx={cx} cy={cy} r="2.5" fill={`rgba(230,225,255,${o(0.95)})`} />
          </g>
        ))}

        {/* ── Hex shapes ────────────────────────────────────────────────── */}
        <polygon points={hex(1300, 58,  42)} fill="none" stroke={`rgba(100,80,210,${o(0.22)})`} strokeWidth="1.5" />
        <polygon points={hex(1300, 58,  28)} fill="none" stroke={`rgba(100,80,210,${o(0.10)})`} strokeWidth="0.8" />

        <polygon points={hex(490, 545, 52)} fill="none" stroke={`rgba(90,70,200,${o(0.18)})`}  strokeWidth="1.5" />

        <polygon points={hex(1060, 530, 48)} fill="none" stroke={`rgba(60,180,160,${o(0.16)})`} strokeWidth="1.5" />
        <polygon points={hex(1060, 530, 32)} fill="none" stroke={`rgba(60,180,160,${o(0.08)})`} strokeWidth="0.8" />

        <polygon points={hex(160, 110, 35)} fill="none" stroke={`rgba(100,80,210,${o(0.12)})`} strokeWidth="1.2" />

        {/* New hexes */}
        <polygon points={hex(720, 450, 68)} fill="none" stroke={`rgba(80,60,200,${o(0.10)})`}  strokeWidth="1" />
        <polygon points={hex(720, 450, 46)} fill="none" stroke={`rgba(80,60,200,${o(0.06)})`}  strokeWidth="0.6" />
        <polygon points={hex(200, 650, 28)} fill="none" stroke={`rgba(94,200,180,${o(0.13)})`} strokeWidth="1" />
        <polygon points={hex(1380, 600, 36)} fill="none" stroke={`rgba(100,80,210,${o(0.11)})`} strokeWidth="1" />
        <polygon points={hex(600, 70,  22)} fill="none" stroke={`rgba(120,100,240,${o(0.10)})`} strokeWidth="0.8" />

        {/* ── Floating symbol glyphs ────────────────────────────────────── */}
        <text x="455" y="490" fontSize="26" fill={`rgba(140,120,255,${o(0.28)})`} fontStyle="italic" fontFamily="serif">ƒ+</text>
        <text x="960" y="300" fontSize="20" fill={`rgba(80,200,180,${o(0.22)})`}  fontFamily="monospace">⬡</text>
        <text x="820" y="700" fontSize="18" fill={`rgba(120,100,240,${o(0.20)})`} fontFamily="monospace">▣</text>

        {/* New glyphs */}
        <text x="118"  y="418" fontSize="22" fill={`rgba(94,234,212,${o(0.18)})`}  fontFamily="monospace">∞</text>
        <text x="1248" y="748" fontSize="18" fill={`rgba(140,120,255,${o(0.18)})`} fontFamily="monospace">∇</text>
        <text x="648"  y="820" fontSize="16" fill={`rgba(80,200,180,${o(0.16)})`}  fontFamily="monospace">⊕</text>
        <text x="1098" y="148" fontSize="20" fill={`rgba(120,100,240,${o(0.18)})`} fontFamily="serif">λ</text>
        <text x="338"  y="778" fontSize="14" fill={`rgba(94,234,212,${o(0.15)})`}  fontFamily="monospace">◈</text>
        <text x="1348" y="298" fontSize="16" fill={`rgba(140,120,255,${o(0.16)})`} fontFamily="monospace">⌬</text>
        <text x="72"   y="288" fontSize="16" fill={`rgba(100,80,210,${o(0.14)})`}  fontFamily="monospace">∮</text>
        <text x="1180" y="860" fontSize="14" fill={`rgba(60,180,160,${o(0.13)})`}  fontFamily="monospace">⟁</text>

        {/* ── Cross / target markers ─────────────────────────────────────── */}
        {([
          [288, 370,  "rgba(100,80,210,"],
          [1188, 580, "rgba(60,180,160,"],
          [767, 80,   "rgba(120,100,240,"],
          [67, 680,   "rgba(94,234,212,"],
          [980, 820,  "rgba(100,80,210,"],
          [430, 140,  "rgba(80,200,180,"],
        ] as [number, number, string][]).map(([cx, cy, col], i) => (
          <g key={`cross-${i}`}>
            <line x1={cx - 8} y1={cy}     x2={cx + 8} y2={cy}     stroke={`${col}${o(0.16)})`} strokeWidth="0.8" />
            <line x1={cx}     y1={cy - 8} x2={cx}     y2={cy + 8} stroke={`${col}${o(0.16)})`} strokeWidth="0.8" />
            <circle cx={cx} cy={cy} r="2" fill="none" stroke={`${col}${o(0.10)})`} strokeWidth="0.6" />
          </g>
        ))}

        {/* ── Corner scan brackets ──────────────────────────────────────── */}
        <path d="M 1400 18 L 1432 18 L 1432 50" fill="none" stroke={`rgba(100,80,210,${o(0.16)})`} strokeWidth="1" />
        <path d="M 8 882 L 8 850 L 40 850"       fill="none" stroke={`rgba(60,180,160,${o(0.14)})`} strokeWidth="1" />
        <path d="M 8 18 L 8 50 L 40 18"          fill="none" stroke={`rgba(100,80,210,${o(0.10)})`} strokeWidth="0.8" />
        <path d="M 1432 882 L 1400 882 L 1432 850" fill="none" stroke={`rgba(60,180,160,${o(0.10)})`} strokeWidth="0.8" />

        {/* ── Connecting lines between dots ─────────────────────────────── */}
        {dots.slice(0, -1).map(([x1, y1], i) => {
          const [x2, y2] = dots[i + 1];
          return (
            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={`rgba(120,100,230,${o(0.12)})`} strokeWidth="0.8" />
          );
        })}
      </svg>
    </div>
  );
}
