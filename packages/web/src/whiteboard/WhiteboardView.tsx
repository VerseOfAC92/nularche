// Tabula: sonsuz beyaz tahta. Serbest çizim (kalem, kurşun kalem, keçeli, fosforlu kalem, silgi), şekil kütüphanesi,
// yapışkan notlar, metin kutuları, tablolar, görseller, not bağlantıları ve öğelere bağlanan çizgiler/oklar.
// Seçim, taşıma, boyutlandırma, döndürme, hizalama kılavuzları, gruplama, kilitleme, katman sırası, hizala/dağıt,
// çevir, geri al/yinele, kopyala/yapıştır ve PNG/SVG dışa aktarma. Tahta şeffaftır: seçilen yazma arka planı görünür.

import { getStroke } from "perfect-freehand";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { api, type NodeMeta } from "../api.ts";
import { desktop } from "../desktop.ts";
import { fileUrl } from "../editor/paths.ts";
import { getLang, t } from "../i18n/index.ts";
import { NotePicker } from "../vault/Palettes.tsx";
import { SYSTEM_FONTS } from "../notes/font-stack.ts";
import { BUNDLED_FONTS } from "../studio/fonts.ts";
import {
  bounds,
  center,
  fontFamily,
  headPath,
  intersects,
  linePath,
  newId,
  PALETTE,
  parseBoard,
  resolveEnds,
  serializeBoard,
  sidePoint,
  STICKY_COLORS,
  union,
  type ArrowHead,
  type Board,
  type Dash,
  type DrawTool,
  type Item,
  type Rect,
  type Route,
  type Side,
  type Style,
} from "./model.ts";
import { ToolIcon } from "./icons.tsx";
import { ICON_GROUPS, iconFilled, iconNodes, iconsInGroup, iconTitle, isIconShape, searchIcons, useIconData, type IconNode } from "./icons-lib.ts";
import { CATEGORIES, SHAPE_BY_ID, SHAPES, type ShapeCategory } from "./shapes.ts";
import { Icon } from "../ui/Icon.tsx";
import { addContextItems, type ContextEntry } from "../contextMenu.ts";

type Tool = "select" | "hand" | DrawTool | "eraser" | "text" | "sticky" | "shape" | "line" | "arrow" | "connector" | "table";
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

interface View {
  x: number;
  y: number;
  k: number;
}

type Drag =
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { kind: "marquee"; x0: number; y0: number; x1: number; y1: number; add: string[] }
  | { kind: "move"; sx: number; sy: number; orig: Map<string, Item>; moved: boolean }
  | { kind: "resize"; handle: Handle; id: string; orig: Item; sx: number; sy: number }
  | { kind: "rotate"; id: string; cx: number; cy: number; a0: number; rot0: number }
  | { kind: "draw"; id: string; ox: number; oy: number; pts: number[][] }
  | { kind: "create"; id: string; sx: number; sy: number }
  | { kind: "line"; id: string; end: "from" | "to" }
  | { kind: "erase" };

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const SIDES: Side[] = ["top", "right", "bottom", "left"];
const DRAW_TOOLS: DrawTool[] = ["pen", "pencil", "marker", "highlighter"];
const L = (tr: string, en: string) => (getLang() === "tr" ? tr : en);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const dashArray = (d: Dash | undefined, w: number) => (d === "dashed" ? `${w * 4} ${w * 3}` : d === "dotted" ? `${w * 0.1} ${w * 2.2}` : undefined);

/** Serbest çizim yolunun dış hattı. */
function strokeOutline(points: number[][], tool: DrawTool, size: number, simulate: boolean): string {
  const opts =
    tool === "pencil"
      ? { size: size * 0.8, thinning: 0.25, smoothing: 0.4, streamline: 0.35 }
      : tool === "marker"
        ? { size: size * 2.2, thinning: 0, smoothing: 0.6, streamline: 0.5 }
        : tool === "highlighter"
          ? { size: size * 5, thinning: 0, smoothing: 0.6, streamline: 0.6, start: { cap: false }, end: { cap: false } }
          : { size: size * 1.4, thinning: 0.55, smoothing: 0.5, streamline: 0.45 };
  const outline = getStroke(points, { ...opts, simulatePressure: simulate, last: true });
  if (!outline.length) return "";
  const d = outline.reduce(
    (acc: (string | number)[], [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0.toFixed(1), y0.toFixed(1), ((x0 + x1) / 2).toFixed(1), ((y0 + y1) / 2).toFixed(1));
      return acc;
    },
    ["M", ...outline[0].map((v) => v.toFixed(1)), "Q"],
  );
  return `${d.join(" ")} Z`;
}

const defaultStyle = (type: Item["type"], shape?: string): Style => {
  switch (type) {
    case "sticky":
      return { fill: STICKY_COLORS[0], fontSize: 18, align: "left", valign: "top", shadow: true, font: "hand" };
    case "text":
      return { fontSize: 20, align: "left", valign: "top" };
    case "line":
      return { strokeWidth: 2 };
    case "table":
      return { fontSize: 14, strokeWidth: 1 };
    case "shape":
      return { strokeWidth: 2, fontSize: 16, align: "center", valign: "middle", ...(shape === "uml-initial" || shape === "uml-final" || shape === "uml-fork" ? { fill: "var(--wb-ink)" } : {}) };
    default:
      return {};
  }
};

