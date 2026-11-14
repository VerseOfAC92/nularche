// Tabula (beyaz tahta) verisi: notun gövdesindeki ```json whiteboard bloğunda saklanır. Blok dışındaki metin
// korunur; bozuk blok üzerine yazılmaz. Koordinatlar dünya birimidir (yakınlaştırmadan bağımsız).

export type ItemType = "shape" | "draw" | "text" | "sticky" | "image" | "line" | "table" | "link";
export type DrawTool = "pen" | "pencil" | "marker" | "highlighter";
export type Dash = "solid" | "dashed" | "dotted";
export type ArrowHead = "none" | "arrow" | "triangle" | "circle" | "diamond" | "bar";
export type Route = "straight" | "elbow" | "curve";
export type Side = "top" | "right" | "bottom" | "left";

export interface Style {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  dash?: Dash;
  opacity?: number;
  radius?: number;
  shadow?: boolean;
  fontSize?: number;
  font?: "sans" | "serif" | "mono" | "hand";
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  textColor?: string;
}

/** Çizginin ucu: serbest nokta ya da bir öğeye bağlı (öğe taşınınca uç da gelir). */
export interface End {
  x: number;
  y: number;
  id?: string;
  side?: Side;
}

export interface Item {
  id: string;
  type: ItemType;
  x: number;
  y: number;
  w: number;
  h: number;
  rot?: number;
  flipX?: boolean;
  flipY?: boolean;
  locked?: boolean;
  group?: string;
  style: Style;
  text?: string;
  /** shape: şekil kimliği (shapes.ts). */
  shape?: string;
  /** draw: öğeye göre noktalar [x, y, basınç]. */
  points?: number[][];
  tool?: DrawTool;
  /** image: Origin içindeki dosya yolu. */
  file?: string;
  /** link: bağlı Node kimliği ya da web adresi. */
  node?: string;
  url?: string;
  /** line */
  from?: End;
  to?: End;
  route?: Route;
  startHead?: ArrowHead;
  endHead?: ArrowHead;
  /** table */
  cells?: string[][];
}

export interface Board {
  version: 1;
  items: Item[];
  background?: "dots" | "grid" | "lines" | "none";
  color?: string;
  [k: string]: unknown;
}

export const BLOCK_RE = /```json whiteboard\n([\s\S]*?)\n```/;
export const EMPTY_BODY = '```json whiteboard\n{\n  "version": 1,\n  "items": []\n}\n```\n';

const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);

export function parseBoard(body: string): { board: Board; broken: boolean } {
  const m = BLOCK_RE.exec(body);
  if (!m) return { board: { version: 1, items: [] }, broken: false };
  try {
    const raw = JSON.parse(m[1]) as Partial<Board>;
    const items = (Array.isArray(raw.items) ? raw.items : []).filter(
      (i): i is Item => !!i && typeof i.id === "string" && typeof i.type === "string" && num(i.x) && num(i.y) && num(i.w) && num(i.h),
    );
    for (const i of items) i.style ??= {};
    return { board: { ...raw, version: 1, items }, broken: false };
  } catch {
    return { board: { version: 1, items: [] }, broken: true };
  }
}

/** Noktaları kısaltarak (1 ondalık) yazar; dosya küçük kalır. */
export function serializeBoard(body: string, board: Board): string {
  const json = JSON.stringify(board, (k, v) => (typeof v === "number" && k !== "version" ? Math.round(v * 10) / 10 : v));
  const block = `\`\`\`json whiteboard\n${json}\n\`\`\``;
  return BLOCK_RE.test(body) ? body.replace(BLOCK_RE, () => block) : `${body.trim() ? `${body.trimEnd()}\n\n` : ""}${block}\n`;
}

