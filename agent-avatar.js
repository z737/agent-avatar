/*!
 * agent-avatar.js — seeded concentric-ring avatars + animation library for voice agents.
 *
 *   AgentAvatar.toSVG(opts)                 -> static SVG string
 *   const av = AgentAvatar.mount(el, opts)  -> live, animated avatar
 *   av.setState('thinking')                 -> plays the recommended animation for a state
 *   av.setAnimation('orbit')                -> plays any animation from the library
 *   av.setAudio(src | null)                 -> drive voice animations from real audio (null = simulated)
 *   AgentAvatar.createVoiceAnalyser(stream) -> local mic analysis: level, pitch, spectrum
 *   av.update(opts) / av.destroy()
 *
 *   ASCII mode: mount(el, { ascii: 1, glyphs: 'density' | 'blocks' | 'binary' | 'braille',
 *                          sprinkle: 1, sprinkleAmt: 0.2 })
 *   -> hover leaves a trail of glyphs, a press sends a glyph ring, animation peaks turn into glyphs,
 *      and sprinkle keeps a seeded share of dots as characters (also in toSVG exports).
 *
 *   Line patterns: mount(el, { pattern: 'diagonal' | 'horizontal' | 'vertical' | 'cross' | 'mixed', patternAmt: 0.3 })
 *   -> a seeded share of dots and rings are hatched at three densities, like ░ ▒ ▓.
 */