export function WhiteboardView({ body, nodes, onChange, onOpen }: { body: string; nodes: NodeMeta[]; onChange: (body: string) => void; onOpen: (id: string) => void }) {
  const parsed = useMemo(() => parseBoard(body), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [board, setBoard] = useState<Board>(parsed.board);
  const items = board.items;
  useIconData(items.some((i) => isIconShape(i.shape)));
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [tool, setTool] = useState<Tool>("select");
  const [shapeId, setShapeId] = useState("rounded");
  const [library, setLibrary] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ id: string; cell?: [number, number] } | null>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (d: Drag | null) => ((dragRef.current = d), setDragState(d));
  const [guides, setGuides] = useState<{ x?: number; y?: number }[]>([]);
  const [hoverTarget, setHoverTarget] = useState<string | null>(null);
  const [pen, setPen] = useState<{ color: string; size: number }>({ color: "var(--wb-ink)", size: 3 });
  const [snap, setSnap] = useState(false);
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<"background" | "export" | null>(null);
  const [space, setSpace] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const world = useRef<SVGGElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  // Araç çubuğu dar pencerede satır atlar; paneller onun gerçek alt kenarının altında açılır.
  const [barBottom, setBarBottom] = useState(56);
  const [panelOpen, setPanelOpen] = useState(true);
  useEffect(() => {
    const el = toolbar.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBarBottom(el.offsetTop + el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const undoStack = useRef<Item[][]>([]);
  const redoStack = useRef<Item[][]>([]);
  const clipboard = useRef<Item[]>([]);
  const first = useRef(true);

  // Kaydet (bozuk blok varsa üzerine yazılmaz).
  useEffect(() => {
    if (first.current) return void (first.current = false);
    if (parsed.broken) return;
    const timer = setTimeout(() => onChange(serializeBoard(bodyRef.current, board)), 500);
    return () => clearTimeout(timer);
  }, [board]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Görünüm -----------------------------------------------------------------------------------
  const toWorld = useCallback(
    (cx: number, cy: number) => {
      const r = svg.current!.getBoundingClientRect();
      return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k };
    },
    [view],
  );
  const fit = useCallback(
    (only?: Item[]) => {
      const el = svg.current;
      if (!el) return;
      const bb = union((only ?? board.items).map(bounds));
      const W = el.clientWidth;
      const H = el.clientHeight;
      if (!bb) return setView({ x: W / 2, y: H / 3, k: 1 });
      const k = clamp(Math.min((W - 120) / Math.max(bb.w, 1), (H - 160) / Math.max(bb.h, 1)), 0.1, 1.5);
      setView({ k, x: W / 2 - (bb.x + bb.w / 2) * k, y: H / 2 + 20 - (bb.y + bb.h / 2) * k });
    },
    [board.items],
  );
  useEffect(() => fit(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const zoomAt = (factor: number, cx?: number, cy?: number) => {
    const el = svg.current!;
    const r = el.getBoundingClientRect();
    const px = cx ?? r.left + r.width / 2;
    const py = cy ?? r.top + r.height / 2;
    setView((v) => {
      const k = clamp(v.k * factor, 0.1, 6);
      const wx = (px - r.left - v.x) / v.k;
      const wy = (py - r.top - v.y) / v.k;
      return { k, x: px - r.left - wx * k, y: py - r.top - wy * k };
    });
  };
  useEffect(() => {
    const el = svg.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Çimdik/Ctrl+tekerlek yakınlaştırır; iki parmakla kaydırma ve tekerlek tahtayı kaydırır.
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), e.clientX, e.clientY);
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // --- Değişiklik ve geçmiş -----------------------------------------------------------------------
  const remember = () => {
    undoStack.current.push(board.items);
    if (undoStack.current.length > 200) undoStack.current.shift();
    redoStack.current = [];
  };
  const setItems = (fn: (items: Item[]) => Item[]) => setBoard((b) => ({ ...b, items: fn(b.items) }));
  const change = (fn: (items: Item[]) => Item[]) => (remember(), setItems(fn));
  const patch = (ids: string[], p: Partial<Item> | ((i: Item) => Partial<Item>)) =>
    change((all) => all.map((i) => (ids.includes(i.id) ? { ...i, ...(typeof p === "function" ? p(i) : p) } : i)));
  const patchStyle = (s: Partial<Style>) => patch(selected, (i) => ({ style: { ...i.style, ...s } }));
  const undo = () => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push(board.items);
    setItems(() => prev);
    setSelected((s) => s.filter((id) => prev.some((i) => i.id === id)));
  };
  const redo = () => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(board.items);
    setItems(() => next);
  };

  /** Grup üyeleri birlikte seçilir. */
  const withGroups = (ids: string[]) => {
    const groups = new Set(ids.map((id) => byId.get(id)?.group).filter(Boolean));
    return [...new Set([...ids, ...items.filter((i) => i.group && groups.has(i.group)).map((i) => i.id)])];
  };
  const sel = selected.map((id) => byId.get(id)).filter((i): i is Item => !!i);
  const single = sel.length === 1 ? sel[0] : null;

  const add = (item: Omit<Item, "id"> & { id?: string }, select = true) => {
    const it = { ...item, id: item.id ?? newId() } as Item;
    change((all) => [...all, it]);
    if (select) setSelected([it.id]);
    return it;
  };

  const removeSelected = () => {
    if (!selected.length) return;
    const gone = new Set(selected.filter((id) => !byId.get(id)?.locked));
    change((all) =>
      all
        .filter((i) => !gone.has(i.id))
        .map((i) => {
          if (i.type !== "line") return i;
          // Silinen öğeye bağlı çizgi uçları serbest kalır.
          const { a, b } = resolveEnds(i, byId);
          return { ...i, from: i.from?.id && gone.has(i.from.id) ? { x: a.x, y: a.y } : i.from, to: i.to?.id && gone.has(i.to.id) ? { x: b.x, y: b.y } : i.to };
        }),
    );
    setSelected([]);
  };

  // --- Öğe oluşturma -------------------------------------------------------------------------------
  const snapV = (v: number) => (snap ? Math.round(v / 10) * 10 : v);
  const createAt = (kind: Tool, p: { x: number; y: number }): Item | null => {
    if (kind === "shape" && isIconShape(shapeId)) {
      const filled = iconFilled(shapeId);
      return add({ type: "shape", shape: shapeId, x: snapV(p.x - 60), y: snapV(p.y - 60), w: 120, h: 120, style: { strokeWidth: 2, ...(filled ? {} : { fill: "transparent" }), fontSize: 14, align: "center" }, text: "" });
    }
    if (kind === "shape") {
      const def = SHAPE_BY_ID.get(shapeId);
      const [w, h] = def?.size ?? [150, 100];
      return add({ type: "shape", shape: shapeId, x: snapV(p.x - w / 2), y: snapV(p.y - h / 2), w, h, style: defaultStyle("shape", shapeId), text: "" });
    }
    if (kind === "sticky") return add({ type: "sticky", x: snapV(p.x - 100), y: snapV(p.y - 100), w: 200, h: 200, style: defaultStyle("sticky"), text: "" });
    if (kind === "text") return add({ type: "text", x: snapV(p.x), y: snapV(p.y - 14), w: 260, h: 34, style: defaultStyle("text"), text: "" });
    if (kind === "table") {
      const cells = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ""));
      return add({ type: "table", x: snapV(p.x - 180), y: snapV(p.y - 60), w: 360, h: 120, style: defaultStyle("table"), cells });
    }
    return null;
  };

  async function addImageFiles(files: File[], at?: { x: number; y: number }) {
    const el = svg.current!;
    const r = el.getBoundingClientRect();
    let p = at ?? toWorld(r.left + r.width / 2, r.top + r.height / 2);
    for (const file of files.filter((f) => f.type.startsWith("image/"))) {
      try {
        const { path } = await api.upload(file);
        const img = new Image();
        img.src = fileUrl(path);
        await img.decode().catch(() => undefined);
        const scale = Math.min(1, 480 / Math.max(img.naturalWidth || 480, img.naturalHeight || 360));
        const w = (img.naturalWidth || 480) * scale;
        const h = (img.naturalHeight || 360) * scale;
        add({ type: "image", file: path, x: p.x - w / 2, y: p.y - h / 2, w, h, style: {} });
        p = { x: p.x + 30, y: p.y + 30 };
      } catch (e) {
        alert((e as Error).message);
      }
    }
  }

  // --- İşaretçi -------------------------------------------------------------------------------------
  const itemAt = (cx: number, cy: number): Item | null => {
    const el = document.elementFromPoint(cx, cy)?.closest<SVGElement>("[data-id]");
    return el ? (byId.get(el.dataset.id!) ?? null) : null;
  };

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button === 2) return;
    root.current?.focus({ preventScroll: true });
    setMenu(null);
    setLibrary(false);
    if (editing) setEditing(null);
    const p = toWorld(e.clientX, e.clientY);
    const target = e.target as Element;
    const handle = target.closest<SVGElement>("[data-handle]")?.dataset.handle;
    const hitEl = target.closest<SVGElement>("[data-id]");
    const hit = hitEl ? byId.get(hitEl.dataset.id!) : undefined;
    e.currentTarget.setPointerCapture(e.pointerId);

    if (e.button === 1 || tool === "hand" || space) return setDrag({ kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y });

    if (handle && single) {
      if (handle === "rot") {
        const c = center(single);
        remember();
        return setDrag({ kind: "rotate", id: single.id, cx: c.x, cy: c.y, a0: Math.atan2(p.y - c.y, p.x - c.x), rot0: single.rot ?? 0 });
      }
      if (handle === "from" || handle === "to") {
        remember();
        return setDrag({ kind: "line", id: single.id, end: handle });
      }
      if (handle.startsWith("conn-")) {
        // Bağlantı noktasından sürükle: bu öğeden başlayan bağlayıcı.
        const side = handle.slice(5) as Side;
        const sp = sidePoint(bounds(single), side);
        const it = add({ type: "line", x: sp.x, y: sp.y, w: 0, h: 0, from: { x: sp.x, y: sp.y, id: single.id, side }, to: { x: p.x, y: p.y }, route: "elbow", endHead: "triangle", style: defaultStyle("line") }, true);
        return setDrag({ kind: "line", id: it.id, end: "to" });
      }
      if (!single.locked) {
        remember();
        return setDrag({ kind: "resize", handle: handle as Handle, id: single.id, orig: single, sx: p.x, sy: p.y });
      }
    }

    if (DRAW_TOOLS.includes(tool as DrawTool)) {
      const id = newId();
      const pts = [[0, 0, e.pressure || 0.5]];
      remember();
      setItems((all) => [...all, { id, type: "draw", tool: tool as DrawTool, x: p.x, y: p.y, w: 1, h: 1, points: pts, style: { stroke: pen.color, strokeWidth: pen.size, opacity: tool === "highlighter" ? 0.35 : tool === "pencil" ? 0.85 : 1 } }]);
      return setDrag({ kind: "draw", id, ox: p.x, oy: p.y, pts });
    }
    if (tool === "eraser") {
      remember();
      if (hit?.type === "draw") setItems((all) => all.filter((i) => i.id !== hit.id));
      return setDrag({ kind: "erase" });
    }
    if (tool === "line" || tool === "arrow" || tool === "connector") {
      const from = hit && hit.type !== "line" ? { x: p.x, y: p.y, id: hit.id } : { x: snapV(p.x), y: snapV(p.y) };
      const it = add({ type: "line", x: p.x, y: p.y, w: 0, h: 0, from, to: { x: p.x, y: p.y }, route: tool === "connector" ? "elbow" : "straight", endHead: tool === "line" ? "none" : "triangle", style: { ...defaultStyle("line"), stroke: pen.color === "var(--wb-ink)" ? undefined : pen.color } });
      return setDrag({ kind: "line", id: it.id, end: "to" });
    }
    if (tool === "shape" || tool === "sticky" || tool === "text" || tool === "table") {
      const it = createAt(tool, p);
      if (it && tool !== "text") setDrag({ kind: "create", id: it.id, sx: p.x, sy: p.y });
      if (it && (tool === "text" || tool === "sticky")) setTimeout(() => setEditing({ id: it.id }), 0);
      setTool("select");
      return;
    }

    // Seçim aracı
    if (hit) {
      let ids = selected.includes(hit.id) ? selected : withGroups([hit.id]);
      if (e.shiftKey || e.metaKey) ids = selected.includes(hit.id) ? selected.filter((i) => !withGroups([hit.id]).includes(i)) : withGroups([...selected, hit.id]);
      setSelected(ids);
      if (e.altKey && ids.length) {
        // Alt ile sürükle: kopyasını taşı.
        const copies = ids.map((id) => byId.get(id)!).map((i) => ({ ...structuredClone(i), id: newId() }));
        remember();
        setItems((all) => [...all, ...copies]);
        setSelected(copies.map((c) => c.id));
        return setDrag({ kind: "move", sx: p.x, sy: p.y, orig: new Map(copies.map((c) => [c.id, c])), moved: false });
      }
      const movable = ids.map((id) => byId.get(id)!).filter((i) => i && !i.locked);
      remember();
      return setDrag({ kind: "move", sx: p.x, sy: p.y, orig: new Map(movable.map((i) => [i.id, i])), moved: false });
    }
    if (!e.shiftKey) setSelected([]);
    setDrag({ kind: "marquee", x0: p.x, y0: p.y, x1: p.x, y1: p.y, add: e.shiftKey ? selected : [] });
  };

  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const p = toWorld(e.clientX, e.clientY);
    switch (d.kind) {
      case "pan":
        return setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }));
      case "marquee":
        return setDrag({ ...d, x1: p.x, y1: p.y });
      case "draw": {
        const evs = (e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]) as PointerEvent[];
        for (const ev of evs) {
          const q = toWorld(ev.clientX, ev.clientY);
          d.pts.push([q.x - d.ox, q.y - d.oy, ev.pressure || 0.5]);
        }
        const pts = [...d.pts];
        return setItems((all) => all.map((i) => (i.id === d.id ? { ...i, points: pts } : i)));
      }
      case "erase": {
        const hit = itemAt(e.clientX, e.clientY);
        if (hit?.type === "draw") setItems((all) => all.filter((i) => i.id !== hit.id));
        return;
      }
      case "line": {
        const over = itemAt(e.clientX, e.clientY);
        const target = over && over.id !== d.id && over.type !== "line" ? over : null;
        setHoverTarget(target?.id ?? null);
        const end = target ? { x: p.x, y: p.y, id: target.id } : { x: snapV(p.x), y: snapV(p.y) };
        return setItems((all) => all.map((i) => (i.id === d.id ? { ...i, [d.end]: end } : i)));
      }
      case "create": {
        const w = Math.abs(p.x - d.sx);
        const h = Math.abs(p.y - d.sy);
        if (w < 8 && h < 8) return;
        return setItems((all) => all.map((i) => (i.id === d.id ? { ...i, x: snapV(Math.min(p.x, d.sx)), y: snapV(Math.min(p.y, d.sy)), w: Math.max(20, snapV(w)), h: Math.max(20, snapV(h)) } : i)));
      }
      case "rotate": {
        let rot = d.rot0 + ((Math.atan2(p.y - d.cy, p.x - d.cx) - d.a0) * 180) / Math.PI;
        if (e.shiftKey) rot = Math.round(rot / 15) * 15;
        rot = ((rot % 360) + 360) % 360;
        return setItems((all) => all.map((i) => (i.id === d.id ? { ...i, rot: Math.abs(rot) < 2 || Math.abs(rot - 360) < 2 ? 0 : rot } : i)));
      }
      case "resize": {
        const o = d.orig;
        // Döndürülmüş öğede fare hareketi öğenin kendi eksenlerine çevrilir.
        const a = (-(o.rot ?? 0) * Math.PI) / 180;
        const dx0 = p.x - d.sx;
        const dy0 = p.y - d.sy;
        const dx = dx0 * Math.cos(a) - dy0 * Math.sin(a);
        const dy = dx0 * Math.sin(a) + dy0 * Math.cos(a);
        let { x, y, w, h } = o;
        if (d.handle.includes("e")) w = o.w + dx;
        if (d.handle.includes("s")) h = o.h + dy;
        if (d.handle.includes("w")) (w = o.w - dx), (x = o.x + dx);
        if (d.handle.includes("n")) (h = o.h - dy), (y = o.y + dy);
        const keep = e.shiftKey || o.type === "image" || (o.type === "shape" && (o.shape === "circle" || o.shape === "square"));
        if (keep && d.handle.length === 2) {
          const r = o.w / o.h;
          if (Math.abs(w / o.w) > Math.abs(h / o.h)) h = w / r;
          else w = h * r;
          if (d.handle.includes("w")) x = o.x + o.w - w;
          if (d.handle.includes("n")) y = o.y + o.h - h;
        }
        w = Math.max(12, w);
        h = Math.max(12, h);
        const sx = w / o.w;
        const sy = h / o.h;
        return setItems((all) =>
          all.map((i) => (i.id === d.id ? { ...i, x: snapV(x), y: snapV(y), w: snapV(w) || w, h: snapV(h) || h, ...(o.points ? { points: o.points.map(([px, py, pr]) => [px * sx, py * sy, pr]) } : {}) } : i)),
        );
      }
      case "move": {
        let dx = p.x - d.sx;
        let dy = p.y - d.sy;
        if (!d.moved && Math.hypot(dx, dy) * view.k < 3) return;
        d.moved = true;
        if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
        // Hizalama kılavuzları: taşınan grubun kenar ve ortaları diğer öğelerinkine yakınsa yapışır.
        const moving = [...d.orig.values()];
        const bb = union(moving.map(bounds));
        const g: { x?: number; y?: number }[] = [];
        if (bb && !snap) {
          const tol = 6 / view.k;
          const others = items.filter((i) => !d.orig.has(i.id) && i.type !== "line").map(bounds);
          const xs = [bb.x + dx, bb.x + dx + bb.w / 2, bb.x + dx + bb.w];
          const ys = [bb.y + dy, bb.y + dy + bb.h / 2, bb.y + dy + bb.h];
          let bestX: [number, number] | null = null;
          let bestY: [number, number] | null = null;
          for (const o of others) {
            for (const ox of [o.x, o.x + o.w / 2, o.x + o.w]) for (const mx of xs) if (Math.abs(ox - mx) < tol && (!bestX || Math.abs(ox - mx) < Math.abs(bestX[1]))) bestX = [ox, ox - mx];
            for (const oy of [o.y, o.y + o.h / 2, o.y + o.h]) for (const my of ys) if (Math.abs(oy - my) < tol && (!bestY || Math.abs(oy - my) < Math.abs(bestY[1]))) bestY = [oy, oy - my];
          }
          if (bestX) (dx += bestX[1]), g.push({ x: bestX[0] });
          if (bestY) (dy += bestY[1]), g.push({ y: bestY[0] });
        }
        setGuides(g);
        return setItems((all) =>
          all.map((i) => {
            const o = d.orig.get(i.id);
            if (!o) return i;
            if (o.type === "line") {
              return { ...i, from: o.from && !o.from.id ? { ...o.from, x: o.from.x + dx, y: o.from.y + dy } : o.from, to: o.to && !o.to.id ? { ...o.to, x: o.to.x + dx, y: o.to.y + dy } : o.to };
            }
            return { ...i, x: snap ? snapV(o.x + dx) : o.x + dx, y: snap ? snapV(o.y + dy) : o.y + dy };
          }),
        );
      }
    }
  };

  const onPointerUp = (e: RPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    setDrag(null);
    setGuides([]);
    setHoverTarget(null);
    if (!d) return;
    if (d.kind === "marquee") {
      const r: Rect = { x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) };
      if (r.w * view.k > 3 || r.h * view.k > 3) setSelected(withGroups([...d.add, ...items.filter((i) => intersects(bounds(i), r)).map((i) => i.id)]));
    } else if (d.kind === "draw") {
      // Noktaları sınır kutusuna göre yeniden konumlandır.
      setItems((all) =>
        all.map((i) => {
          if (i.id !== d.id || !i.points) return i;
          const pad = (i.style.strokeWidth ?? 3) * (i.tool === "highlighter" ? 3 : 1.5);
          const xs = i.points.map((q) => q[0]);
          const ys = i.points.map((q) => q[1]);
          const mx = Math.min(...xs) - pad;
          const my = Math.min(...ys) - pad;
          return { ...i, x: i.x + mx, y: i.y + my, w: Math.max(...xs) - mx + pad, h: Math.max(...ys) - my + pad, points: i.points.map(([x, y, pr]) => [Math.round((x - mx) * 10) / 10, Math.round((y - my) * 10) / 10, Math.round(pr * 100) / 100]) };
        }),
      );
    } else if (d.kind === "line") {
      const it = byId.get(d.id);
      if (it?.from && it.to && Math.hypot(it.to.x - it.from.x, it.to.y - it.from.y) < 4 && !it.to.id && !it.from.id) {
        // Tıklayıp bırakmak: varsayılan uzunlukta çizgi.
        setItems((all) => all.map((i) => (i.id === d.id ? { ...i, to: { x: it.from!.x + 160, y: it.from!.y } } : i)));
      }
      if (tool !== "select") setTool("select");
    } else if (d.kind === "move" && !d.moved) {
      undoStack.current.pop();
      // Tıklama: tek öğe seçiliyse ve yazı içeriyorsa düzenleme bir sonraki çift tıklamada açılır.
      if (!e.shiftKey && !e.metaKey) {
        const hit = itemAt(e.clientX, e.clientY);
        if (hit) setSelected(withGroups([hit.id]));
      }
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const hit = itemAt(e.clientX, e.clientY);
    if (!hit) {
      // Boşluğa çift tıkla: metin kutusu.
      const p = toWorld(e.clientX, e.clientY);
      const it = createAt("text", p);
      if (it) setTimeout(() => setEditing({ id: it.id }), 0);
      return;
    }
    if (hit.locked) return;
    if (hit.type === "link") return hit.node ? onOpen(hit.node) : hit.url && (desktop ? void desktop.openExternal(hit.url) : window.open(hit.url, "_blank"));
    if (hit.type === "table" && hit.cells) {
      const p = toWorld(e.clientX, e.clientY);
      const rows = hit.cells.length;
      const cols = hit.cells[0]?.length ?? 1;
      const r = clamp(Math.floor(((p.y - hit.y) / hit.h) * rows), 0, rows - 1);
      const c = clamp(Math.floor(((p.x - hit.x) / hit.w) * cols), 0, cols - 1);
      return setEditing({ id: hit.id, cell: [r, c] });
    }
    if (hit.type === "shape" || hit.type === "sticky" || hit.type === "text" || hit.type === "line") setEditing({ id: hit.id });
  };

  // --- Klavye ------------------------------------------------------------------------------------------
  const copy = () => (clipboard.current = sel.map((i) => structuredClone(i)));
  const paste = (offset = 24) => {
    if (!clipboard.current.length) return;
    const ids = new Map(clipboard.current.map((i) => [i.id, newId()]));
    const groups = new Map<string, string>();
    const copies = clipboard.current.map((i) => {
      const c = structuredClone(i);
      c.id = ids.get(i.id)!;
      if (c.group) c.group = groups.get(c.group) ?? (groups.set(c.group, newId()), groups.get(c.group)!);
      c.x += offset;
      c.y += offset;
      if (c.type === "line") {
        for (const k of ["from", "to"] as const) {
          const end = c[k];
          if (!end) continue;
          c[k] = end.id && ids.has(end.id) ? { ...end, id: ids.get(end.id) } : { x: end.x + offset, y: end.y + offset };
        }
      }
      return c;
    });
    change((all) => [...all, ...copies]);
    setSelected(copies.map((c) => c.id));
    clipboard.current = copies;
  };
  const arrange = (how: "front" | "back" | "forward" | "backward") =>
    change((all) => {
      const ids = new Set(selected);
      const picked = all.filter((i) => ids.has(i.id));
      const rest = all.filter((i) => !ids.has(i.id));
      if (how === "front") return [...rest, ...picked];
      if (how === "back") return [...picked, ...rest];
      const arr = [...all];
      const order = how === "forward" ? [...arr.keys()].reverse() : [...arr.keys()];
      for (const idx of order) {
        if (!ids.has(arr[idx].id)) continue;
        const j = how === "forward" ? idx + 1 : idx - 1;
        if (j < 0 || j >= arr.length || ids.has(arr[j].id)) continue;
        [arr[idx], arr[j]] = [arr[j], arr[idx]];
      }
      return arr;
    });
  const group = () => {
    if (sel.length < 2) return;
    const g = newId();
    patch(selected, { group: g });
  };
  const ungroup = () => patch(selected, { group: undefined });
  // Sağ tık menüsündeki işlemler menü kapandıktan sonra çalışır; en güncel seçimi görsünler diye bir ref üzerinden çağrılır.
  const act = useRef({ copy, paste, removeSelected, arrange, group, ungroup, lock: (on: boolean) => patch(selected, { locked: on }) });
  act.current = { copy, paste, removeSelected, arrange, group, ungroup, lock: (on: boolean) => patch(selected, { locked: on }) };
  const onContext = (e: { clientX: number; clientY: number }) => {
    const hit = itemAt(e.clientX, e.clientY);
    if (!hit) {
      addContextItems([
        { label: L("Yapıştır", "Paste"), enabled: clipboard.current.length > 0, run: () => act.current.paste() },
        { label: L("Tümünü seç", "Select All"), enabled: items.length > 0, run: () => setSelected(items.map((i) => i.id)) },
        { label: L("Sığdır", "Zoom to Fit"), enabled: items.length > 0, run: () => fit() },
      ]);
      return;
    }
    const ids = selected.includes(hit.id) ? selected : [hit.id];
    if (!selected.includes(hit.id)) setSelected(ids);
    const picked = ids.map((id) => byId.get(id)).filter((i): i is Item => !!i);
    const locked = picked.every((i) => i.locked);
    const editable = ids.length === 1 && (hit.type === "shape" || hit.type === "sticky" || hit.type === "text" || hit.type === "line");
    const entries: (ContextEntry | false)[] = [
      editable && { label: L("Yazıyı düzenle", "Edit Text"), run: () => setEditing({ id: hit.id }) },
      editable && "separator",
      { label: L("Kopyala", "Copy"), run: () => act.current.copy() },
      { label: L("Yapıştır", "Paste"), enabled: clipboard.current.length > 0, run: () => act.current.paste() },
      { label: L("Çoğalt", "Duplicate"), run: () => (act.current.copy(), act.current.paste(16)) },
      "separator",
      { label: L("En öne getir", "Bring to Front"), run: () => act.current.arrange("front") },
      { label: L("En arkaya gönder", "Send to Back"), run: () => act.current.arrange("back") },
      ids.length > 1 && { label: L("Grupla", "Group"), run: () => act.current.group() },
      picked.some((i) => i.group) && { label: L("Grubu çöz", "Ungroup"), run: () => act.current.ungroup() },
      { label: locked ? L("Kilidi aç", "Unlock") : L("Kilitle", "Lock"), run: () => act.current.lock(!locked) },
      "separator",
      { label: L("Sil", "Delete"), run: () => act.current.removeSelected() },
    ];
    addContextItems(entries.filter((x): x is ContextEntry => !!x));
  };
  const align = (how: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom") => {
    const bb = union(sel.map(bounds));
    if (!bb || sel.length < 2) return;
    patch(selected, (i) => {
      const b = bounds(i);
      const dx = how === "left" ? bb.x - b.x : how === "right" ? bb.x + bb.w - b.x - b.w : how === "hcenter" ? bb.x + bb.w / 2 - b.x - b.w / 2 : 0;
      const dy = how === "top" ? bb.y - b.y : how === "bottom" ? bb.y + bb.h - b.y - b.h : how === "vcenter" ? bb.y + bb.h / 2 - b.y - b.h / 2 : 0;
      return { x: i.x + dx, y: i.y + dy };
    });
  };
  const distribute = (axis: "h" | "v") => {
    if (sel.length < 3) return;
    const sorted = [...sel].sort((a, b) => (axis === "h" ? bounds(a).x - bounds(b).x : bounds(a).y - bounds(b).y));
    const bs = sorted.map(bounds);
    const total = axis === "h" ? bs[bs.length - 1].x + bs[bs.length - 1].w - bs[0].x : bs[bs.length - 1].y + bs[bs.length - 1].h - bs[0].y;
    const sizes = bs.reduce((s, b) => s + (axis === "h" ? b.w : b.h), 0);
    const gap = (total - sizes) / (bs.length - 1);
    let cur = axis === "h" ? bs[0].x : bs[0].y;
    const pos = new Map<string, number>();
    sorted.forEach((it, k) => {
      pos.set(it.id, cur - (axis === "h" ? bs[k].x : bs[k].y));
      cur += (axis === "h" ? bs[k].w : bs[k].h) + gap;
    });
    patch(selected, (i) => (axis === "h" ? { x: i.x + (pos.get(i.id) ?? 0) } : { y: i.y + (pos.get(i.id) ?? 0) }));
  };
  const flip = (axis: "x" | "y") =>
    patch(selected, (i) =>
      i.type === "draw" && i.points
        ? { points: i.points.map(([x, y, pr]) => (axis === "x" ? [i.w - x, y, pr] : [x, i.h - y, pr])) }
        : i.type === "line"
          ? {}
          : axis === "x"
            ? { flipX: !i.flipX }
            : { flipY: !i.flipY },
    );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing || (e.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    const stop = () => (e.preventDefault(), e.stopPropagation());
    if (k === " ") return stop(), setSpace(true);
    if (mod && k === "z") return stop(), e.shiftKey ? redo() : undo();
    if (mod && k === "y") return stop(), redo();
    if (mod && k === "a") return stop(), setSelected(items.map((i) => i.id));
    if (mod && k === "c") return stop(), copy();
    if (mod && k === "x") return stop(), copy(), removeSelected();
    if (mod && k === "v") return stop(), paste();
    if (mod && k === "d") return stop(), copy(), paste(16);
    if (mod && k === "g") return stop(), e.shiftKey ? ungroup() : group();
    if (mod && k === "l") return stop(), patch(selected, (i) => ({ locked: !i.locked }));
    if (mod && e.key === "]") return stop(), arrange(e.shiftKey ? "front" : "forward");
    if (mod && e.key === "[") return stop(), arrange(e.shiftKey ? "back" : "backward");
    if (mod && (k === "=" || k === "+")) return stop(), zoomAt(1.2);
    if (mod && k === "-") return stop(), zoomAt(1 / 1.2);
    if (mod && k === "0") return stop(), setView((v) => ({ ...v, k: 1 }));
    if (mod && k === "1") return stop(), fit();
    if (mod) return;
    if (k === "backspace" || k === "delete") return stop(), removeSelected();
    if (k === "escape") return stop(), setSelected([]), setTool("select"), setLibrary(false);
    if (k === "enter" && single) return stop(), setEditing({ id: single.id, cell: single.type === "table" ? [0, 0] : undefined });
    if (k.startsWith("arrow") && selected.length) {
      stop();
      const s = e.shiftKey ? 10 : 1;
      const [dx, dy] = k === "arrowleft" ? [-s, 0] : k === "arrowright" ? [s, 0] : k === "arrowup" ? [0, -s] : [0, s];
      return patch(
        selected.filter((id) => !byId.get(id)?.locked),
        (i) => (i.type === "line" ? { from: i.from && !i.from.id ? { ...i.from, x: i.from.x + dx, y: i.from.y + dy } : i.from, to: i.to && !i.to.id ? { ...i.to, x: i.to.x + dx, y: i.to.y + dy } : i.to } : { x: i.x + dx, y: i.y + dy }),
      );
    }
    const keyTools: Record<string, Tool> = { v: "select", h: "hand", p: "pen", b: "marker", e: "eraser", t: "text", s: "sticky", l: "line", a: "arrow", c: "connector" };
    if (keyTools[k]) return stop(), setTool(keyTools[k]);
    if (k === "r" || k === "o" || k === "d") return stop(), setShapeId(k === "r" ? "rect" : k === "o" ? "ellipse" : "diamond"), setTool("shape");
  };
  const onKeyUp = (e: React.KeyboardEvent) => e.key === " " && setSpace(false);

  // Görsel yapıştır / bırak.
  useEffect(() => {
    const el = root.current!;
    const onPaste = (e: ClipboardEvent) => {
      if (!el.contains(document.activeElement) || editing) return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) {
        e.preventDefault();
        void addImageFiles(files);
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  });

  // --- Dışa aktarma ---------------------------------------------------------------------------------------
  async function exportBoard(kind: "png" | "svg") {
    setMenu(null);
    const g = world.current;
    const bb = union(items.map(bounds));
    if (!g || !bb) return;
    const pad = 32;
    const clone = g.cloneNode(true) as SVGGElement;
    clone.removeAttribute("transform");
    clone.querySelectorAll(".wb-ui").forEach((n) => n.remove());
    // Tema değişkenlerini gerçek renklerle değiştir; görselleri dosyaya göm.
    const cs = getComputedStyle(root.current!);
    for (const img of clone.querySelectorAll("image")) {
      const href = img.getAttribute("href");
      if (!href) continue;
      try {
        const blob = await (await fetch(href)).blob();
        const data = await new Promise<string>((res) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.readAsDataURL(blob);
        });
        img.setAttribute("href", data);
      } catch {
        // görsel okunamadı: bağlantı kalır
      }
    }
    let markup = new XMLSerializer().serializeToString(clone).replace(/var\((--[\w-]+)\)/g, (_m, v: string) => cs.getPropertyValue(v).trim() || "#000");
    const bg = board.color ?? (cs.getPropertyValue("--wb-export-bg").trim() || "#ffffff");
    const svgText = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${Math.ceil(bb.w + pad * 2)}" height="${Math.ceil(bb.h + pad * 2)}" viewBox="${bb.x - pad} ${bb.y - pad} ${bb.w + pad * 2} ${bb.h + pad * 2}"><rect x="${bb.x - pad}" y="${bb.y - pad}" width="${bb.w + pad * 2}" height="${bb.h + pad * 2}" fill="${bg}"/>${markup}</svg>`;
    markup = "";
    const name = `Tabula-${new Date().toISOString().slice(0, 10)}`;
    const save = (blob: Blob, ext: string) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${name}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    if (kind === "svg") return save(new Blob([svgText], { type: "image/svg+xml" }), "svg");
    const img = new Image();
    img.src = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
    await img.decode();
    const scale = Math.min(2, 8000 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(img.src);
    canvas.toBlob((b) => b && save(b, "png"), "image/png");
  }

  // --- Çizim ----------------------------------------------------------------------------------------------
  const textBox = (i: Item): Rect => {
    if (i.type === "shape") {
      const [l, tp, r, b] = isIconShape(i.shape) ? [-0.3, 1.02, 1.3, 1.4] : (SHAPE_BY_ID.get(i.shape ?? "")?.text ?? [0.06, 0.06, 0.94, 0.94]);
      return { x: i.x + l * i.w, y: i.y + tp * i.h, w: (r - l) * i.w, h: (b - tp) * i.h };
    }
    if (i.type === "sticky") return { x: i.x + 14, y: i.y + 14, w: i.w - 28, h: i.h - 28 };
    if (i.type === "line" && i.from && i.to) {
      const { a, b } = resolveEnds(i, byId);
      const mid = linePath(a, b, i.route).mid;
      return { x: mid.x - 80, y: mid.y - 14, w: 160, h: 28 };
    }
    return { x: i.x, y: i.y, w: i.w, h: i.h };
  };
  const textStyle = (i: Item): CSSProperties => ({
    fontSize: i.style.fontSize ?? 16,
    fontFamily: fontFamily(i.style.font),
    fontWeight: i.style.bold ? 700 : 400,
    fontStyle: i.style.italic ? "italic" : "normal",
    textDecoration: [i.style.underline && "underline", i.style.strike && "line-through"].filter(Boolean).join(" ") || "none",
    textAlign: i.style.align ?? (i.type === "shape" || i.type === "line" ? "center" : "left"),
    color: i.style.textColor ?? (i.type === "sticky" ? "#2b2a27" : inkOn(i.style.fill) ?? "var(--wb-ink)"),
    justifyContent: { top: "flex-start", middle: "center", bottom: "flex-end" }[i.style.valign ?? (i.type === "shape" || i.type === "line" ? "middle" : "top")],
  });
  const textEl = (i: Item, r: Rect) =>
    i.text ? (
      <foreignObject x={r.x} y={r.y} width={Math.max(1, r.w)} height={Math.max(1, r.h)} style={{ overflow: "visible" }}>
        <div className={`wb-text ${i.type === "line" || (i.type === "text" && !i.style.fill) ? "halo" : ""}`} style={textStyle(i)}>
          {i.text}
        </div>
      </foreignObject>
    ) : null;

  const renderItem = (i: Item): ReactNode => {
    const s = i.style;
    const c = center(i);
    const rotT = i.rot ? `rotate(${i.rot} ${c.x} ${c.y})` : undefined;
    const flipT = i.flipX || i.flipY ? `translate(${c.x} ${c.y}) scale(${i.flipX ? -1 : 1} ${i.flipY ? -1 : 1}) translate(${-c.x} ${-c.y})` : undefined;
    const common = { "data-id": i.id, className: `wb-item ${hoverTarget === i.id ? "target" : ""} ${i.locked ? "locked" : ""}`, opacity: s.opacity ?? 1, style: s.shadow ? { filter: "drop-shadow(0 6px 10px rgba(0,0,0,.18))" } : undefined };
    const sw = s.strokeWidth ?? 2;
    switch (i.type) {
      case "shape": {
        if (isIconShape(i.shape)) {
          const nodesData = iconNodes(i.shape!);
          const k = Math.min(i.w, i.h) / 24;
          const filled = iconFilled(i.shape!);
          const ink = s.stroke ?? "var(--wb-ink)";
          return (
            <g key={i.id} {...common} transform={rotT}>
              <rect x={i.x} y={i.y} width={i.w} height={i.h} fill={s.fill && s.fill !== "transparent" && !filled ? s.fill : "transparent"} rx={8} className="wb-hitbox" />
              <g transform={flipT}>
                <g className="wb-ink" transform={`translate(${i.x + (i.w - 24 * k) / 2} ${i.y + (i.h - 24 * k) / 2}) scale(${k})`} fill={filled ? (s.fill && s.fill !== "transparent" ? s.fill : ink) : "none"} stroke={filled ? "none" : ink} strokeWidth={(sw || 2) / Math.max(k, 0.01) * (24 / 24)} strokeLinecap="round" strokeLinejoin="round">
                  {nodesData ? <IconShapes nodes={nodesData} /> : <rect x={2} y={2} width={20} height={20} rx={4} strokeDasharray="2 2" />}
                </g>
              </g>
              {editing?.id !== i.id && textEl(i, textBox(i))}
            </g>
          );
        }
        const def = SHAPE_BY_ID.get(i.shape ?? "") ?? SHAPE_BY_ID.get("rect")!;
        const stroke = s.stroke ?? "var(--wb-line)";
        return (
          <g key={i.id} {...common} transform={rotT}>
            <g transform={flipT}>
              <g transform={`translate(${i.x} ${i.y})`}>
                <path d={i.shape === "rect" && s.radius ? `M${s.radius} 0 H${i.w - s.radius} Q${i.w} 0 ${i.w} ${s.radius} V${i.h - s.radius} Q${i.w} ${i.h} ${i.w - s.radius} ${i.h} H${s.radius} Q0 ${i.h} 0 ${i.h - s.radius} V${s.radius} Q0 0 ${s.radius} 0 Z` : def.path(i.w, i.h)} fill={s.fill ?? "var(--wb-fill)"} fillRule="evenodd" stroke={sw ? stroke : "none"} strokeWidth={sw} strokeDasharray={dashArray(s.dash, sw)} strokeLinejoin="round" />
                {def.detail && <path d={def.detail(i.w, i.h)} fill={def.solidDetail ? (s.stroke ?? "var(--wb-ink)") : "none"} stroke={stroke} strokeWidth={Math.max(1, sw * 0.8)} strokeLinecap="round" strokeLinejoin="round" />}
              </g>
            </g>
            {editing?.id !== i.id && textEl(i, textBox(i))}
          </g>
        );
      }
      case "sticky":
        return (
          <g key={i.id} {...common} transform={rotT} style={{ filter: s.shadow === false ? undefined : "drop-shadow(0 8px 14px rgba(0,0,0,.2))" }}>
            <rect x={i.x} y={i.y} width={i.w} height={i.h} rx={4} fill={s.fill ?? STICKY_COLORS[0]} />
            {editing?.id !== i.id && textEl(i, textBox(i))}
          </g>
        );
      case "text":
        return (
          <g key={i.id} {...common} transform={rotT}>
            <rect x={i.x} y={i.y} width={i.w} height={i.h} fill={s.fill ?? "transparent"} rx={4} />
            {editing?.id !== i.id && (i.text ? textEl(i, textBox(i)) : <text x={i.x + 2} y={i.y + 22} className="wb-placeholder">{L("Metin", "Text")}</text>)}
          </g>
        );
      case "draw": {
        const d = strokeOutline(i.points ?? [], i.tool ?? "pen", s.strokeWidth ?? 3, !(i.points ?? []).some((q) => q[2] !== 0.5));
        return (
          <g key={i.id} {...common} transform={rotT}>
            <rect x={i.x} y={i.y} width={i.w} height={i.h} fill="transparent" className="wb-hitbox" />
            <path d={d} className={i.tool === "highlighter" ? undefined : "wb-ink"} transform={`translate(${i.x} ${i.y})`} fill={s.stroke ?? "var(--wb-ink)"} style={i.tool === "highlighter" ? { mixBlendMode: "multiply" } : undefined} />
          </g>
        );
      }
      case "image":
        return (
          <g key={i.id} {...common} transform={rotT}>
            <g transform={flipT}>
              <image href={i.file ? fileUrl(i.file) : undefined} x={i.x} y={i.y} width={i.w} height={i.h} preserveAspectRatio="xMidYMid slice" clipPath={s.radius ? `inset(0 round ${s.radius}px)` : undefined} />
            </g>
            {!!sw && s.stroke && <rect x={i.x} y={i.y} width={i.w} height={i.h} rx={s.radius ?? 0} fill="none" stroke={s.stroke} strokeWidth={sw} />}
          </g>
        );
      case "link": {
        const n = i.node ? nodes.find((x) => x.id === i.node) : undefined;
        return (
          <g key={i.id} {...common} transform={rotT}>
            <rect x={i.x} y={i.y} width={i.w} height={i.h} rx={10} fill={s.fill ?? "var(--wb-card)"} stroke={s.stroke ?? "var(--wb-line-soft)"} strokeWidth={1} />
            <foreignObject x={i.x} y={i.y} width={i.w} height={i.h}>
              <div className="wb-link">
                <span className="wb-link-icon">{n?.icon ?? <Icon name={i.url ? "link" : "file"} size={18} />}</span>
                <span>
                  <b>{n?.title ?? i.text ?? i.url ?? L("Silinmiş not", "Deleted note")}</b>
                  <small>{i.url ? i.url.replace(/^https?:\/\//, "") : n ? n.path.replace(/\.md$/, "") : ""}</small>
                </span>
              </div>
            </foreignObject>
          </g>
        );
      }
      case "table": {
        const rows = i.cells ?? [[""]];
        const cols = rows[0]?.length ?? 1;
        return (
          <g key={i.id} {...common} transform={rotT}>
            <foreignObject x={i.x} y={i.y} width={i.w} height={i.h}>
              <table className="wb-table" style={{ fontSize: s.fontSize ?? 14, fontFamily: fontFamily(s.font), borderColor: s.stroke ?? "var(--wb-line-soft)", background: s.fill ?? "var(--wb-card)", color: s.textColor ?? "var(--wb-ink)" }}>
                <tbody>
                  {rows.map((row, r) => (
                    <tr key={r} style={{ height: `${100 / rows.length}%` }}>
                      {row.map((cell, k) => (
                        <td key={k} style={{ width: `${100 / cols}%`, borderColor: s.stroke ?? "var(--wb-line-soft)", fontWeight: r === 0 && s.bold !== false ? 600 : 400 }}>
                          {editing?.id === i.id && editing.cell?.[0] === r && editing.cell?.[1] === k ? "" : cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </foreignObject>
          </g>
        );
      }
      case "line": {
        const { a, b } = resolveEnds(i, byId);
        const lp = linePath(a, b, i.route);
        const stroke = s.stroke ?? "var(--wb-line)";
        const size = 6 + sw * 2.5;
        const hs = headPath(i.startHead ?? "none", a, lp.startAngle, size);
        const he = headPath(i.endHead ?? "none", b, lp.endAngle, size);
        return (
          <g key={i.id} {...common}>
            <path d={lp.d} fill="none" stroke="transparent" strokeWidth={Math.max(14, sw + 10)} className="wb-hitbox" />
            <path d={lp.d} fill="none" stroke={stroke} strokeWidth={sw} strokeDasharray={dashArray(s.dash, sw)} strokeLinecap="round" strokeLinejoin="round" />
            {hs && <path d={hs.d} fill={hs.filled ? stroke : "none"} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round" />}
            {he && <path d={he.d} fill={he.filled ? stroke : "none"} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round" />}
            {editing?.id !== i.id && textEl(i, textBox(i))}
          </g>
        );
      }
    }
  };

  // Seçim katmanı (dışa aktarmaya girmez).
  const hs = 8 / view.k;
  const selectionUi = () => {
    if (!sel.length) return null;
    if (single?.type === "line") {
      const { a, b } = resolveEnds(single, byId);
      return (
        <g className="wb-ui">
          {(
            [
              ["from", a],
              ["to", b],
            ] as const
          ).map(([k, p]) => (
            <circle key={k} data-handle={k} cx={p.x} cy={p.y} r={hs * 0.75} className="wb-handle round" style={{ strokeWidth: 1.5 / view.k }} />
          ))}
        </g>
      );
    }
    const bb = single ? { x: single.x, y: single.y, w: single.w, h: single.h } : union(sel.map(bounds))!;
    const c = center(bb);
    const rotT = single?.rot ? `rotate(${single.rot} ${c.x} ${c.y})` : undefined;
    const pts: Record<Handle, [number, number]> = { nw: [bb.x, bb.y], n: [c.x, bb.y], ne: [bb.x + bb.w, bb.y], e: [bb.x + bb.w, c.y], se: [bb.x + bb.w, bb.y + bb.h], s: [c.x, bb.y + bb.h], sw: [bb.x, bb.y + bb.h], w: [bb.x, c.y] };
    return (
      <g className="wb-ui" transform={rotT}>
        <rect x={bb.x} y={bb.y} width={bb.w} height={bb.h} className="wb-sel" style={{ strokeWidth: 1.5 / view.k }} />
        {single && !single.locked && (
          <>
            {HANDLES.map((h) => (
              <rect key={h} data-handle={h} x={pts[h][0] - hs / 2} y={pts[h][1] - hs / 2} width={hs} height={hs} rx={2 / view.k} className={`wb-handle h-${h}`} style={{ strokeWidth: 1.5 / view.k }} />
            ))}
            <line x1={c.x} y1={bb.y} x2={c.x} y2={bb.y - 22 / view.k} className="wb-sel" style={{ strokeWidth: 1.5 / view.k }} />
            <circle data-handle="rot" cx={c.x} cy={bb.y - 26 / view.k} r={hs * 0.6} className="wb-handle round rot" style={{ strokeWidth: 1.5 / view.k }} />
            {single.type !== "draw" &&
              SIDES.map((sd) => {
                const sp = sidePoint(bb, sd);
                const off = 18 / view.k;
                const [ox, oy] = sd === "top" ? [0, -off] : sd === "bottom" ? [0, off] : sd === "left" ? [-off, 0] : [off, 0];
                return <circle key={sd} data-handle={`conn-${sd}`} cx={sp.x + ox} cy={sp.y + oy} r={hs * 0.55} className="wb-handle conn" style={{ strokeWidth: 1.5 / view.k }} />;
              })}
          </>
        )}
        {single?.locked && (
          <g transform={`translate(${bb.x + bb.w - 16 / view.k} ${bb.y - 20 / view.k}) scale(${1 / view.k})`} className="wb-lock-mark">
            <Icon name="lock" size={16} />
          </g>
        )}
      </g>
    );
  };

  // Metin düzenleme katmanı (ekran koordinatlarında).
  const editor = (() => {
    if (!editing) return null;
    const it = byId.get(editing.id);
    if (!it) return null;
    let r = textBox(it);
    let value = it.text ?? "";
    if (it.type === "table" && editing.cell && it.cells) {
      const rows = it.cells.length;
      const cols = it.cells[0].length;
      const [rr, cc] = editing.cell;
      r = { x: it.x + (cc * it.w) / cols, y: it.y + (rr * it.h) / rows, w: it.w / cols, h: it.h / rows };
      value = it.cells[rr]?.[cc] ?? "";
    }
    const st = textStyle(it);
    // Yazı düzenlenirken de şekildeki dikey hizasında kalsın (textarea dikey ortalamayı kendisi yapmaz).
    const boxH = Math.max(28, r.h * view.k);
    const lineH = (st.fontSize as number) * view.k * 1.3;
    const textH = Math.max(1, value.split("\n").length) * lineH;
    const vAlign = st.justifyContent === "center" ? 0.5 : st.justifyContent === "flex-end" ? 1 : 0;
    const padTop = it.type === "table" && editing.cell ? undefined : Math.max(0, (boxH - textH) * vAlign);
    const commit = (v: string) => {
      if (it.type === "table" && editing.cell) {
        const [rr, cc] = editing.cell;
        if ((it.cells?.[rr]?.[cc] ?? "") !== v) patch([it.id], (x) => ({ cells: x.cells!.map((row, a) => row.map((cell, b) => (a === rr && b === cc ? v : cell))) }));
      } else if ((it.text ?? "") !== v) patch([it.id], { text: v });
    };
    return (
      <textarea
        key={`${editing.id}:${editing.cell?.join(",") ?? ""}`}
        className={`wb-editor ${it.type}`}
        autoFocus
        defaultValue={value}
        style={{
          left: r.x * view.k + view.x,
          top: r.y * view.k + view.y,
          width: Math.max(80, r.w * view.k),
          height: boxH,
          paddingTop: padTop,
          fontSize: (st.fontSize as number) * view.k,
          fontFamily: st.fontFamily,
          fontWeight: st.fontWeight,
          fontStyle: st.fontStyle,
          textAlign: st.textAlign,
          color: st.color,
          transform: it.rot ? `rotate(${it.rot}deg)` : undefined,
        }}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => (commit(e.currentTarget.value), setEditing(null))}
        onInput={(e) => {
          if (it.type !== "text") return;
          // Metin kutusu yazdıkça uzar.
          const ta = e.currentTarget;
          const h = ta.scrollHeight / view.k;
          if (h > it.h + 1) setItems((all) => all.map((x) => (x.id === it.id ? { ...x, h } : x)));
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          // Esc ya da ⌘↵: yazma biter ve seçim kalkar; biçim paneli tek seferde kapanır.
          if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
            e.currentTarget.blur();
            setSelected([]);
          }
          if (e.key === "Tab" && it.type === "table" && editing.cell && it.cells) {
            e.preventDefault();
            commit(e.currentTarget.value);
            const cols = it.cells[0].length;
            const n = editing.cell[0] * cols + editing.cell[1] + (e.shiftKey ? -1 : 1);
            const max = it.cells.length * cols;
            setEditing({ id: it.id, cell: [Math.floor(((n + max) % max) / cols), ((n % cols) + cols) % cols] });
          }
        }}
      />
    );
  })();

  const marquee = drag?.kind === "marquee" ? { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) } : null;
  const bg = board.background ?? "dots";
  const gs = 24 * view.k;
  const cursor = space || tool === "hand" ? (drag?.kind === "pan" ? "grabbing" : "grab") : tool === "select" ? "default" : tool === "eraser" ? "cell" : "crosshair";

  // --- Araç çubuğu ve denetçi ------------------------------------------------------------------------------
  const tb = (id: Tool, icon: ReactNode, label: string, key?: string) => (
    <button key={id} className={`wb-tool ${tool === id ? "on" : ""}`} title={`${label}${key ? ` (${key})` : ""}`} aria-label={label} aria-pressed={tool === id} onClick={() => (setTool(id), setLibrary(false))}>
      {icon}
    </button>
  );
  const swatches = (value: string | undefined, onPick: (c: string | undefined) => void, opts: { none?: boolean; colors?: string[] } = {}) => (
    <div className="wb-swatches">
      {opts.none && <button className={`wb-swatch none ${value === undefined || value === "transparent" ? "on" : ""}`} title={L("Yok", "None")} onClick={() => onPick("transparent")} />}
      {(opts.colors ?? PALETTE).map((c) => (
        <button key={c} className={`wb-swatch ${value === c ? "on" : ""}`} style={{ background: c }} onClick={() => onPick(c)} title={c} />
      ))}
      <label className="wb-swatch custom" title={L("Özel renk", "Custom colour")}>
        <input type="color" value={value && value.startsWith("#") ? value : "#888888"} onChange={(e) => onPick(e.target.value)} />
      </label>
    </div>
  );

  const types = new Set(sel.map((i) => i.type));
  const hasText = sel.some((i) => ["shape", "sticky", "text", "line", "table"].includes(i.type));
  const hasFill = sel.some((i) => ["shape", "text", "table", "link", "sticky"].includes(i.type));
  const hasStroke = sel.some((i) => ["shape", "line", "draw", "image", "table"].includes(i.type));
  const first0 = sel[0]?.style ?? {};

  const inspector = sel.length > 0 && !drag && (
    <div className={`wb-inspector ${panelOpen ? "" : "collapsed"}`} onPointerDown={(e) => e.stopPropagation()}>
      <button className="wb-panel-toggle" onClick={() => setPanelOpen(!panelOpen)} aria-expanded={panelOpen} title={panelOpen ? L("Paneli daralt", "Collapse panel") : L("Biçim paneli", "Format panel")}>
        {panelOpen ? "›" : "‹"} {!panelOpen && L("Biçim", "Format")}
      </button>
      {panelOpen && (
      <>
      {hasFill && (
        <section>
          <h5>{types.has("sticky") && types.size === 1 ? L("Not rengi", "Note colour") : L("Dolgu", "Fill")}</h5>
          {swatches(first0.fill, (c) => patchStyle({ fill: c }), { none: !types.has("sticky"), colors: types.has("sticky") && types.size === 1 ? STICKY_COLORS : PALETTE })}
        </section>
      )}
      {hasStroke && (
        <section>
          <h5>{types.has("draw") && types.size === 1 ? L("Mürekkep", "Ink") : L("Çizgi", "Stroke")}</h5>
          {swatches(first0.stroke, (c) => patchStyle({ stroke: c }), { none: !types.has("draw") && !types.has("line") })}
          <div className="wb-row">
            <input type="range" min={0} max={types.has("draw") ? 24 : 16} step={0.5} value={first0.strokeWidth ?? (types.has("draw") ? 3 : 2)} onChange={(e) => patchStyle({ strokeWidth: Number(e.target.value) })} aria-label={L("Kalınlık", "Width")} />
            {!types.has("draw") && (
              <select value={first0.dash ?? "solid"} onChange={(e) => patchStyle({ dash: e.target.value as Dash })}>
                <option value="solid">━ {L("Düz", "Solid")}</option>
                <option value="dashed">╍ {L("Kesikli", "Dashed")}</option>
                <option value="dotted">┈ {L("Noktalı", "Dotted")}</option>
              </select>
            )}
          </div>
        </section>
      )}
      {types.has("line") && (
        <section>
          <h5>{L("Bağlantı", "Connector")}</h5>
          <div className="wb-row">
            {(["straight", "elbow", "curve"] as Route[]).map((r) => (
              <button key={r} className={`wb-chip ${(single?.route ?? "straight") === r ? "on" : ""}`} onClick={() => patch(selected, { route: r })}>
                {r === "straight" ? L("Düz", "Straight") : r === "elbow" ? L("Dirsek", "Elbow") : L("Eğri", "Curved")}
              </button>
            ))}
          </div>
          <div className="wb-row">
            {(["startHead", "endHead"] as const).map((k) => (
              <label key={k} className="wb-field">
                <span>{k === "startHead" ? L("Başlangıç", "Start") : L("Bitiş", "End")}</span>
              <select value={single?.[k] ?? "none"} onChange={(e) => patch(selected, { [k]: e.target.value as ArrowHead })} aria-label={k === "startHead" ? L("Başlangıç ucu", "Start") : L("Bitiş ucu", "End")}>
                {(["none", "arrow", "triangle", "circle", "diamond", "bar"] as ArrowHead[]).map((h) => (
                  <option key={h} value={h}>
                    {{ none: L("Yok", "None"), arrow: L("Ok", "Arrow"), triangle: L("Üçgen", "Triangle"), circle: L("Daire", "Circle"), diamond: L("Baklava", "Diamond"), bar: L("Çubuk", "Bar") }[h]}
                  </option>
                ))}
              </select>
              </label>
            ))}
          </div>
        </section>
      )}
      {hasText && (
        <section>
          <h5>{L("Yazı", "Text")}</h5>
          <div className="wb-row">
            <select value={first0.font ?? "sans"} onChange={(e) => patchStyle({ font: e.target.value })} style={{ fontFamily: fontFamily(first0.font) }} aria-label={L("Yazı tipi", "Font")}>
              <option value="sans">{L("Sade", "Sans")}</option>
              <option value="serif">{L("Tırnaklı", "Serif")}</option>
              <option value="mono">{L("Eş aralıklı", "Mono")}</option>
              <option value="hand">{L("El yazısı", "Handwriting")}</option>
              <optgroup label={t("ws.bundledFonts")}>
                {BUNDLED_FONTS.map((f) => (
                  <option key={f.family} value={f.family} style={{ fontFamily: f.family }}>
                    {f.family}
                  </option>
                ))}
              </optgroup>
              <optgroup label={L("Sistem yazı tipleri", "System fonts")}>
                {SYSTEM_FONTS.map((f) => (
                  <option key={f} value={f} style={{ fontFamily: f }}>
                    {f}
                  </option>
                ))}
              </optgroup>
            </select>
            <input className="wb-num" type="number" min={8} max={160} value={first0.fontSize ?? 16} onChange={(e) => patchStyle({ fontSize: clamp(Number(e.target.value) || 16, 8, 160) })} aria-label={L("Boyut", "Size")} />
          </div>
          <div className="wb-row">
            <button className={`wb-chip ${first0.bold ? "on" : ""}`} onClick={() => patchStyle({ bold: !first0.bold })}>
              <b>B</b>
            </button>
            <button className={`wb-chip ${first0.italic ? "on" : ""}`} onClick={() => patchStyle({ italic: !first0.italic })}>
              <i>I</i>
            </button>
            <button className={`wb-chip ${first0.underline ? "on" : ""}`} onClick={() => patchStyle({ underline: !first0.underline })}>
              <u>U</u>
            </button>
            <button className={`wb-chip ${first0.strike ? "on" : ""}`} onClick={() => patchStyle({ strike: !first0.strike })}>
              <s>S</s>
            </button>
            </div>
          <div className="wb-row">
            {(["left", "center", "right"] as const).map((a) => (
              <button key={a} className={`wb-chip ${(first0.align ?? "left") === a ? "on" : ""}`} onClick={() => patchStyle({ align: a })} title={a}>
                <Icon name={a === "left" ? "align-left" : a === "center" ? "align-center" : "align-right"} />
              </button>
            ))}
            {(["top", "middle", "bottom"] as const).map((a) => (
              <button key={a} className={`wb-chip ${(first0.valign ?? "top") === a ? "on" : ""}`} onClick={() => patchStyle({ valign: a })} title={a}>
                <Icon name={a === "top" ? "layout-align-top" : a === "middle" ? "layout-align-middle" : "layout-align-bottom"} />
              </button>
            ))}
          </div>
          {swatches(first0.textColor, (c) => patchStyle({ textColor: c }))}
        </section>
      )}
      {types.has("table") && single?.cells && (
        <section>
          <h5>{L("Tablo", "Table")}</h5>
          <div className="wb-row">
            <button className="wb-chip" onClick={() => patch([single.id], (x) => ({ cells: [...x.cells!, x.cells![0].map(() => "")], h: x.h + x.h / x.cells!.length }))}>＋ {L("Satır", "Row")}</button>
            <button className="wb-chip" disabled={single.cells.length < 2} onClick={() => patch([single.id], (x) => ({ cells: x.cells!.slice(0, -1), h: x.h - x.h / x.cells!.length }))}>－ {L("Satır", "Row")}</button>
            <button className="wb-chip" onClick={() => patch([single.id], (x) => ({ cells: x.cells!.map((r) => [...r, ""]), w: x.w + x.w / x.cells![0].length }))}>＋ {L("Sütun", "Column")}</button>
            <button className="wb-chip" disabled={single.cells[0].length < 2} onClick={() => patch([single.id], (x) => ({ cells: x.cells!.map((r) => r.slice(0, -1)), w: x.w - x.w / x.cells![0].length }))}>－ {L("Sütun", "Column")}</button>
          </div>
        </section>
      )}
      {single?.type === "shape" && isIconShape(single.shape) && (
        <section>
          <h5>{L("Simge", "Icon")}</h5>
          <span className="small">{iconTitle(single.shape!)}</span>
        </section>
      )}
      {single?.type === "shape" && !isIconShape(single.shape) && (
        <section>
          <h5>{L("Şekil", "Shape")}</h5>
          <select value={single.shape} onChange={(e) => patch([single.id], { shape: e.target.value })}>
            {CATEGORIES.map((c) => (
              <optgroup key={c.id} label={c.name[getLang() === "tr" ? "tr" : "en"]}>
                {SHAPES.filter((s) => s.cat === c.id).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name[getLang() === "tr" ? "tr" : "en"]}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {single.shape === "rect" && (
            <label className="wb-row small">
              {L("Köşe", "Corner")}
              <input type="range" min={0} max={Math.min(single.w, single.h) / 2} value={single.style.radius ?? 0} onChange={(e) => patchStyle({ radius: Number(e.target.value) })} />
            </label>
          )}
        </section>
      )}
      <section>
        <h5>{L("Görünüm", "Appearance")}</h5>
        <label className="wb-row small">
          {L("Saydamlık", "Opacity")}
          <input type="range" min={0.1} max={1} step={0.05} value={first0.opacity ?? 1} onChange={(e) => patchStyle({ opacity: Number(e.target.value) })} />
        </label>
        {!types.has("line") && !types.has("draw") && (
          <label className="wb-row small">
            <input type="checkbox" checked={!!first0.shadow} onChange={(e) => patchStyle({ shadow: e.target.checked })} /> {L("Gölge", "Shadow")}
          </label>
        )}
      </section>
      <section>
        <h5>{L("Düzenle", "Arrange")}</h5>
        <div className="wb-row">
          <button className="wb-chip" title={L("En öne getir (⇧⌘])", "Bring to front (⇧⌘])")} onClick={() => arrange("front")}><Icon name="arrow-bar-to-up" /></button>
          <button className="wb-chip" title={L("Öne getir (⌘])", "Bring forward (⌘])")} onClick={() => arrange("forward")}><Icon name="arrow-up" /></button>
          <button className="wb-chip" title={L("Geri gönder (⌘[)", "Send backward (⌘[)")} onClick={() => arrange("backward")}><Icon name="arrow-down" /></button>
          <button className="wb-chip" title={L("En arkaya gönder (⇧⌘[)", "Send to back (⇧⌘[)")} onClick={() => arrange("back")}><Icon name="arrow-bar-to-down" /></button>
          <button className="wb-chip" title={L("Yatay çevir", "Flip horizontal")} onClick={() => flip("x")}><Icon name="flip-vertical" /></button>
          <button className="wb-chip" title={L("Dikey çevir", "Flip vertical")} onClick={() => flip("y")}><Icon name="flip-horizontal" /></button>
        </div>
        {sel.length > 1 && (
          <div className="wb-row">
            <button className="wb-chip" title={L("Sola hizala", "Align left")} onClick={() => align("left")}><Icon name="layout-align-left" /></button>
            <button className="wb-chip" title={L("Ortala", "Align centre")} onClick={() => align("hcenter")}><Icon name="layout-align-center" /></button>
            <button className="wb-chip" title={L("Sağa hizala", "Align right")} onClick={() => align("right")}><Icon name="layout-align-right" /></button>
            <button className="wb-chip" title={L("Üste hizala", "Align top")} onClick={() => align("top")}><Icon name="layout-align-top" /></button>
            <button className="wb-chip" title={L("Ortaya hizala", "Align middle")} onClick={() => align("vcenter")}><Icon name="layout-align-middle" /></button>
            <button className="wb-chip" title={L("Alta hizala", "Align bottom")} onClick={() => align("bottom")}><Icon name="layout-align-bottom" /></button>
            <button className="wb-chip" disabled={sel.length < 3} title={L("Yatay dağıt", "Distribute horizontally")} onClick={() => distribute("h")}><Icon name="layout-distribute-vertical" /></button>
            <button className="wb-chip" disabled={sel.length < 3} title={L("Dikey dağıt", "Distribute vertically")} onClick={() => distribute("v")}><Icon name="layout-distribute-horizontal" /></button>
          </div>
        )}
        <div className="wb-row">
          {sel.length > 1 && !sel.every((i) => i.group && i.group === sel[0].group) && <button className="wb-chip" onClick={group}><Icon name="box-multiple" /> {L("Grupla", "Group")}</button>}
          {sel.some((i) => i.group) && <button className="wb-chip" onClick={ungroup}><Icon name="box-off" /> {L("Grubu çöz", "Ungroup")}</button>}
          <button className="wb-chip" onClick={() => patch(selected, (i) => ({ locked: !sel.every((x) => x.locked) || !i.locked ? !sel.every((x) => x.locked) : false }))}>
            {sel.every((i) => i.locked) ? <><Icon name="lock-open" /> {L("Kilidi aç", "Unlock")}</> : <><Icon name="lock" /> {L("Kilitle", "Lock")}</>}
          </button>
          <button className="wb-chip" onClick={() => (copy(), paste(16))}><Icon name="copy" /> {L("Çoğalt", "Duplicate")}</button>
          <button className="wb-chip danger" onClick={removeSelected}><Icon name="trash" /> {L("Sil", "Delete")}</button>
        </div>
      </section>
      </>
      )}
    </div>
  );

  const shapeLibrary = library && <ShapeLibrary current={shapeId} onPick={(id) => (setShapeId(id), setTool("shape"), setLibrary(false))} />;

  return (
    <div className={`wb ${parsed.broken ? "broken" : ""}`} ref={root} style={{ "--wb-bar": `${barBottom + 8}px` } as CSSProperties} tabIndex={0} onKeyDown={onKeyDown} onKeyUp={onKeyUp} onDragOver={(e) => e.preventDefault()} onDrop={(e) => {
      e.preventDefault();
      const files = [...e.dataTransfer.files];
      if (files.length) void addImageFiles(files, toWorld(e.clientX, e.clientY));
    }}>
      {parsed.broken && <div className="banner">{L("Tabula verisi okunamadı; değişiklikler kaydedilmeyecek.", "The Tabula data could not be read; changes will not be saved.")}</div>}
      <div className="wb-toolbar" ref={toolbar} role="toolbar" aria-label="Tabula" onPointerDown={(e) => e.stopPropagation()}>
        {tb("select", <ToolIcon name="select" />, L("Seç", "Select"), "V")}
        {tb("hand", <ToolIcon name="hand" />, L("Kaydır", "Pan"), "H")}
        <span className="wb-sep" />
        {tb("pen", <ToolIcon name="pen" />, L("Kalem", "Pen"), "P")}
        {tb("pencil", <ToolIcon name="pencil" />, L("Kurşun kalem", "Pencil"))}
        {tb("marker", <ToolIcon name="marker" />, L("Keçeli kalem", "Marker"), "B")}
        {tb("highlighter", <ToolIcon name="highlighter" />, L("Fosforlu kalem", "Highlighter"))}
        {tb("eraser", <ToolIcon name="eraser" />, L("Silgi", "Eraser"), "E")}
        <span className="wb-sep" />
        {tb("text", <ToolIcon name="text" />, L("Metin kutusu", "Text box"), "T")}
        {tb("sticky", <ToolIcon name="sticky" />, L("Yapışkan not", "Sticky note"), "S")}
        <button className={`wb-tool ${tool === "shape" ? "on" : ""}`} title={L("Şekiller (R, O, D)", "Shapes (R, O, D)")} aria-expanded={library} onClick={() => setLibrary(!library)}>
          <ShapeIcon id={shapeId} />
          <span className="wb-caret"><Icon name="chevron-down" size={10} /></span>
        </button>
        {tb("line", <ToolIcon name="line" />, L("Çizgi", "Line"), "L")}
        {tb("arrow", <ToolIcon name="arrow" />, L("Ok", "Arrow"), "A")}
        {tb("connector", <ToolIcon name="connector" />, L("Bağlayıcı (dirsekli)", "Connector (elbow)"), "C")}
        {tb("table", <ToolIcon name="table" />, L("Tablo", "Table"))}
        <button className="wb-tool" title={L("Görsel ekle", "Add image")} onClick={() => fileInput.current?.click()}>
          <ToolIcon name="image" />
        </button>
        <button
          className="wb-tool"
          title={L("Not ya da bağlantı kartı", "Note or link card")}
          onClick={(e) => setPicker({ x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().bottom })}
        >
          <ToolIcon name="link" />
        </button>
        <span className="wb-sep" />
        <button className="wb-tool" title={L("Geri al (⌘Z)", "Undo (⌘Z)")} onClick={undo} disabled={!undoStack.current.length}>
          <ToolIcon name="undo" />
        </button>
        <button className="wb-tool" title={L("Yinele (⇧⌘Z)", "Redo (⇧⌘Z)")} onClick={redo} disabled={!redoStack.current.length}>
          <ToolIcon name="redo" />
        </button>
        <span className="wb-sep" />
        <div className="wb-rel">
          <button className={`wb-tool ${menu === "background" ? "on" : ""}`} title={L("Tahta", "Board")} onClick={() => setMenu(menu === "background" ? null : "background")}>
            <ToolIcon name="more" />
          </button>
          {menu === "background" && (
            <div className="wb-menu">
              <h5>{L("Izgara", "Grid")}</h5>
              <div className="wb-row">
                {(["dots", "grid", "lines", "none"] as const).map((b) => (
                  <button key={b} className={`wb-chip ${bg === b ? "on" : ""}`} onClick={() => setBoard((x) => ({ ...x, background: b }))}>
                    {{ dots: L("Nokta", "Dots"), grid: L("Kare", "Grid"), lines: L("Çizgi", "Lines"), none: L("Yok", "None") }[b]}
                  </button>
                ))}
              </div>
              <label className="wb-row small">
                <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> {L("Izgaraya yapış", "Snap to grid")}
              </label>
              <h5>{L("Tahta rengi", "Board colour")}</h5>
              <p className="muted small">{L("Saydam tahta, seçtiğiniz yazma arka planını gösterir.", "A transparent board shows your writing background.")}</p>
              {swatches(board.color, (c) => setBoard((x) => ({ ...x, color: c === "transparent" ? undefined : c })), { none: true, colors: ["#ffffff", "#f6f1e7", "#eef3f8", "#1f2328", "#0b0d10", "#18322b"] })}
              <h5>{L("Dışa aktar", "Export")}</h5>
              <div className="wb-row">
                <button className="wb-chip" onClick={() => void exportBoard("png")}>PNG</button>
                <button className="wb-chip" onClick={() => void exportBoard("svg")}>SVG</button>
              </div>
            </div>
          )}
        </div>
      </div>
      {DRAW_TOOLS.includes(tool as DrawTool) && (
        <div className="wb-subbar" onPointerDown={(e) => e.stopPropagation()}>
          {swatches(pen.color === "var(--wb-ink)" ? undefined : pen.color, (c) => setPen((p) => ({ ...p, color: c ?? "var(--wb-ink)" })))}
          <input type="range" min={1} max={16} step={0.5} value={pen.size} onChange={(e) => setPen((p) => ({ ...p, size: Number(e.target.value) }))} aria-label={L("Kalınlık", "Width")} />
        </div>
      )}
      {shapeLibrary}
      <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => (void addImageFiles([...(e.target.files ?? [])]), (e.target.value = ""))} />
      <svg
        ref={svg}
        className={`wb-svg bg-${bg}`}
        style={{ cursor, background: board.color }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContext}
      >
        <defs>
          <pattern id="wb-dots" width={gs} height={gs} patternUnits="userSpaceOnUse" x={view.x % gs} y={view.y % gs}>
            <circle cx={1} cy={1} r={1} fill="var(--wb-grid)" />
          </pattern>
          <pattern id="wb-grid" width={gs} height={gs} patternUnits="userSpaceOnUse" x={view.x % gs} y={view.y % gs}>
            <path d={`M${gs} 0 H0 V${gs}`} fill="none" stroke="var(--wb-grid)" strokeWidth={1} />
          </pattern>
          <pattern id="wb-lines" width={gs} height={gs} patternUnits="userSpaceOnUse" x={0} y={view.y % gs}>
            <path d={`M0 ${gs - 0.5} H${gs}`} fill="none" stroke="var(--wb-grid)" strokeWidth={1} />
          </pattern>
        </defs>
        {bg !== "none" && <rect width="100%" height="100%" fill={`url(#wb-${bg})`} pointerEvents="none" />}
        <g ref={world} transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {items.map(renderItem)}
          {guides.map((g, n) =>
            g.x !== undefined ? (
              <line key={n} className="wb-ui wb-guide" x1={g.x} x2={g.x} y1={-1e5} y2={1e5} style={{ strokeWidth: 1 / view.k }} />
            ) : (
              <line key={n} className="wb-ui wb-guide" y1={g.y} y2={g.y} x1={-1e5} x2={1e5} style={{ strokeWidth: 1 / view.k }} />
            ),
          )}
          {selectionUi()}
          {marquee && <rect className="wb-ui wb-marquee" x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} style={{ strokeWidth: 1 / view.k }} />}
        </g>
      </svg>
      {editor}
      {inspector}
      {!items.length && !drag && (
        <div className="wb-empty">
          <b>Tabula</b>
          <span>{L("Çizmek için kalemi seç, şekil eklemek için Şekiller düğmesini kullan ya da boşluğa çift tıklayıp yaz.", "Pick the pen to draw, add shapes from the shapes button, or double-click anywhere to type.")}</span>
        </div>
      )}
      <div className="wb-zoom" onPointerDown={(e) => e.stopPropagation()}>
        <button onClick={() => zoomAt(1 / 1.2)} title={L("Uzaklaş (⌘−)", "Zoom out (⌘−)")}><Icon name="minus" size={14} /></button>
        <button onClick={() => setView((v) => ({ ...v, k: 1 }))} title={L("%100 (⌘0)", "100% (⌘0)")}>
          {Math.round(view.k * 100)}%
        </button>
        <button onClick={() => zoomAt(1.2)} title={L("Yakınlaş (⌘+)", "Zoom in (⌘+)")}><Icon name="plus" size={14} /></button>
        <button onClick={() => fit(sel.length ? sel : undefined)} title={L("Sığdır (⌘1)", "Fit (⌘1)")}><Icon name="maximize" size={14} /></button>
      </div>
      {picker && (
        <NotePicker
          nodes={nodes}
          placeholder={L("Bağlanacak notu ara… (ya da bir web adresi yaz)", "Find a note to link… (or type a web address)")}
          onClose={() => setPicker(null)}
          onPick={(n) => {
            setPicker(null);
            const el = svg.current!.getBoundingClientRect();
            const p = toWorld(el.left + el.width / 2, el.top + el.height / 2);
            add({ type: "link", node: n.id, x: p.x - 130, y: p.y - 36, w: 260, h: 72, style: {} });
          }}
        />
      )}
    </div>
  );
}

function IconShapes({ nodes }: { nodes: IconNode[] }) {
  return (
    <>
      {nodes.map(([tag, attrs], n) => {
        const { key: _k, ...rest } = attrs as Record<string, string>;
        const props = Object.fromEntries(Object.entries(rest).map(([a, v]) => [a.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase()), v]));
        const T = tag as "path";
        return <T key={n} {...(props as object)} />;
      })}
    </>
  );
}

function ShapeIcon({ id, size = 20 }: { id: string; size?: number }) {
  if (isIconShape(id)) {
    const nodes = iconNodes(id);
    const filled = iconFilled(id);
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke={filled ? "none" : "currentColor"} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {nodes && <IconShapes nodes={nodes} />}
      </svg>
    );
  }
  const def = SHAPE_BY_ID.get(id) ?? SHAPE_BY_ID.get("rect")!;
  const [w, h] = def.size ?? [150, 100];
  const k = (size - 2) / Math.max(w, h);
  return (
    <svg width={size} height={size} viewBox={`${-1 / k} ${-1 / k} ${size / k} ${size / k}`} aria-hidden="true">
      <g transform={`translate(${(Math.max(w, h) - w) / 2} ${(Math.max(w, h) - h) / 2})`}>
        <path d={def.path(w, h)} fill="none" fillRule="evenodd" stroke="currentColor" strokeWidth={1.4 / k} strokeLinejoin="round" />
        {def.detail && <path d={def.detail(w, h)} fill={def.solidDetail ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.2 / k} />}
      </g>
    </svg>
  );
}

/** Dolgu rengine göre okunaklı yazı rengi; dolgu yoksa ya da ara tondaysa tema rengi kullanılır. */
function inkOn(fill: string | undefined): string | undefined {
  const m = fill && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(fill.trim());
  if (!m) return undefined;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.4 ? "#1f2328" : lum < 0.15 ? "#f7f8fa" : undefined;
}

function ShapeLibrary({ current, onPick }: { current: string; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [filled, setFilled] = useState(false);
  const lang = getLang() === "tr" ? "tr" : "en";
  const isIconCat = cat.startsWith("pic:");
  const icons = useIconData(isIconCat || !!q.trim());
  const query = q.trim().toLocaleLowerCase(lang);
  const list = SHAPES.filter((s) => (cat === "all" || s.cat === cat) && (!query || s.name.tr.toLocaleLowerCase("tr").includes(query) || s.name.en.toLowerCase().includes(query)));
  // Resimli şekiller: seçilen grup ya da arama sonuçları; dolu sürümü olmayan simge çizgi olarak eklenir.
  const iconNames = icons ? (query ? searchIcons(icons, q) : isIconCat ? iconsInGroup(icons, cat.slice(4)) : []) : [];
  const iconId = (n: string) => (filled && icons?.filled[n] ? `icon:${n}:filled` : `icon:${n}`);
  const diagramSections = isIconCat ? [] : cat === "all" && !query ? CATEGORIES : [{ id: cat as ShapeCategory | "all", name: { tr: "", en: "" } }];
  return (
    <div className="wb-library" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className="wb-row">
        <input autoFocus type="search" placeholder={L("Şekil ya da simge ara… (ör. kedi, sunucu, akış)", "Search shapes and icons… (e.g. cat, server, flow)")} value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
      </div>
      <div className="wb-lib-head">
        <div className="segmented small">
          <button className={!isIconCat ? "on" : ""} onClick={() => setCat("all")}>
            {L("Diyagram şekilleri", "Diagram shapes")}
          </button>
          <button className={isIconCat ? "on" : ""} onClick={() => !isIconCat && setCat(`pic:${ICON_GROUPS[0].id}`)}>
            {L("Resimli şekiller", "Pictures")}
          </button>
        </div>
        {isIconCat && (
          <label className="check small">
            <input type="checkbox" checked={filled} onChange={(e) => setFilled(e.target.checked)} /> {L("Dolu", "Filled")}
          </label>
        )}
      </div>
      <div className="wb-cats" role="tablist">
        {!isIconCat && (
          <button className={`wb-chip ${cat === "all" ? "on" : ""}`} onClick={() => setCat("all")}>
            {L("Tümü", "All")}
          </button>
        )}
        {!isIconCat &&
          CATEGORIES.map((c) => (
            <button key={c.id} className={`wb-chip ${cat === c.id ? "on" : ""}`} onClick={() => setCat(c.id)}>
              {c.name[lang]}
            </button>
          ))}
        {isIconCat &&
          ICON_GROUPS.map((g) => (
            <button key={g.id} className={`wb-chip ${cat === `pic:${g.id}` ? "on" : ""}`} onClick={() => setCat(`pic:${g.id}`)}>
              {g.name[lang]}
            </button>
          ))}
      </div>
      <div className="wb-shape-grid">
        {diagramSections.map((c) => {
          const shapes = list.filter((s) => c.id === "all" || s.cat === c.id);
          if (!shapes.length) return null;
          return (
            <section key={c.id}>
              {c.name[lang] && <h5>{c.name[lang]}</h5>}
              <div>
                {shapes.map((s) => (
                  <button key={s.id} className={`wb-shape ${current === s.id ? "on" : ""}`} title={s.name[lang]} onClick={() => onPick(s.id)}>
                    <ShapeIcon id={s.id} size={30} />
                  </button>
                ))}
              </div>
            </section>
          );
        })}
        {(isIconCat || query) && (
          <section>
            <h5>
              {isIconCat && !query ? ICON_GROUPS.find((g) => `pic:${g.id}` === cat)?.name[lang] : L("Simgeler", "Icons")} {icons ? `· ${iconNames.length}` : ""}
            </h5>
            {!icons ? (
              <p className="muted small">{L("Simgeler yükleniyor…", "Loading icons…")}</p>
            ) : (
              <div>
                {iconNames.map((n) => (
                  <button key={n} className={`wb-shape ${current === iconId(n) ? "on" : ""}`} title={iconTitle(`icon:${n}`)} onClick={() => onPick(iconId(n))}>
                    <ShapeIcon id={iconId(n)} size={26} />
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
        {!list.length && !iconNames.length && query && icons && <p className="muted small">{L("Sonuç bulunamadı.", "No results.")}</p>}
      </div>
    </div>
  );
}