export const newId = () => Math.random().toString(36).slice(2, 12);

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const center = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Döndürülmüş öğenin eksen hizalı sınır kutusu. */
export function bounds(i: Item): Rect {
  if (i.type === "line" && i.from && i.to) {
    const x = Math.min(i.from.x, i.to.x);
    const y = Math.min(i.from.y, i.to.y);
    return { x, y, w: Math.abs(i.to.x - i.from.x), h: Math.abs(i.to.y - i.from.y) };
  }
  if (!i.rot) return { x: i.x, y: i.y, w: i.w, h: i.h };
  const c = center(i);
  const a = (i.rot * Math.PI) / 180;
  const pts = [
    [i.x, i.y],
    [i.x + i.w, i.y],
    [i.x + i.w, i.y + i.h],
    [i.x, i.y + i.h],
  ].map(([x, y]) => rotate(x, y, c.x, c.y, a));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

export function rotate(x: number, y: number, cx: number, cy: number, a: number) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: cx + (x - cx) * c - (y - cy) * s, y: cy + (x - cx) * s + (y - cy) * c };
}

export function union(rs: Rect[]): Rect | null {
  if (!rs.length) return null;
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
}

export const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Bağlantı noktası: öğenin kenar ortası. */
export function sidePoint(r: Rect, side: Side) {
  switch (side) {
    case "top":
      return { x: r.x + r.w / 2, y: r.y };
    case "bottom":
      return { x: r.x + r.w / 2, y: r.y + r.h };
    case "left":
      return { x: r.x, y: r.y + r.h / 2 };
    default:
      return { x: r.x + r.w, y: r.y + r.h / 2 };
  }
}

/** Hedefe bakan en uygun kenar. */
export function facingSide(r: Rect, toward: { x: number; y: number }): Side {
  const c = center(r);
  const dx = (toward.x - c.x) / Math.max(r.w, 1);
  const dy = (toward.y - c.y) / Math.max(r.h, 1);
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "bottom" : "top";
}

/** Bağlı uçların güncel konumu (öğe taşınmış/silinmiş olabilir). */
export function resolveEnds(line: Item, byId: Map<string, Item>): { a: { x: number; y: number; side?: Side }; b: { x: number; y: number; side?: Side } } {
  const ra = line.from?.id ? byId.get(line.from.id) : undefined;
  const rb = line.to?.id ? byId.get(line.to.id) : undefined;
  const fa = { x: line.from?.x ?? line.x, y: line.from?.y ?? line.y };
  const fb = { x: line.to?.x ?? line.x + line.w, y: line.to?.y ?? line.y + line.h };
  const ca = ra ? center(bounds(ra)) : fa;
  const cb = rb ? center(bounds(rb)) : fb;
  const sa = ra ? (line.from?.side ?? facingSide(bounds(ra), cb)) : undefined;
  const sb = rb ? (line.to?.side ?? facingSide(bounds(rb), ca)) : undefined;
  const a = ra && sa ? { ...sidePoint(bounds(ra), sa), side: sa } : fa;
  const b = rb && sb ? { ...sidePoint(bounds(rb), sb), side: sb } : fb;
  return { a, b };
}

const dir: Record<Side, [number, number]> = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };

