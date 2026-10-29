// Bağlantı grafiği (Obsidian "Graph view"): notlar düğüm, bağlantılar kenar. Tüm kasa ya da açık notun çevresi (yerel
// grafik). Kuvvet yerleşimi tarayıcıda çalışır; sürükle (kaydır), tekerlek (yakınlaş), düğümü sürükle, tıkla (aç).
// Renkler Arche'ye göredir; var olmayan wiki hedefleri ve etiketler isteğe bağlı gösterilir.

import { useEffect, useMemo, useRef, useState } from "react";
import { api, type LinkGraph } from "../api.ts";
import { t } from "../i18n/index.ts";
import { usePref } from "../prefs.ts";
import { isExcluded } from "./excluded.ts";

interface GNode {
  id: string;
  label: string;
  kind: "note" | "ghost" | "tag";
  group: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  deg: number;
  fixed?: boolean;
}

const PALETTE = ["#00a8b5", "#a371f7", "#f0883e", "#3fb950", "#2f81f7", "#d29922", "#f85149", "#db61a2", "#8b949e", "#56d4dd"];
const colorOf = (group: string) => {
  let h = 0;
  for (const c of group) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};

/** Grafik verisinden görünür düğümleri ve kenarları kurar (filtreler ve yerel derinlik uygulanır). */
export function buildGraph(
  data: LinkGraph,
  opts: { focusId?: string | null; depth: number; orphans: boolean; unresolved: boolean; tags: boolean; query: string; excluded: string[] },
): { nodes: Omit<GNode, "x" | "y" | "vx" | "vy">[]; edges: [string, string][] } {
  const notes = data.nodes.filter((n) => !isExcluded(n.path, opts.excluded));
  const ids = new Set(notes.map((n) => n.id));
  let edges: [string, string][] = data.links.filter((l) => ids.has(l.source) && ids.has(l.target)).map((l) => [l.source, l.target]);
  const nodes: Omit<GNode, "x" | "y" | "vx" | "vy">[] = notes.map((n) => ({ id: n.id, label: n.title, kind: "note", group: n.archeId ?? "shadow", deg: 0 }));
  if (opts.unresolved) {
    for (const u of data.unresolved) {
      if (!ids.has(u.source)) continue;
      const gid = `ghost:${u.name.toLocaleLowerCase("tr")}`;
      if (!nodes.some((n) => n.id === gid)) nodes.push({ id: gid, label: u.name, kind: "ghost", group: "ghost", deg: 0 });
      edges.push([u.source, gid]);
    }
  }
  if (opts.tags) {
    for (const n of notes) {
      for (const tag of n.tags) {
        const gid = `tag:${tag.toLocaleLowerCase("tr")}`;
        if (!nodes.some((x) => x.id === gid)) nodes.push({ id: gid, label: `#${tag}`, kind: "tag", group: "tag", deg: 0 });
        edges.push([n.id, gid]);
      }
    }
  }
  let keep: Set<string> | null = null;
  if (opts.focusId) {
    keep = new Set([opts.focusId]);
    let frontier = [opts.focusId];
    for (let d = 0; d < opts.depth; d++) {
      const next: string[] = [];
      for (const [a, b] of edges) {
        if (frontier.includes(a) && !keep.has(b)) (keep.add(b), next.push(b));
        if (frontier.includes(b) && !keep.has(a)) (keep.add(a), next.push(a));
      }
      frontier = next;
    }
  }
  const q = opts.query.trim().toLocaleLowerCase("tr");
  let out = nodes.filter((n) => (!keep || keep.has(n.id)) && (!q || n.label.toLocaleLowerCase("tr").includes(q)));
  const outIds = new Set(out.map((n) => n.id));
  edges = edges.filter(([a, b]) => outIds.has(a) && outIds.has(b) && a !== b);
  const deg = new Map<string, number>();
  for (const [a, b] of edges) (deg.set(a, (deg.get(a) ?? 0) + 1), deg.set(b, (deg.get(b) ?? 0) + 1));
  out = out.map((n) => ({ ...n, deg: deg.get(n.id) ?? 0 }));
  if (!opts.orphans) out = out.filter((n) => n.deg > 0 || n.id === opts.focusId);
  return { nodes: out, edges };
}

