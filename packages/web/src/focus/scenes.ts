// Odak modu arka planları: Nularche için çizilmiş 10 manzara (SVG, dosya gerektirmez) ve 10 renk paleti.
// Manzaralar katmanlı tepe/dağ silüetleri, gök gradyanı, güneş/ay, yıldız, ağaç ve dalgalardan oluşur.

import type { StringKey } from "../i18n/index.ts";

export type WritingBg =
  | { kind: "none" }
  | { kind: "scene"; id: string }
  | { kind: "palette"; id: string }
  | { kind: "color"; value: string }
  | { kind: "image"; path: string };

interface SceneSpec {
  id: string;
  label: StringKey;
  sky: [string, string, string];
  layers: string[];
  /** Yazı alanı koyu cam (açık metin) mı? */
  dark: boolean;
  orb?: { x: number; y: number; r: number; color: string; glow: string };
  stars?: number;
  trees?: string;
  waves?: string;
  mist?: string;
}

/** Tekrarlanabilir sözde rastgele sayılar (her çizimde aynı manzara). */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/** Yumuşak tepe/dağ silüeti: `y` taban yüksekliği, `amp` genlik, `jag` sivrilik (0 = yuvarlak tepe). */
function ridge(seed: number, y: number, amp: number, jag: number, points = 9): string {
  const r = rng(seed);
  const pts: [number, number][] = [];
  for (let i = 0; i <= points; i++) pts.push([(i / points) * 1600, y - r() * amp]);
  let d = `M0 1000 L0 ${pts[0][1].toFixed(0)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    if (jag > 0) {
      const mx = (x0 + x1) / 2;
      d += ` L${mx.toFixed(0)} ${(Math.min(y0, y1) - jag * r() * amp).toFixed(0)} L${x1.toFixed(0)} ${y1.toFixed(0)}`;
    } else {
      const cx = (x0 + x1) / 2;
      d += ` C${cx.toFixed(0)} ${y0.toFixed(0)} ${cx.toFixed(0)} ${y1.toFixed(0)} ${x1.toFixed(0)} ${y1.toFixed(0)}`;
    }
  }
  return `${d} L1600 1000 Z`;
}

function pines(seed: number, base: number, count: number, height: number): string {
  const r = rng(seed);
  let d = "";
  for (let i = 0; i < count; i++) {
    const x = r() * 1600;
    const h = height * (0.6 + r() * 0.6);
    const w = h * 0.32;
    const y = base + r() * 40;
    d += `M${x.toFixed(0)} ${(y - h).toFixed(0)} L${(x + w / 2).toFixed(0)} ${y.toFixed(0)} L${(x - w / 2).toFixed(0)} ${y.toFixed(0)} Z `;
  }
  return d;
}

function waves(y: number, rows: number): string {
  let d = "";
  for (let k = 0; k < rows; k++) {
    const yy = y + k * 26;
    d += `M0 ${yy} `;
    for (let x = 0; x <= 1600; x += 80) d += `Q${x + 40} ${yy - 6 - k} ${x + 80} ${yy} `;
  }
  return d;
}

const SCENES: SceneSpec[] = [
  {
    id: "moonlight",
    label: "scene.moonlight",
    sky: ["#0d1b2a", "#1b3a5c", "#3d6185"],
    layers: ["#2a4a6b", "#1d3550", "#12243a"],
    orb: { x: 1180, y: 230, r: 70, color: "#f4f1de", glow: "rgba(244,241,222,0.25)" },
    stars: 70,
    dark: true,
  },
  {
    id: "night",
    label: "scene.night",
    sky: ["#05060f", "#111634", "#2a2350"],
    layers: ["#1d1a3a", "#120f28", "#08071a"],
    stars: 220,
    dark: true,
  },
  {
    id: "sunset",
    label: "scene.sunset",
    sky: ["#2b1b4a", "#c2577a", "#f6b26b"],
    layers: ["#7a3d5c", "#4f2846", "#2c1730"],
    orb: { x: 800, y: 640, r: 120, color: "#ffd59e", glow: "rgba(255,190,120,0.35)" },
    dark: true,
  },
  {
    id: "peaks",
    label: "scene.peaks",
    sky: ["#a9c7e8", "#d7e6f4", "#f4f8fc"],
    layers: ["#e9eff6", "#b9c8da", "#7d93ad"],
    dark: false,
  },
  {
    id: "dunes",
    label: "scene.dunes",
    sky: ["#f3d9a4", "#f7e7c4", "#fbf3e2"],
    layers: ["#e8b86d", "#d69a4a", "#b97a32"],
    orb: { x: 1250, y: 210, r: 60, color: "#fff4d6", glow: "rgba(255,240,200,0.5)" },
    dark: false,
  },
  {
    id: "lavender",
    label: "scene.lavender",
    sky: ["#c9b6e4", "#e6d9f2", "#f8f1fb"],
    layers: ["#b39ddb", "#9575cd", "#6c4f9e"],
    dark: false,
  },
  {
    id: "sea",
    label: "scene.sea",
    sky: ["#bfe3f2", "#e1f2f8", "#f7fbfd"],
    layers: [],
    waves: "#5aa4c4",
    orb: { x: 400, y: 260, r: 55, color: "#fffbe8", glow: "rgba(255,250,220,0.6)" },
    dark: false,
  },
  {
    id: "mist",
    label: "scene.mist",
    sky: ["#9aa7b1", "#c3ccd3", "#e3e8ec"],
    layers: ["#aab5be", "#7f8d99", "#56636f"],
    mist: "rgba(235,240,244,0.55)",
    dark: false,
  },
  {
    id: "autumn",
    label: "scene.autumn",
    sky: ["#f2c48d", "#f6dcb5", "#fbefdc"],
    layers: ["#d9822b", "#b5541c", "#7a3315"],
    trees: "#5c2a12",
    dark: false,
  },
  {
    id: "pines",
    label: "scene.pines",
    sky: ["#16302b", "#2c5045", "#5d8170"],
    layers: ["#2f5446", "#1f3d33", "#132820"],
    trees: "#0c1d17",
    stars: 30,
    dark: true,
  },
];

function sceneSvg(s: SceneSpec): string {
  const r = rng(s.id.length * 7919);
  const parts: string[] = [
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.sky[0]}"/><stop offset=".55" stop-color="${s.sky[1]}"/><stop offset="1" stop-color="${s.sky[2]}"/></linearGradient>` +
      (s.orb ? `<radialGradient id="o"><stop offset="0" stop-color="${s.orb.glow}"/><stop offset="1" stop-color="${s.orb.glow}" stop-opacity="0"/></radialGradient>` : "") +
      `</defs><rect width="1600" height="1000" fill="url(#g)"/>`,
  ];
  if (s.stars) {
    let stars = "";
    for (let i = 0; i < s.stars; i++) stars += `<circle cx="${(r() * 1600).toFixed(0)}" cy="${(r() * 520).toFixed(0)}" r="${(0.6 + r() * 1.6).toFixed(1)}" opacity="${(0.4 + r() * 0.6).toFixed(2)}"/>`;
    parts.push(`<g fill="#ffffff">${stars}</g>`);
  }
  if (s.orb) parts.push(`<circle cx="${s.orb.x}" cy="${s.orb.y}" r="${s.orb.r * 3}" fill="url(#o)"/><circle cx="${s.orb.x}" cy="${s.orb.y}" r="${s.orb.r}" fill="${s.orb.color}"/>`);
  const jag = s.id === "peaks" || s.id === "mist" || s.id === "moonlight" || s.id === "night" ? 1.2 : 0;
  s.layers.forEach((color, i) => {
    parts.push(`<path d="${ridge(s.id.length * 31 + i * 101, 560 + i * 120, 240 - i * 50, jag ? jag - i * 0.3 : 0)}" fill="${color}"/>`);
    if (s.mist && i < s.layers.length - 1) parts.push(`<rect y="${600 + i * 120}" width="1600" height="160" fill="${s.mist}" opacity="0.6"/>`);
  });
  if (s.id === "peaks") parts.push(`<path d="${ridge(31 * 5, 560, 240, 1.2)}" fill="#ffffff" opacity="0.35" transform="translate(0 -6)"/>`);
  if (s.trees) parts.push(`<path d="${pines(s.id.length * 13, 900, 70, 170)}" fill="${s.trees}"/><rect y="930" width="1600" height="70" fill="${s.trees}"/>`);
  if (s.waves) parts.push(`<rect y="600" width="1600" height="400" fill="${s.waves}" opacity="0.85"/><path d="${waves(630, 14)}" stroke="#ffffff" stroke-opacity="0.35" stroke-width="2" fill="none"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">${parts.join("")}</svg>`;
}