(function (global) {
  'use strict';

  /* ---------- Palette (Tailwind CSS, v3 hex values) ---------- */
  const TW = {
    red:     ['#fee2e2','#fecaca','#fca5a5','#f87171','#ef4444','#dc2626','#b91c1c','#991b1b','#7f1d1d'],
    orange:  ['#ffedd5','#fed7aa','#fdba74','#fb923c','#f97316','#ea580c','#c2410c','#9a3412','#7c2d12'],
    amber:   ['#fef3c7','#fde68a','#fcd34d','#fbbf24','#f59e0b','#d97706','#b45309','#92400e','#78350f'],
    yellow:  ['#fef9c3','#fef08a','#fde047','#facc15','#eab308','#ca8a04','#a16207','#854d0e','#713f12'],
    lime:    ['#ecfccb','#d9f99d','#bef264','#a3e635','#84cc16','#65a30d','#4d7c0f','#3f6212','#365314'],
    green:   ['#dcfce7','#bbf7d0','#86efac','#4ade80','#22c55e','#16a34a','#15803d','#166534','#14532d'],
    emerald: ['#d1fae5','#a7f3d0','#6ee7b7','#34d399','#10b981','#059669','#047857','#065f46','#064e3b'],
    teal:    ['#ccfbf1','#99f6e4','#5eead4','#2dd4bf','#14b8a6','#0d9488','#0f766e','#115e59','#134e4a'],
    cyan:    ['#cffafe','#a5f3fc','#67e8f9','#22d3ee','#06b6d4','#0891b2','#0e7490','#155e75','#164e63'],
    sky:     ['#e0f2fe','#bae6fd','#7dd3fc','#38bdf8','#0ea5e9','#0284c7','#0369a1','#075985','#0c4a6e'],
    blue:    ['#dbeafe','#bfdbfe','#93c5fd','#60a5fa','#3b82f6','#2563eb','#1d4ed8','#1e40af','#1e3a8a'],
    indigo:  ['#e0e7ff','#c7d2fe','#a5b4fc','#818cf8','#6366f1','#4f46e5','#4338ca','#3730a3','#312e81'],
    violet:  ['#ede9fe','#ddd6fe','#c4b5fd','#a78bfa','#8b5cf6','#7c3aed','#6d28d9','#5b21b6','#4c1d95'],
    purple:  ['#f3e8ff','#e9d5ff','#d8b4fe','#c084fc','#a855f7','#9333ea','#7e22ce','#6b21a8','#581c87'],
    fuchsia: ['#fae8ff','#f5d0fe','#f0abfc','#e879f9','#d946ef','#c026d3','#a21caf','#86198f','#701a75'],
    pink:    ['#fce7f3','#fbcfe8','#f9a8d4','#f472b6','#ec4899','#db2777','#be185d','#9d174d','#831843'],
    rose:    ['#ffe4e6','#fecdd3','#fda4af','#fb7185','#f43f5e','#e11d48','#be123c','#9f1239','#881337'],
  };
  const HUES = Object.keys(TW);
  const SHADES = [100, 200, 300, 400, 500, 600, 700, 800, 900];
  const shadeHex = (hue, shade) => TW[hue][SHADES.indexOf(shade)];

  const DEFAULTS = {
    seed: 'agent', d: 24, n: 4, type: 'mixed', hollow: 0.35, thickness: 0.27,
    mode: 'seed', hue: 'rose', shadeMin: 200, shadeMax: 800, bg: 'none', speed: 1,
    // ASCII mode: 0/1 flags so they round-trip through URLs and data attributes.
    ascii: 0, glyphs: 'density', sprinkle: 0, sprinkleAmt: 0.2,
    // Line patterns inside dots and rings: none | diagonal | horizontal | vertical | cross | mixed.
    pattern: 'none', patternAmt: 0.3,
  };

  /* Hatch patterns. Each patterned dot also gets a density level, like the shade blocks ░ ▒ ▓. */
  const PATTERNS = {
    diagonal:   { label: 'Diagonal',   rotate: 45, cross: false },
    horizontal: { label: 'Horizontal', rotate: 0,  cross: false },
    vertical:   { label: 'Vertical',   rotate: 90, cross: false },
    cross:      { label: 'Cross',      rotate: 45, cross: true },
  };
  const PATTERN_KINDS = Object.keys(PATTERNS);
  const PATTERN_WEIGHT = [0.28, 0.45, 0.62]; // line width as a share of line spacing: light, medium, dense
  let uidCounter = 0;

  /* Glyph sets, ordered quiet -> dense. A dot's intensity (0..1) picks the character. */
  const GLYPHS = {
    density: { label: 'Density', chars: ['.', ':', '-', '=', '+', '*', '#', '%', '@'], scale: 1.25 },
    blocks:  { label: 'Blocks',  chars: ['\u2591', '\u2592', '\u2593', '\u2588'], scale: 1.0 },
    binary:  { label: 'Binary',  chars: ['0', '1'], scale: 1.15 },
    braille: { label: 'Braille', chars: ['\u2801', '\u2803', '\u2807', '\u2847', '\u28C7', '\u28E7', '\u28F7', '\u28FF'], scale: 1.3 },
  };
  const GLYPH_ON = 0.5; // intensity above which a dot is drawn as a character
  function glyphFor(set, lvl) {
    const c = (GLYPHS[set] || GLYPHS.density).chars;
    return c[Math.min(c.length - 1, Math.floor(((lvl - GLYPH_ON) / (1 - GLYPH_ON)) * c.length))];
  }

  /* ---------- Seeded PRNG: cyrb128 -> mulberry32 ---------- */
  function hashSeed(str) {
    let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
    for (let i = 0; i < str.length; i++) {
      const k = str.charCodeAt(i);
      h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
      h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
      h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
      h4 = h1 ^ Math.imul(h4 ^ k, 2716044813);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    return (h1 ^ h2) >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /*
   * Layout: concentric rings around a centre dot.
   * Gap = d/3 (1:3), pitch = d + gap. Ring k sits at radius k * pitch with 6k dots,
   * starting at 12 o'clock, so neighbours are never closer than one gap.
   * n = circles per line, centre to edge (max 8).
   */
  function layout(d, n) {
    const gap = d / 3, p = d + gap, K = n - 1;
    const pts = [{ x: 0, y: 0, k: 0, a: 0 }];
    for (let k = 1; k <= K; k++) {
      const count = 6 * k;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2; // clockwise from top
        pts.push({ x: k * p * Math.sin(a), y: -k * p * Math.cos(a), k, a });
      }
    }
    return { pts, gap, pitch: p, K };
  }

  /* Deterministic model for a given config. Shape type never consumes randomness
     differently, so switching solid/hollow/mixed keeps the same colours. */
  function build(o) {
    o = { ...DEFAULTS, ...o };
    o.n = Math.max(2, Math.min(8, o.n | 0));
    const rnd = mulberry32(hashSeed(String(o.seed)));
    const motion = mulberry32(hashSeed(String(o.seed) + '::motion'));
    const asciiRnd = mulberry32(hashSeed(String(o.seed) + '::ascii'));
    const patRnd = mulberry32(hashSeed(String(o.seed) + '::pattern'));
    const { pts, gap, pitch, K } = layout(o.d, o.n);
    const baseHue = o.mode === 'fixed' ? o.hue : HUES[Math.floor(rnd() * HUES.length)];
    const lo = SHADES.indexOf(Math.min(o.shadeMin, o.shadeMax));
    const hi = SHADES.indexOf(Math.max(o.shadeMin, o.shadeMax));
    const R = K * pitch || 1;
    const dots = pts.map(pt => {
      const hue = o.mode === 'multi' ? HUES[Math.floor(rnd() * HUES.length)] : baseHue;
      const shade = SHADES[lo + Math.floor(rnd() * (hi - lo + 1))];
      const roll = rnd();
      const hollow = o.type === 'hollow' ? true : o.type === 'solid' ? false : roll < o.hollow;
      return {
        ...pt, hue, shade, color: shadeHex(hue, shade), hollow,
        u: pt.k / (K || 1), nx: pt.x / R, ny: pt.y / R, rand: motion(),
        // Seeded sprinkle: the same dots stay characters as the amount grows.
        sprinkleRoll: asciiRnd(), sprinkleLvl: 0.6 + asciiRnd() * 0.4,
        // Seeded patterning: own stream, so colours and shapes never change when it is toggled.
        patRoll: patRnd(), patKind: PATTERN_KINDS[Math.floor(patRnd() * PATTERN_KINDS.length)], patLevel: Math.floor(patRnd() * 3),
      };
    });
    if (PATTERNS[o.pattern] || o.pattern === 'mixed') {
      for (const dt of dots) {
        if (dt.patRoll >= o.patternAmt) continue;
        dt.pattern = { kind: o.pattern === 'mixed' ? dt.patKind : o.pattern, level: dt.patLevel };
      }
    }
    const r = o.d / 2;
    const extent = K * pitch + r + gap;
    return { o, dots, r, sw: o.d * o.thickness, gap, pitch, K, extent, size: extent * 2, baseHue, uid: 'aa' + (++uidCounter).toString(36) };
  }

  const f3 = v => +v.toFixed(3);
  function bgMarkup(m) {
    const e = f3(m.extent);
    if (m.o.bg === 'white') return `<rect x="${-e}" y="${-e}" width="${e * 2}" height="${e * 2}" fill="#ffffff"/>`;
    if (m.o.bg === 'tint') return `<circle cx="0" cy="0" r="${e}" fill="${shadeHex(m.baseHue, 100)}"/>`;
    return '';
  }
  // One <pattern> per (kind, density, colour) in use; ids are unique per render so inline SVGs don't clash.
  const patId = (m, p, color) => `${m.uid}-${p.kind}-${p.level}-${color.slice(1)}`;
  function defsMarkup(m) {
    const seen = new Set(), sp = m.o.d / 5;
    let out = '';
    for (const dt of m.dots) {
      if (!dt.pattern) continue;
      const id = patId(m, dt.pattern, dt.color);
      if (seen.has(id)) continue;
      seen.add(id);
      const P = PATTERNS[dt.pattern.kind], lw = f3(sp * PATTERN_WEIGHT[dt.pattern.level]), h = f3(sp / 2), w = f3(sp);
      const d = `M0 ${h}H${w}` + (P.cross ? `M${h} 0V${w}` : '');
      out += `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${w}" height="${w}" patternTransform="rotate(${P.rotate})"><path d="${d}" stroke="${dt.color}" stroke-width="${lw}"/></pattern>`;
    }
    return out ? `<defs>${out}</defs>` : '';
  }
  function dotMarkup(m, dt) {
    const paint = dt.pattern ? `url(#${patId(m, dt.pattern, dt.color)})` : dt.color;
    return dt.hollow
      ? `<circle cx="${f3(dt.x)}" cy="${f3(dt.y)}" r="${f3(m.r - m.sw / 2)}" fill="none" stroke="${paint}" stroke-width="${f3(m.sw)}"/>`
      : `<circle cx="${f3(dt.x)}" cy="${f3(dt.y)}" r="${f3(m.r)}" fill="${paint}"/>`;
  }
  const sprinkled = (m, dt) => m.o.ascii && m.o.sprinkle && dt.sprinkleRoll < m.o.sprinkleAmt;
  const GLYPH_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  function glyphMarkup(m, dt, ch) {
    const size = f3(m.o.d * (GLYPHS[m.o.glyphs] || GLYPHS.density).scale);
    return `<text x="${f3(dt.x)}" y="${f3(dt.y)}" fill="${dt.color}" font-size="${size}" font-family="${GLYPH_FONT}" font-weight="700" text-anchor="middle" dominant-baseline="central">${ch}</text>`;
  }
  function toSVG(opts) {
    const m = build(opts), e = f3(m.extent), s = f3(m.size);
    const body = m.dots.map(dt => sprinkled(m, dt) ? glyphMarkup(m, dt, glyphFor(m.o.glyphs, dt.sprinkleLvl)) : dotMarkup(m, dt)).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-e} ${-e} ${s} ${s}" width="${s}" height="${s}">${defsMarkup(m)}${bgMarkup(m)}${body}</svg>`;
  }

  /* ---------- Motion helpers ---------- */
  const TAU = Math.PI * 2;
  const fract = x => x - Math.floor(x);
  const gauss = (x, w) => Math.exp(-(x * x) / (w * w));
  const clamp01 = x => Math.max(0, Math.min(1, x));
  const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  // Brightness trailing behind a rotating head at angle h (dir 1 = clockwise).
  const trail = (h, a, len, dir = 1) => Math.exp(-fract(dir * (h - a) / TAU) * TAU / len);
  // map value v (0..1) into {s: scale, o: opacity}
  const so = (v, s0, s1, o0, o1) => ({ s: s0 + (s1 - s0) * v, o: o0 + (o1 - o0) * v });

  /* Simulated audio envelopes (used when no real level is supplied). */
  function speechLevel(t) {
    const gate = clamp01((Math.sin(t * 1.3) + Math.sin(t * 0.47 + 1)) * 1.6 + 0.7);
    const syll = 0.5 + 0.5 * Math.sin(t * TAU * 3.6 + 2 * Math.sin(t * 2.1));
    const grit = 0.5 + 0.5 * Math.sin(t * 23 + Math.sin(t * 7));
    return clamp01(gate * (0.2 + 0.6 * syll + 0.2 * grit));
  }
  function userLevel(t) { return speechLevel(t * 0.85 + 11) * 0.9; }
  function speechPitch(t) { return clamp01(0.45 + 0.25 * Math.sin(t * 0.7) + 0.12 * Math.sin(t * 2.3 + 1)); }
  // Sample a band array (low -> high frequency) at position x in 0..1.
  function sampleBands(bands, x) {
    const i = clamp01(x) * (bands.length - 1), lo = Math.floor(i), hi = Math.min(bands.length - 1, lo + 1);
    return bands[lo] + (bands[hi] - bands[lo]) * (i - lo);
  }

  /*
   * Animation library. Each entry:
   *   dot(d, t, env) -> { s, o }   per-dot scale (1 = rest) and opacity
   *   group(t, env)  -> { dx, dy, rot, sx, sy }   optional whole-avatar transform
   *   still: true    -> drawn once, never re-rendered (cheap for long lists)
   * d:   { k ring, K outer ring, a angle (clockwise from top), u radius 0..1, nx, ny -1..1, rand 0..1 }
   * env: { level 0..1, pitch 0..1 (low -> high voice), bands [0..1] low -> high | null, user 0..1 }
   */
  const ANIMATIONS = {
    /* Ambient */
    static: {
      category: 'Ambient', label: 'Static', still: true,
      description: 'No motion. Use as the display picture.',
      dot: () => ({ s: 1, o: 1 }),
    },
    dim: {
      category: 'Ambient', label: 'Dim',
      description: 'Static, low contrast. Nothing is live.',
      dot: () => ({ s: 0.78, o: 0.28 }),
    },
    breathe: {
      category: 'Ambient', label: 'Breathe',
      description: 'Slow inhale and exhale from the core.',
      dot: (d, t) => so(0.5 - 0.5 * Math.cos(TAU * (t - d.u * 0.35) / 3.6), 0.84, 1, 0.65, 1),
    },
    twinkle: {
      category: 'Ambient', label: 'Twinkle',
      description: 'Dots sparkle independently.',
      dot: (d, t) => so(Math.pow(0.5 + 0.5 * Math.sin(TAU * t / (1.4 + d.rand * 1.6) + d.rand * 40), 3), 0.72, 1.05, 0.3, 1),
    },
    spin: {
      category: 'Ambient', label: 'Spin',
      description: 'The whole avatar rotates slowly.',
      dot: () => ({ s: 1, o: 1 }),
      group: t => ({ rot: (t / 12) * 360 }),
    },

    /* Pulse */
    ripple: {
      category: 'Pulse', label: 'Ripple',
      description: 'Rings light up from the centre outward.',
      dot: (d, t) => so(gauss(d.k - (fract(t / 1.8) * (d.K + 2.2) - 1), 0.8), 0.7, 1.08, 0.38, 1),
    },
    'ripple-in': {
      category: 'Pulse', label: 'Ripple in',
      description: 'Rings converge toward the centre.',
      dot: (d, t) => so(gauss(d.k - (d.K + 1.2 - fract(t / 1.8) * (d.K + 2.2)), 0.8), 0.7, 1.08, 0.38, 1),
    },
    heartbeat: {
      category: 'Pulse', label: 'Heartbeat',
      description: 'Double beat, lub-dub.',
      dot: (d, t) => {
        const x = fract(t / 1.3) - d.u * 0.06;
        return so(clamp01(gauss(x - 0.06, 0.05) + 0.7 * gauss(x - 0.27, 0.06)), 0.8, 1.1, 0.55, 1);
      },
    },
    burst: {
      category: 'Pulse', label: 'Burst',
      description: 'Energy radiates from the core and fades.',
      dot: (d, t) => {
        const x = fract(t / 2);
        return so(gauss(d.k - (x * (d.K + 1.6) - 0.3), 0.7) * (1 - x * 0.6), 0.55, 1.12, 0.22, 1);
      },
    },

    /* Orbit */
    orbit: {
      category: 'Orbit', label: 'Orbit',
      description: 'A highlight circles every ring in sync.',
      dot: (d, t) => d.k === 0 ? { s: 0.85, o: 0.7 } : so(trail(TAU * t / 1.6, d.a, 1.4), 0.62, 1.06, 0.22, 1),
    },
    gears: {
      category: 'Orbit', label: 'Gears',
      description: 'Alternate rings turn in opposite directions.',
      dot: (d, t) => {
        if (d.k === 0) return { s: 0.85, o: 0.7 };
        const dir = d.k % 2 ? 1 : -1;
        return so(trail(dir * TAU * t / 2.2 + d.k, d.a, 1.2, dir), 0.62, 1.06, 0.22, 1);
      },
    },
    spiral: {
      category: 'Orbit', label: 'Spiral',
      description: 'A single arm twists outward as it turns.',
      dot: (d, t) => so(trail(TAU * t / 2 - d.k * 0.7, d.a, 1.6), 0.62, 1.06, 0.2, 1),
    },
    vortex: {
      category: 'Orbit', label: 'Vortex',
      description: 'Two arms swirl with a strong twist.',
      dot: (d, t) => {
        const h = TAU * t / 1.5 + d.k * 0.9;
        return so(Math.max(trail(h, d.a, 0.9), trail(h + Math.PI, d.a, 0.9)), 0.62, 1.06, 0.2, 1);
      },
    },
    comet: {
      category: 'Orbit', label: 'Comet',
      description: 'One traveller laps the outer ring.',
      dot: (d, t) => d.k === d.K ? so(trail(TAU * t / 2.4, d.a, 2.2), 0.6, 1.08, 0.12, 1) : { s: 0.8, o: 0.18 },
    },

    /* Scan */
    radar: {
      category: 'Scan', label: 'Radar',
      description: 'A sweep arm leaves a fading trail.',
      dot: (d, t) => d.k === 0 ? { s: 1, o: 1 } : so(trail(TAU * t / 2.4, d.a, 1.8), 0.7, 1.05, 0.14, 1),
    },
    scanline: {
      category: 'Scan', label: 'Scanline',
      description: 'A band sweeps up and down.',
      dot: (d, t) => so(gauss(d.ny - Math.sin(TAU * t / 2.4) * 1.25, 0.3), 0.72, 1.08, 0.28, 1),
    },
    shimmer: {
      category: 'Scan', label: 'Shimmer',
      description: 'A diagonal highlight glides across.',
      dot: (d, t) => so(gauss((d.nx + d.ny) / 2 - (fract(t / 2.2) * 3.2 - 1.6), 0.3), 0.92, 1.08, 0.42, 1),
    },

    /* Wave */
    wave: {
      category: 'Wave', label: 'Wave',
      description: 'A travelling wave rolls left to right.',
      dot: (d, t) => so(0.5 + 0.5 * Math.sin(TAU * t / 1.4 - d.nx * 3.2), 0.7, 1.06, 0.42, 1),
    },
    sinewave: {
      category: 'Wave', label: 'Sine',
      description: 'Dots trace a moving sine curve.',
      dot: (d, t) => so(gauss(d.ny - 0.55 * Math.sin(TAU * t / 1.8 - d.nx * 2.6), 0.35), 0.65, 1.08, 0.22, 1),
    },

    /* Voice (audio-reactive) */
    voice: {
      category: 'Voice', label: 'Voice',
      description: 'Radiates with speech; pitch moves energy outward.',
      dot: (d, t, env) => {
        const jit = 0.5 + 0.5 * Math.sin(t * 14 + d.rand * 40);
        // Low voice energises the core, high voice the outer rings.
        const shape = 0.6 * (1 - d.u * 0.5) + 0.5 * gauss(d.u - env.pitch, 0.35);
        const v = clamp01(env.level * shape * (0.8 + 0.4 * jit));
        return { s: 0.72 + 0.48 * v, o: 0.45 + 0.55 * clamp01(v * 1.5) };
      },
    },
    equalizer: {
      category: 'Voice', label: 'Equalizer',
      description: 'EQ columns: loudness sets height, pitch moves the peak.',
      dot: (d, t, env) => {
        const x = Math.abs(d.nx); // 0 centre column -> 1 edge column
        const spec = env.bands
          ? sampleBands(env.bands, x) // real spectrum, mirrored: lows in the middle, highs at the edges
          : 0.5 + 0.5 * Math.sin(t * 8.3 + d.nx * 4.7 + 1.7 * Math.sin(t * 2.9 + d.nx * 3));
        // Pitch slides the tallest columns from the centre (low voice) to the edges (high voice).
        const focus = gauss(x - env.pitch, 0.5);
        const band = env.level * (0.35 + 0.65 * spec) * (0.55 + 0.45 * focus) * 1.25;
        return so(smooth(band + 0.14, band - 0.14, Math.abs(d.ny)), 0.6, 1.04, 0.16, 1);
      },
    },
    'listen-glow': {
      category: 'Voice', label: 'Listen glow',
      description: 'The core glows with the caller’s voice.',
      dot: (d, t, env) => {
        const v = env.user * gauss(d.u, 0.65);
        const p = 0.5 - 0.5 * Math.cos(TAU * t / 3.6);
        return { s: 0.82 + 0.3 * v + 0.05 * p, o: 0.5 + 0.5 * clamp01(v * 1.6 + 0.15 * p) };
      },
    },

    /* Feedback */
    blink: {
      category: 'Feedback', label: 'Blink',
      description: 'A quick double blink.',
      dot: () => ({ s: 1, o: 1 }),
      group: t => {
        const x = fract(t / 3);
        return { sy: 1 - 0.88 * clamp01(gauss(x - 0.06, 0.03) + gauss(x - 0.17, 0.03)) };
      },
    },
    shake: {
      category: 'Feedback', label: 'Shake',
      description: 'A short “no” shake, then settles.',
      dot: (d, t) => {
        const x = fract(t / 2.2);
        return { s: 0.88, o: 0.55 + 0.45 * smooth(0.45, 0, x) };
      },
      group: t => {
        const x = fract(t / 2.2), amp = smooth(0.45, 0, x);
        return { dx: Math.sin(x * TAU * 9) * 0.06 * amp };
      },
    },
  };

  /* Voice-agent states with the recommended animation and why. */
  const STATES = {
    static:       { label: 'Static',       animation: 'static',      why: 'No motion: the agent’s display picture in lists, chats and directories.' },
    disconnected: { label: 'Disconnected', animation: 'dim',         why: 'Static and low contrast, so it never implies the agent is live.' },
    connecting:   { label: 'Connecting',   animation: 'comet',       why: 'A single traveller laps the ring: reaching out, with no promise of timing.' },
    idle:         { label: 'Idle',         animation: 'breathe',     why: 'Alive but calm; low distraction while waiting for the caller.' },
    listening:    { label: 'Listening',    animation: 'breathe',     why: 'Same calm breath as idle, so the avatar stays steady while the caller speaks.' },
    thinking:     { label: 'Thinking',     animation: 'twinkle',     why: 'Quiet, scattered sparkle reads as ideas forming without implying speech.' },
    working:      { label: 'Tool call',    animation: 'scanline',    why: 'A band sweeping the avatar reads as reading or fetching data.' },
    speaking:     { label: 'Speaking',     animation: 'equalizer',   why: 'Columns follow the voice: loudness sets height, pitch moves the peak outward.' },
    interrupted:  { label: 'Interrupted',  animation: 'voice',       why: 'Stays voice-shaped, so the barge-in reads as a pause, not a mode change.' },
    hold:         { label: 'On hold',      animation: 'comet',       why: 'A lone traveller shows progress without urgency during transfer.' },
    error:        { label: 'Error',        animation: 'shake',       why: 'The universal “no” gesture, then it settles and dims.' },
  };

  /* ---------- Voice analyser: level, pitch and spectrum from a mic or any audio node ----------
   * Runs entirely in the browser. Nothing is recorded, stored or sent anywhere, and the
   * analyser is not connected to the speakers (no playback / echo).
   *   const voice = AgentAvatar.createVoiceAnalyser(mediaStream | audioNode)
   *   voice.read() -> { level 0..1, pitch 0..1, hz, voiced, bands[8] 0..1 }   voice.stop()
   */
  const BAND_EDGES = [90, 160, 280, 480, 820, 1400, 2400, 4000, 6500];
  const PITCH_LOW = 85, PITCH_OCTAVES = 2; // 85 Hz -> 0, 340 Hz -> 1

  // McLeod-style normalised square difference; picks the first strong peak to avoid octave errors.
  function detectPitch(buf, sr, nsdf) {
    const minLag = Math.floor(sr / 500), maxLag = Math.min(Math.floor(sr / 70), buf.length >> 1);
    const W = buf.length - maxLag;
    let best = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let ac = 0, m = 0;
      for (let i = 0; i < W; i++) { const a = buf[i], b = buf[i + lag]; ac += a * b; m += a * a + b * b; }
      nsdf[lag] = m ? (2 * ac) / m : 0;
      if (nsdf[lag] > best) best = nsdf[lag];
    }
    if (best < 0.6) return 0; // unvoiced / noisy
    for (let lag = minLag + 1; lag < maxLag; lag++) {
      const a = nsdf[lag - 1], b = nsdf[lag], c = nsdf[lag + 1];
      if (b >= best * 0.9 && b >= a && b >= c) {
        const den = a - 2 * b + c;
        return sr / (lag + (den ? (a - c) / (2 * den) : 0));
      }
    }
    return 0;
  }

  function createVoiceAnalyser(source, opts = {}) {
    const isNode = typeof AudioNode !== 'undefined' && source instanceof AudioNode;
    const ownCtx = !isNode && !opts.context;
    const ctx = isNode ? source.context : opts.context || new (global.AudioContext || global.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const input = isNode ? source : ctx.createMediaStreamSource(source);
    const an = ctx.createAnalyser();
    an.fftSize = 2048; an.smoothingTimeConstant = 0.5;
    input.connect(an);

    const time = new Float32Array(an.fftSize), freq = new Float32Array(an.frequencyBinCount);
    const nsdf = new Float32Array(an.fftSize);
    const binHz = ctx.sampleRate / an.fftSize;
    const out = { level: 0, pitch: 0.5, hz: 0, voiced: false, bands: new Array(BAND_EDGES.length - 1).fill(0), context: ctx };

    out.read = () => {
      an.getFloatTimeDomainData(time);
      let sum = 0;
      for (let i = 0; i < time.length; i++) sum += time[i] * time[i];
      const db = 20 * Math.log10(Math.sqrt(sum / time.length) + 1e-9);
      const target = clamp01((db + 58) / 42); // ~-58 dB silence .. -16 dB loud
      out.level += (target - out.level) * (target > out.level ? 0.55 : 0.15); // fast attack, slow release

      const hz = target > 0.12 ? detectPitch(time, ctx.sampleRate, nsdf) : 0;
      out.voiced = hz > 0;
      if (hz) {
        out.hz = hz;
        out.pitch += (clamp01(Math.log2(hz / PITCH_LOW) / PITCH_OCTAVES) - out.pitch) * 0.3;
      }

      an.getFloatFrequencyData(freq);
      for (let b = 0; b < out.bands.length; b++) {
        const lo = Math.max(1, Math.floor(BAND_EDGES[b] / binHz));
        const hi = Math.max(lo + 1, Math.floor(BAND_EDGES[b + 1] / binHz));
        let s = 0;
        for (let i = lo; i < hi; i++) s += freq[i];
        const v = clamp01((s / (hi - lo) + 90 + b * 4) / 55); // +4 dB/band offsets speech's spectral tilt
        out.bands[b] += (v - out.bands[b]) * 0.4;
      }
      return out;
    };
    out.stop = () => {
      input.disconnect(an);
      if (!isNode && source.getTracks) source.getTracks().forEach(t => t.stop());
      if (ownCtx) ctx.close();
    };
    return out;
  }

  /* ---------- Live instances (one shared rAF loop) ---------- */
  const SVGNS = 'http://www.w3.org/2000/svg';
  const instances = new Set();
  let rafId = 0;
  let globalAudio = null;
  const io = 'IntersectionObserver' in global
    ? new IntersectionObserver(es => es.forEach(e => { if (e.target.__av) e.target.__av.visible = e.isIntersecting; }))
    : null;
  const reduceMotion = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function mix(a, b, p) { return a + (b - a) * p; }
  function groupOf(anim, t, env) {
    const g = anim.group ? anim.group(t, env) : {};
    return { dx: g.dx || 0, dy: g.dy || 0, rot: g.rot || 0, sx: g.sx ?? 1, sy: g.sy ?? 1 };
  }
  // Audio source = analyser (read once per frame) or a plain { level, pitch, bands } object.
  function readAudio(src, now) {
    if (!src) return null;
    if (typeof src.read === 'function' && src._at !== now) { src._at = now; src.read(); }
    return src;
  }

  /* ASCII wake tuning, in units of the dot pitch / seconds. */
  const WAKE = { reach: 3, trail: 1.2, pull: 0.18, ringSpeed: 7, ringLife: 0.9 };

  function mount(el, opts = {}) {
    const av = {
      el, opts: { ...DEFAULTS, ...opts }, visible: true, audio: null,
      t0: performance.now(), anim: null, prev: null, switchAt: 0, state: null, drawn: false,
      ptr: null, rings: [], heat: null, last: 0, hot: false,
    };

    function render() {
      av.model = build(av.opts);
      const m = av.model, e = f3(m.extent);
      const svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('viewBox', `${-e} ${-e} ${f3(m.size)} ${f3(m.size)}`);
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      svg.style.display = 'block';
      svg.style.overflow = 'visible';
      const glyphs = m.o.ascii ? m.dots.map(dt => glyphMarkup(m, dt, '')).join('') : '';
      svg.innerHTML = defsMarkup(m) + bgMarkup(m) + '<g>' + m.dots.map(dt => dotMarkup(m, dt)).join('') + glyphs + '</g>';
      av.svg = svg;
      av.g = svg.lastChild;
      const kids = [...av.g.children];
      av.nodes = kids.slice(0, m.dots.length);
      av.texts = m.o.ascii ? kids.slice(m.dots.length) : null;
      av.chars = new Array(m.dots.length).fill('');
      av.heat = new Float32Array(m.dots.length);
      av.drawn = false;
      el.replaceChildren(svg);
    }

    // Pointer -> avatar coordinates, for the hover wake and press ring.
    const toModel = ev => {
      const ctm = av.svg && av.svg.getScreenCTM();
      if (!ctm) return null;
      const pt = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(ctm.inverse());
      return { x: pt.x, y: pt.y };
    };
    const onMove = ev => { if (av.opts.ascii) av.ptr = toModel(ev); };
    const onLeave = () => { av.ptr = null; };
    const onDown = ev => {
      if (!av.opts.ascii) return;
      const p = toModel(ev);
      if (p) av.rings.push({ ...p, at: performance.now() });
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointerdown', onDown);

    av.setAnimation = name => {
      const next = ANIMATIONS[name] || ANIMATIONS.static;
      if (next === av.anim) return av;
      av.prev = av.anim; av.anim = next; av.animName = name; av.switchAt = performance.now();
      return av;
    };
    av.setState = name => {
      av.state = name;
      return av.setAnimation((STATES[name] || STATES.static).animation);
    };
    av.setAudio = src => { av.audio = src || null; return av; };
    av.setLevel = v => av.setAudio(v == null ? null : { level: clamp01(v), pitch: 0.5 });
    av.update = o => { av.opts = { ...av.opts, ...o }; render(); return av; };
    av.destroy = () => {
      instances.delete(av); io && io.unobserve(el); delete el.__av;
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointerdown', onDown);
      el.replaceChildren();
    };

    render();
    if (opts.animation) av.setAnimation(opts.animation); else av.setState(opts.state || 'static');
    av.prev = null;
    el.__av = av;
    io && io.observe(el);
    instances.add(av);
    if (!rafId) rafId = requestAnimationFrame(tick);
    return av;
  }

  function frame(av, now) {
    const m = av.model, o = m.o, ascii = !!o.ascii;
    const waking = ascii && (av.ptr || av.rings.length || av.hot);
    const dtSec = av.last ? Math.min(0.1, (now - av.last) / 1000) : 0;
    av.last = now;
    if (av.anim.still && !av.prev && av.drawn && !waking) return;

    const t = reduceMotion ? 0 : ((now - av.t0) / 1000) * o.speed;
    const a = readAudio(av.audio || globalAudio, now);
    const env = a
      ? { level: a.level || 0, pitch: a.pitch ?? 0.5, bands: a.bands || null, user: a.level || 0 }
      : { level: speechLevel(t), pitch: speechPitch(t), bands: null, user: userLevel(t) };
    const K = m.K;
    const p = av.prev ? ease(clamp01((now - av.switchAt) / 320)) : 1;
    if (p >= 1) av.prev = null;

    // Press rings expand outward and expire.
    if (ascii) av.rings = av.rings.filter(rg => (now - rg.at) / 1000 < WAKE.ringLife);
    const reach = WAKE.reach * m.pitch, decay = dtSec / WAKE.trail;
    const glyphSize = o.d * (GLYPHS[o.glyphs] || GLYPHS.density).scale;
    let hot = false;

    for (let i = 0; i < m.dots.length; i++) {
      const dt = m.dots[i];
      const d = { k: dt.k, K, a: dt.a, u: dt.u, nx: dt.nx, ny: dt.ny, rand: dt.rand };
      let r = av.anim.dot(d, t, env);
      if (av.prev) {
        const q = av.prev.dot(d, t, env);
        r = { s: mix(q.s, r.s, p), o: mix(q.o, r.o, p) };
      }
      const node = av.nodes[i];

      let lvl = 0, x = dt.x, y = dt.y;
      if (ascii) {
        // Hover wake: heat builds under the pointer and cools over WAKE.trail seconds.
        let h = Math.max(0, av.heat[i] - decay);
        if (av.ptr) {
          const dx = av.ptr.x - dt.x, dy = av.ptr.y - dt.y, dist = Math.hypot(dx, dy);
          const c = clamp01(1 - (dist / reach) ** 2); // dense under the pointer, ':' at the edge
          h = Math.max(h, c);
          if (dist > 0) { x += (dx / dist) * c * WAKE.pull * m.pitch; y += (dy / dist) * c * WAKE.pull * m.pitch; }
        }
        for (const rg of av.rings) {
          const age = (now - rg.at) / 1000, radius = age * WAKE.ringSpeed * m.pitch;
          const dist = Math.hypot(rg.x - dt.x, rg.y - dt.y);
          h = Math.max(h, gauss(dist - radius, m.pitch * 0.8) * (1 - age / WAKE.ringLife));
        }
        av.heat[i] = h;
        if (h > 0.01) hot = true;

        // Intensity-driven: only dots peaking above rest size become glyphs, so calm states stay dots.
        const animLvl = av.anim.still && !av.prev ? 0 : clamp01(r.o) * clamp01((r.s - 0.95) / 0.12);
        lvl = Math.max(animLvl, h, sprinkled(m, dt) ? dt.sprinkleLvl : 0);
      }

      const asGlyph = ascii && lvl >= GLYPH_ON;
      if (dt.hollow) {
        node.setAttribute('r', f3((m.r - m.sw / 2) * r.s));
        node.setAttribute('stroke-width', f3(m.sw * r.s));
      } else {
        node.setAttribute('r', f3(m.r * r.s));
      }
      node.setAttribute('opacity', asGlyph ? 0 : f3(clamp01(r.o)));

      if (ascii) {
        const tx = av.texts[i], ch = asGlyph ? glyphFor(o.glyphs, lvl) : '';
        if (ch !== av.chars[i]) { tx.textContent = ch; av.chars[i] = ch; }
        node.setAttribute('cx', f3(x)); node.setAttribute('cy', f3(y));
        if (asGlyph) {
          tx.setAttribute('x', f3(x)); tx.setAttribute('y', f3(y));
          tx.setAttribute('font-size', f3(glyphSize * Math.max(0.85, Math.min(1.1, r.s))));
          tx.setAttribute('opacity', f3(Math.max(clamp01(r.o), av.heat[i])));
        }
      }
    }
    av.hot = hot;

    let g = groupOf(av.anim, t, env);
    if (av.prev) {
      const q = groupOf(av.prev, t, env);
      g = { dx: mix(q.dx, g.dx, p), dy: mix(q.dy, g.dy, p), rot: mix(q.rot, g.rot, p), sx: mix(q.sx, g.sx, p), sy: mix(q.sy, g.sy, p) };
    }
    av.g.setAttribute('transform',
      `translate(${f3(g.dx * m.size)} ${f3(g.dy * m.size)}) rotate(${f3(g.rot)}) scale(${f3(g.sx)} ${f3(g.sy)})`);
    av.drawn = true;
  }

  function tick(now) {
    for (const av of instances) if (av.visible) frame(av, now);
    rafId = instances.size ? requestAnimationFrame(tick) : 0;
  }

  global.AgentAvatar = {
    TW, HUES, SHADES, DEFAULTS, ANIMATIONS, STATES, GLYPHS, PATTERNS,
    hashSeed, build, toSVG, mount, speechLevel, createVoiceAnalyser,
    // Feed every avatar from one audio source (analyser or { level, pitch, bands }); null = simulated.
    setAudio: src => { globalAudio = src || null; },
  };
})(window);