export function GraphView({
  focusId = null,
  compact = false,
  changeTick,
  onOpen,
}: {
  focusId?: string | null;
  compact?: boolean;
  changeTick: number;
  onOpen: (id: string) => void;
}) {
  const [data, setData] = useState<LinkGraph | null>(null);
  const [query, setQuery] = useState("");
  const [orphans, setOrphans] = usePref<boolean>("graphOrphans", true);
  const [unresolved, setUnresolved] = usePref<boolean>("graphUnresolved", false);
  const [tags, setTags] = usePref<boolean>("graphTags", false);
  const [depth, setDepth] = usePref<number>("graphDepth", 1);
  const [excluded] = usePref<string[]>("excludedFiles", []);
  const canvas = useRef<HTMLCanvasElement>(null);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  const state = useRef<{ nodes: GNode[]; edges: [GNode, GNode][]; view: { x: number; y: number; k: number }; hover: GNode | null; alpha: number; fitted: boolean }>({
    nodes: [],
    edges: [],
    view: { x: 0, y: 0, k: 1 },
    hover: null,
    alpha: 1,
    fitted: false,
  });

  useEffect(() => {
    api.graph().then(setData, () => setData({ nodes: [], links: [], unresolved: [] }));
  }, [changeTick]);

  const built = useMemo(
    () => (data ? buildGraph(data, { focusId, depth, orphans: focusId ? true : orphans, unresolved, tags, query, excluded }) : null),
    [data, focusId, depth, orphans, unresolved, tags, query, excluded],
  );

  // Yeni veri geldiğinde konumları koru, yeni düğümleri merkeze yakın yerleştir.
  useEffect(() => {
    if (!built) return;
    const s = state.current;
    const old = new Map(s.nodes.map((n) => [n.id, n]));
    s.nodes = built.nodes.map((n, i) => {
      const prev = old.get(n.id);
      const a = i * 2.399963;
      const r = 30 * Math.sqrt(i + 1);
      return prev ? { ...prev, ...n } : { ...n, x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, fixed: n.id === focusId };
    });
    const byId = new Map(s.nodes.map((n) => [n.id, n]));
    s.edges = built.edges.map(([a, b]) => [byId.get(a)!, byId.get(b)!]);
    s.alpha = 1;
    s.fitted = false;
  }, [built, focusId]);

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext("2d")!;
    let raf = 0;
    const s = state.current;
    const styles = getComputedStyle(document.documentElement);
    const fg = styles.getPropertyValue("--nlc-text-secondary").trim() || "#8b949e";
    const line = styles.getPropertyValue("--nlc-border-subtle").trim() || "#30363d";
    const accent = styles.getPropertyValue("--nlc-accent-primary").trim() || "#00a8b5";

    const tick = () => {
      const { nodes, edges } = s;
      if (s.alpha > 0.01) {
        const n = nodes.length;
        // İtme (büyük grafiklerde örneklenerek), çekme (kenarlar), merkeze çekim.
        const sample = n > 700 ? Math.ceil(n / 350) : 1;
        for (let i = 0; i < n; i++) {
          const a = nodes[i];
          for (let j = (i % sample) + i + 1; j < n; j += sample) {
            const b = nodes[j];
            let dx = a.x - b.x;
            let dy = a.y - b.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 0.01) (dx = Math.random() - 0.5, dy = Math.random() - 0.5, d2 = 0.5);
            const f = (300 * sample * s.alpha) / d2;
            a.vx += dx * f;
            a.vy += dy * f;
            b.vx -= dx * f;
            b.vy -= dy * f;
          }
        }
        for (const [a, b] of edges) {
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const f = ((d - 70) / d) * 0.06 * s.alpha;
          a.vx += dx * f;
          a.vy += dy * f;
          b.vx -= dx * f;
          b.vy -= dy * f;
        }
        for (const p of nodes) {
          p.vx -= p.x * 0.06 * s.alpha;
          p.vy -= p.y * 0.06 * s.alpha;
          if (p.fixed) {
            p.vx = p.vy = 0;
            continue;
          }
          p.vx *= 0.6;
          p.vy *= 0.6;
          p.x += Math.max(-30, Math.min(30, p.vx));
          p.y += Math.max(-30, Math.min(30, p.vy));
        }
        s.alpha *= 0.985;
        // Yerleşim oturunca tüm düğümler görünecek biçimde bir kez sığdır.
        if (!s.fitted && s.alpha < 0.06 && nodes.length) {
          s.fitted = true;
          const xs = nodes.map((p) => p.x);
          const ys = nodes.map((p) => p.y);
          const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
          const k = Math.max(0.15, Math.min(1.6, (el.clientWidth - 80) / (x1 - x0 + 80), (el.clientHeight - 80) / (y1 - y0 + 80)));
          s.view = { k, x: (-(x0 + x1) / 2) * k, y: (-(y0 + y1) / 2) * k };
        }
      }
      draw();
      raf = requestAnimationFrame(tick);
    };

    const draw = () => {
      const dpr = devicePixelRatio || 1;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (el.width !== w * dpr || el.height !== h * dpr) (el.width = w * dpr), (el.height = h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const { x: ox, y: oy, k } = s.view;
      ctx.translate(w / 2 + ox, h / 2 + oy);
      ctx.scale(k, k);
      const hover = s.hover;
      const near = new Set<GNode>();
      if (hover) for (const [a, b] of s.edges) if (a === hover || b === hover) (near.add(a), near.add(b));
      ctx.lineWidth = 1 / k;
      for (const [a, b] of s.edges) {
        ctx.strokeStyle = hover && (a === hover || b === hover) ? accent : line;
        ctx.globalAlpha = hover && !(a === hover || b === hover) ? 0.25 : 0.9;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      for (const p of s.nodes) {
        const r = 3 + Math.min(10, Math.sqrt(p.deg) * 2);
        ctx.globalAlpha = hover && p !== hover && !near.has(p) ? 0.25 : 1;
        ctx.fillStyle = p.id === focusId ? accent : p.kind === "ghost" ? "transparent" : p.kind === "tag" ? "#8b949e" : colorOf(p.group);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        if (p.kind === "ghost") ((ctx.strokeStyle = fg), ctx.setLineDash([2 / k, 2 / k]), ctx.stroke(), ctx.setLineDash([]));
        if (k > 0.7 || p === hover || near.has(p) || p.id === focusId || compact) {
          ctx.fillStyle = fg;
          ctx.font = `${11 / Math.max(k, 0.7)}px system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(p.label.length > 32 ? `${p.label.slice(0, 30)}…` : p.label, p.x, p.y + r + 12 / Math.max(k, 0.7));
        }
      }
      ctx.globalAlpha = 1;
    };

    const toWorld = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      const { x, y, k } = s.view;
      return { x: (e.clientX - r.left - r.width / 2 - x) / k, y: (e.clientY - r.top - r.height / 2 - y) / k };
    };
    const hit = (e: PointerEvent | MouseEvent) => {
      const p = toWorld(e);
      let best: GNode | null = null;
      let bd = 14 / s.view.k;
      for (const n of s.nodes) {
        const d = Math.hypot(n.x - p.x, n.y - p.y);
        if (d < bd) (bd = d), (best = n);
      }
      return best;
    };

    let drag: { node: GNode | null; sx: number; sy: number; vx: number; vy: number; moved: boolean } | null = null;
    const down = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      drag = { node: hit(e), sx: e.clientX, sy: e.clientY, vx: s.view.x, vy: s.view.y, moved: false };
    };
    const move = (e: PointerEvent) => {
      if (!drag) {
        const h = hit(e);
        if (h !== s.hover) s.hover = h;
        el.style.cursor = h ? "pointer" : "grab";
        return;
      }
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 3) drag.moved = true;
      if (drag.node) {
        const p = toWorld(e);
        Object.assign(drag.node, { x: p.x, y: p.y, vx: 0, vy: 0 });
        s.alpha = Math.max(s.alpha, 0.3);
      } else s.view = { ...s.view, x: drag.vx + e.clientX - drag.sx, y: drag.vy + e.clientY - drag.sy };
    };
    const up = () => {
      if (drag && !drag.moved && drag.node && drag.node.kind === "note") openRef.current(drag.node.id);
      drag = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const k = Math.max(0.15, Math.min(4, s.view.k * Math.exp(-e.deltaY * 0.0015)));
      s.view = { ...s.view, k };
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("wheel", wheel, { passive: false });
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("wheel", wheel);
    };
  }, [focusId, compact]);

  return (
    <div className={`graph-view ${compact ? "compact" : ""}`}>
      {!compact && (
        <header className="graph-head">
          <h1>🕸 {t("ob.graph")}</h1>
          <input className="graph-search" placeholder={t("ob.graphFilter")} value={query} onChange={(e) => setQuery(e.target.value)} />
          <label className="check">
            <input type="checkbox" checked={orphans} onChange={(e) => setOrphans(e.target.checked)} /> {t("ob.graphOrphans")}
          </label>
          <label className="check">
            <input type="checkbox" checked={unresolved} onChange={(e) => setUnresolved(e.target.checked)} /> {t("ob.graphUnresolved")}
          </label>
          <label className="check">
            <input type="checkbox" checked={tags} onChange={(e) => setTags(e.target.checked)} /> {t("ob.graphTags")}
          </label>
          <span className="muted small">{t("ob.graphCount", { n: built?.nodes.length ?? 0, e: built?.edges.length ?? 0 })}</span>
        </header>
      )}
      {compact && (
        <div className="graph-depth">
          <span className="muted small">{t("ob.graphDepth")}</span>
          {[1, 2, 3].map((d) => (
            <button key={d} className={`secondary ${depth === d ? "on" : ""}`} onClick={() => setDepth(d)}>
              {d}
            </button>
          ))}
        </div>
      )}
      <canvas ref={canvas} className="graph-canvas" />
    </div>
  );
}