/** Çizginin SVG yolu ve uçlardaki yön açıları (ok başları için). */
export function linePath(a: { x: number; y: number; side?: Side }, b: { x: number; y: number; side?: Side }, route: Route = "straight") {
  if (route === "curve") {
    const d = Math.max(40, Math.hypot(b.x - a.x, b.y - a.y) / 3);
    const [ax, ay] = a.side ? dir[a.side] : [(b.x - a.x) / (Math.abs(b.x - a.x) + Math.abs(b.y - a.y) || 1), 0];
    const [bx, by] = b.side ? dir[b.side] : [(a.x - b.x) / (Math.abs(b.x - a.x) + Math.abs(b.y - a.y) || 1), 0];
    const c1 = { x: a.x + ax * d, y: a.y + ay * d };
    const c2 = { x: b.x + bx * d, y: b.y + by * d };
    return { d: `M${a.x} ${a.y} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`, startAngle: Math.atan2(a.y - c1.y, a.x - c1.x), endAngle: Math.atan2(b.y - c2.y, b.x - c2.x), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }
  if (route === "elbow") {
    const horizontalFirst = a.side ? a.side === "left" || a.side === "right" : Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
    const pts = horizontalFirst
      ? [a, { x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }, b]
      : [a, { x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 }, b];
    const [p0, p1, p2, p3] = pts;
    return {
      d: `M${p0.x} ${p0.y} L${p1.x} ${p1.y} L${p2.x} ${p2.y} L${p3.x} ${p3.y}`,
      startAngle: Math.atan2(p0.y - p1.y, p0.x - p1.x) || (horizontalFirst ? (b.x < a.x ? 0 : Math.PI) : b.y < a.y ? Math.PI / 2 : -Math.PI / 2),
      endAngle: Math.atan2(p3.y - p2.y, p3.x - p2.x) || (horizontalFirst ? (b.x > a.x ? 0 : Math.PI) : b.y > a.y ? Math.PI / 2 : -Math.PI / 2),
      mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
    };
  }
  return { d: `M${a.x} ${a.y} L${b.x} ${b.y}`, startAngle: Math.atan2(a.y - b.y, a.x - b.x), endAngle: Math.atan2(b.y - a.y, b.x - a.x), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
}

/** Ok başı yolu: uç noktada `angle` yönüne bakar. */
export function headPath(kind: ArrowHead, p: { x: number; y: number }, angle: number, size: number): { d: string; filled: boolean } | null {
  if (kind === "none") return null;
  const pt = (dx: number, dy: number) => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return `${(p.x + dx * c - dy * s).toFixed(1)} ${(p.y + dx * s + dy * c).toFixed(1)}`;
  };
  const L = size;
  switch (kind) {
    case "arrow":
      return { d: `M${pt(-L, -L * 0.55)} L${pt(0, 0)} L${pt(-L, L * 0.55)}`, filled: false };
    case "triangle":
      return { d: `M${pt(0, 0)} L${pt(-L, -L * 0.5)} L${pt(-L, L * 0.5)} Z`, filled: true };
    case "diamond":
      return { d: `M${pt(0, 0)} L${pt(-L * 0.6, -L * 0.4)} L${pt(-L * 1.2, 0)} L${pt(-L * 0.6, L * 0.4)} Z`, filled: true };
    case "circle": {
      const c = pt(-L * 0.4, 0).split(" ").map(Number);
      const r = L * 0.4;
      return { d: `M${c[0] - r} ${c[1]} A${r} ${r} 0 1 0 ${c[0] + r} ${c[1]} A${r} ${r} 0 1 0 ${c[0] - r} ${c[1]} Z`, filled: true };
    }
    case "bar":
      return { d: `M${pt(0, -L * 0.6)} L${pt(0, L * 0.6)}`, filled: false };
  }
}

export const PALETTE = ["#1f2328", "#59636e", "#ffffff", "#f85149", "#f0883e", "#d29922", "#3fb950", "#00a8b5", "#2f81f7", "#a371f7", "#db61a2", "#8b5a2b"];
export const STICKY_COLORS = ["#fff3a3", "#ffd6a5", "#ffc9de", "#d7c8ff", "#c6e2ff", "#c7f0d2", "#e9eef3"];
export const FONT_FAMILY: Record<NonNullable<Style["font"]>, string> = {
  sans: "Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",
  serif: "'Literata', 'Crimson Pro', Georgia, serif",
  mono: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
  hand: "'Comic Sans MS', 'Chalkboard SE', 'Bradley Hand', cursive",
};

/** Çizimdeki ve görsellerdeki Origin dosyaları (bağlantı izleme için). */
export const boardFiles = (b: Board) => b.items.flatMap((i) => (i.type === "image" && i.file ? [i.file] : []));