const cache = new Map<string, string>();

export const SCENE_LIST = SCENES.map((s) => ({ id: s.id, label: s.label, dark: s.dark }));

export function sceneUrl(id: string): string | null {
  const s = SCENES.find((x) => x.id === id);
  if (!s) return null;
  if (!cache.has(id)) cache.set(id, `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(sceneSvg(s))}")`);
  return cache.get(id)!;
}

export const PALETTES: { id: string; label: StringKey; bg: string; fg: string; dark: boolean }[] = [
  { id: "paper", label: "palette.paper", bg: "#fbfaf6", fg: "#2b2a27", dark: false },
  { id: "sepia", label: "palette.sepia", bg: "#f4ecd8", fg: "#4a3b2a", dark: false },
  { id: "sage", label: "palette.sage", bg: "#e7efe4", fg: "#2f3d2c", dark: false },
  { id: "sky", label: "palette.sky", bg: "#e6f0f8", fg: "#22344a", dark: false },
  { id: "rose", label: "palette.rose", bg: "#f8e9ec", fg: "#4a2a33", dark: false },
  { id: "slate", label: "palette.slate", bg: "#2d333b", fg: "#cdd9e5", dark: true },
  { id: "ink", label: "palette.ink", bg: "#14161a", fg: "#d8dde3", dark: true },
  { id: "forest", label: "palette.forest", bg: "#1c2a24", fg: "#d6e4dc", dark: true },
  { id: "plum", label: "palette.plum", bg: "#2a1f2e", fg: "#e5d8ea", dark: true },
  { id: "midnight", label: "palette.midnight", bg: "#0f1a2e", fg: "#d3deef", dark: true },
];

