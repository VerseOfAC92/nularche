// Tuval sayfası verisi: JSON Canvas (jsoncanvas.org, Obsidian'ın açık biçimi) notun gövdesinde ```json canvas bloğunda
// saklanır. Blok dışındaki metin korunur; bilinmeyen alanlar (ör. başka araçların eklediği) olduğu gibi yazılır.

export type Side = "top" | "right" | "bottom" | "left";

export interface CanvasNode {
  id: string;
  type: "text" | "file" | "link" | "group";
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  text?: string;
  file?: string;
  url?: string;
  label?: string;
  [k: string]: unknown;
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: Side;
  toSide?: Side;
  label?: string;
  color?: string;
  [k: string]: unknown;
}

export interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  [k: string]: unknown;
}

const BLOCK_RE = /```json canvas\n([\s\S]*?)\n```/;

/** Gövdedeki tuvali okur; blok yoksa ya da bozuksa boş tuval ve hata bilgisi döner (bozuk blok üzerine yazılmaz). */
export function parseCanvas(body: string): { data: CanvasData; broken: boolean } {
  const m = BLOCK_RE.exec(body);
  if (!m) return { data: { nodes: [], edges: [] }, broken: false };
  try {
    const raw = JSON.parse(m[1]) as Partial<CanvasData>;
    const nodes = (Array.isArray(raw.nodes) ? raw.nodes : []).filter((n): n is CanvasNode => !!n && typeof n.id === "string" && Number.isFinite(n.x) && Number.isFinite(n.y));
    const edges = (Array.isArray(raw.edges) ? raw.edges : []).filter((e): e is CanvasEdge => !!e && typeof e.id === "string" && typeof e.fromNode === "string" && typeof e.toNode === "string");
    return { data: { ...raw, nodes, edges }, broken: false };
  } catch {
    return { data: { nodes: [], edges: [] }, broken: true };
  }
}

export function serializeCanvas(body: string, data: CanvasData): string {
  const block = `\`\`\`json canvas\n${JSON.stringify(data, null, 2)}\n\`\`\``;
  return BLOCK_RE.test(body) ? body.replace(BLOCK_RE, () => block) : `${body.trim() ? `${body.trimEnd()}\n\n` : ""}${block}\n`;
}

export const newId = () => Math.random().toString(16).slice(2, 18);

/** İki kart arasındaki kenar için en yakın kenarlar. */
export function autoSides(a: CanvasNode, b: CanvasNode): [Side, Side] {
  const dx = b.x + b.width / 2 - (a.x + a.width / 2);
  const dy = b.y + b.height / 2 - (a.y + a.height / 2);
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? ["right", "left"] : ["left", "right"];
  return dy > 0 ? ["bottom", "top"] : ["top", "bottom"];
}

export function anchor(n: CanvasNode, side: Side): { x: number; y: number } {
  switch (side) {
    case "top":
      return { x: n.x + n.width / 2, y: n.y };
    case "bottom":
      return { x: n.x + n.width / 2, y: n.y + n.height };
    case "left":
      return { x: n.x, y: n.y + n.height / 2 };
    default:
      return { x: n.x + n.width, y: n.y + n.height / 2 };
  }
}

/** JSON Canvas renk ön ayarları ("1"–"6") ya da #rrggbb. */
export const CANVAS_COLORS: Record<string, string> = { "1": "#f85149", "2": "#f0883e", "3": "#d29922", "4": "#3fb950", "5": "#00a8b5", "6": "#a371f7" };
export const colorValue = (c?: string) => (c ? (CANVAS_COLORS[c] ?? c) : undefined);