/** Bir rengin koyu olup olmadığı (yazı rengini seçmek için). */
export function isDarkColor(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return true;
  const v = parseInt(m[1], 16);
  const [r, g, b] = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 140;
}

/** Arka planın CSS değerleri: zemin, metin rengi ve koyu/açık cam. */
export function backgroundStyle(bg: WritingBg, fileUrl: (p: string) => string): { background?: string; color?: string; dark?: boolean; glass: boolean } {
  switch (bg.kind) {
    case "scene": {
      const s = SCENE_LIST.find((x) => x.id === bg.id);
      const url = sceneUrl(bg.id);
      return url && s ? { background: `${url} center / cover no-repeat fixed`, dark: s.dark, glass: true } : { glass: false };
    }
    case "palette": {
      const p = PALETTES.find((x) => x.id === bg.id);
      return p ? { background: p.bg, color: p.fg, dark: p.dark, glass: false } : { glass: false };
    }
    case "color":
      return { background: bg.value, color: isDarkColor(bg.value) ? "#e6edf3" : "#1f2328", dark: isDarkColor(bg.value), glass: false };
    case "image":
      return { background: `url("${fileUrl(bg.path)}") center / cover no-repeat fixed`, dark: true, glass: true };
    default:
      return { glass: false };
  }
}
