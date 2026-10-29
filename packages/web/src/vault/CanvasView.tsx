// Tuval (Obsidian "Canvas"): metin, not, bağlantı ve grup kartları; kartlar arası oklar. Boşluğa çift tıkla: metin kartı;
// kartı sürükle: taşı; sağ alt köşe: boyutlandır; kartın kenarındaki noktadan sürükle: başka karta bağla; Delete: sil.
// Arka planı sürükle: kaydır; tekerlek: yakınlaş. Değişiklikler notun gövdesindeki JSON Canvas bloğuna yazılır.

import { useEffect, useMemo, useRef, useState } from "react";
import type { NodeMeta } from "../api.ts";
import { askText } from "../ask.tsx";
import { desktop } from "../desktop.ts";
import { safeHtml } from "../editor/obsidian-nodes.tsx";
import { fileUrl } from "../editor/paths.ts";
import { t } from "../i18n/index.ts";
import { anchor, autoSides, colorValue, newId, parseCanvas, serializeCanvas, type CanvasData, type CanvasNode } from "./canvas-model.ts";
import { NotePicker } from "./Palettes.tsx";

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

export function CanvasView({ body, nodes, onChange, onOpen }: { body: string; nodes: NodeMeta[]; onChange: (body: string) => void; onOpen: (id: string) => void }) {
  const parsed = useMemo(() => parseCanvas(body), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [data, setData] = useState<CanvasData>(parsed.data);
  // Açılışta kartların sol üst köşesi görünür (koordinatlar eksi değerli olabilir).
  const [view, setView] = useState(() => {
    const ns = parsed.data.nodes;
    return ns.length ? { x: 40 - Math.min(...ns.map((n) => n.x)), y: 40 - Math.min(...ns.map((n) => n.y)), k: 1 } : { x: 40, y: 40, k: 1 };
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [linking, setLinking] = useState<{ from: string; x: number; y: number } | null>(null);
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const board = useRef<HTMLDivElement>(null);
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const first = useRef(true);

  // Kaydet (bozuk bir blok varsa üzerine yazma).
  useEffect(() => {
    if (first.current) return void (first.current = false);
    if (parsed.broken) return;
    const timer = setTimeout(() => onChange(serializeCanvas(bodyRef.current, data)), 400);
    return () => clearTimeout(timer);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const toWorld = (cx: number, cy: number) => {
    const r = board.current!.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k };
  };
  const update = (id: string, patch: Partial<CanvasNode>) => setData((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
  const addNode = (n: Omit<CanvasNode, "id">) => {
    const node = { id: newId(), ...n } as CanvasNode;
    setData((d) => ({ ...d, nodes: n.type === "group" ? [node, ...d.nodes] : [...d.nodes, node] }));
    setSelected(node.id);
    return node;
  };
  const center = () => {
    const r = board.current!.getBoundingClientRect();
    return toWorld(r.left + r.width / 2 - 120, r.top + r.height / 2 - 60);
  };
  const remove = (id: string) => {
    setData((d) => ({ ...d, nodes: d.nodes.filter((n) => n.id !== id), edges: d.edges.filter((e) => e.id !== id && e.fromNode !== id && e.toNode !== id) }));
    setSelected(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selected || editing || (e.target as HTMLElement).closest("input,textarea,[contenteditable=true]")) return;
      if (e.key === "Delete" || e.key === "Backspace") (e.preventDefault(), remove(selected));
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  /** Kartı taşıma ya da boyutlandırma (grup taşınınca içindeki kartlar da gelir). */
  const startDrag = (e: React.PointerEvent, n: CanvasNode, mode: "move" | "resize") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setSelected(n.id);
    const start = { x: e.clientX, y: e.clientY };
    const inside = n.type === "group" ? data.nodes.filter((m) => m.id !== n.id && m.x >= n.x && m.y >= n.y && m.x + m.width <= n.x + n.width && m.y + m.height <= n.y + n.height) : [];
    const orig = new Map([n, ...inside].map((m) => [m.id, { x: m.x, y: m.y, w: m.width, h: m.height }]));
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / view.k;
      const dy = (ev.clientY - start.y) / view.k;
      setData((d) => ({
        ...d,
        nodes: d.nodes.map((m) => {
          const o = orig.get(m.id);
          if (!o) return m;
          if (mode === "resize") return m.id === n.id ? { ...m, width: Math.max(120, Math.round(o.w + dx)), height: Math.max(60, Math.round(o.h + dy)) } : m;
          return { ...m, x: Math.round(o.x + dx), y: Math.round(o.y + dy) };
        }),
      }));
    };
    const up = () => (removeEventListener("pointermove", move), removeEventListener("pointerup", up));
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };

  const startLink = (e: React.PointerEvent, n: CanvasNode) => {
    e.stopPropagation();
    const p = toWorld(e.clientX, e.clientY);
    setLinking({ from: n.id, ...p });
    const move = (ev: PointerEvent) => setLinking((l) => l && { ...l, ...toWorld(ev.clientX, ev.clientY) });
    const up = (ev: PointerEvent) => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      setLinking(null);
      const target = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-card]")?.dataset.card;
      if (!target || target === n.id) return;
      setData((d) => {
        const a = d.nodes.find((x) => x.id === n.id)!;
        const b = d.nodes.find((x) => x.id === target)!;
        const [fromSide, toSide] = autoSides(a, b);
        return { ...d, edges: [...d.edges, { id: newId(), fromNode: a.id, toNode: b.id, fromSide, toSide, toEnd: "arrow" }] };
      });
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };

  const pan = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    setSelected(null);
    setEditing(null);
    const start = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    const move = (ev: PointerEvent) => setView((v) => ({ ...v, x: start.vx + ev.clientX - start.x, y: start.vy + ev.clientY - start.y }));
    const up = () => (removeEventListener("pointermove", move), removeEventListener("pointerup", up));
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };

  const zoom = (factor: number, cx?: number, cy?: number) =>
    setView((v) => {
      const r = board.current!.getBoundingClientRect();
      const px = (cx ?? r.left + r.width / 2) - r.left;
      const py = (cy ?? r.top + r.height / 2) - r.top;
      const k = Math.max(0.2, Math.min(3, v.k * factor));
      return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
    });

  useEffect(() => {
    const el = board.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoom(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });

  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const noteByPath = new Map(nodes.map((n) => [n.path, n]));

  const cardBody = (n: CanvasNode) => {
    if (n.type === "text") {
      if (editing === n.id)
        return (
          <textarea
            className="canvas-text-input"
            autoFocus
            value={n.text ?? ""}
            onChange={(e) => update(n.id, { text: e.target.value })}
            onBlur={() => setEditing(null)}
            onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
            onPointerDown={(e) => e.stopPropagation()}
          />
        );
      return <div className="canvas-md" dangerouslySetInnerHTML={{ __html: safeHtml(n.text || "") || `<p class="muted">${t("ob.canvasEmptyCard")}</p>` }} />;
    }
    if (n.type === "file") {
      const note = n.file ? noteByPath.get(n.file) : undefined;
      if (n.file && IMAGE_RE.test(n.file)) return <img src={fileUrl(n.file)} alt="" draggable={false} />;
      return note ? (
        <div className="canvas-note">
          <button className="canvas-note-title" onPointerDown={(e) => e.stopPropagation()} onClick={() => onOpen(note.id)}>
            {note.icon ?? "◇"} {note.title}
          </button>
          <p className="muted small">{note.excerpt}</p>
        </div>
      ) : (
        <p className="muted small">{n.file}</p>
      );
    }
    if (n.type === "link")
      return (
        <a href={n.url} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => (e.preventDefault(), n.url && (desktop ? desktop.openExternal(n.url) : window.open(n.url, "_blank", "noopener")))}>
          🔗 {n.url}
        </a>
      );
    return null;
  };

  return (
    <div className="canvas-wrap">
      <div className="canvas-toolbar">
        <button className="secondary" onClick={() => addNode({ type: "text", text: "", ...center(), width: 260, height: 120 })}>
          ＋ {t("ob.canvasText")}
        </button>
        <button className="secondary" onClick={() => setPicker(center())}>
          ＋ {t("ob.canvasNote")}
        </button>
        <button
          className="secondary"
          onClick={async () => {
            const url = (await askText(t("ob.canvasLinkPrompt"), "https://"))?.trim();
            if (url && /^https?:\/\/\S+$/.test(url)) addNode({ type: "link", url, ...center(), width: 300, height: 80 });
          }}
        >
          ＋ {t("ob.canvasLink")}
        </button>
        <button className="secondary" onClick={() => addNode({ type: "group", label: t("ob.canvasGroup"), ...center(), width: 480, height: 320 })}>
          ＋ {t("ob.canvasGroup")}
        </button>
        <span className="grow" />
        {selected && byId.get(selected) && (
          <span className="canvas-colors">
            {["", "1", "2", "3", "4", "5", "6"].map((c) => (
              <button key={c || "none"} className="swatch" style={{ background: colorValue(c) ?? "var(--nlc-bg-surface)" }} onClick={() => update(selected, { color: c || undefined })} />
            ))}
          </span>
        )}
        <button className="secondary" onClick={() => zoom(1 / 1.2)}>
          −
        </button>
        <span className="muted small">{Math.round(view.k * 100)}%</span>
        <button className="secondary" onClick={() => zoom(1.2)}>
          ＋
        </button>
      </div>
      {parsed.broken && <div className="banner error">{t("ob.canvasBroken")}</div>}
      <div
        ref={board}
        className="canvas-board"
        onPointerDown={pan}
        onDoubleClick={(e) => {
          if (e.target !== e.currentTarget) return;
          const p = toWorld(e.clientX, e.clientY);
          const n = addNode({ type: "text", text: "", x: Math.round(p.x - 130), y: Math.round(p.y - 60), width: 260, height: 120 });
          setEditing(n.id);
        }}
        style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${24 * view.k}px ${24 * view.k}px` }}
      >
        <div className="canvas-layer" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
          <svg className="canvas-edges">
            <defs>
              <marker id="nl-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
              </marker>
            </defs>
            {data.edges.map((e) => {
              const a = byId.get(e.fromNode);
              const b = byId.get(e.toNode);
              if (!a || !b) return null;
              const [fs, ts] = autoSides(a, b);
              const p = anchor(a, e.fromSide ?? fs);
              const q = anchor(b, e.toSide ?? ts);
              const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
              return (
                <g key={e.id} className={selected === e.id ? "selected" : ""} onPointerDown={(ev) => (ev.stopPropagation(), setSelected(e.id))}>
                  <path d={`M${p.x},${p.y} L${q.x},${q.y}`} className="canvas-edge-hit" />
                  <path d={`M${p.x},${p.y} L${q.x},${q.y}`} className="canvas-edge" style={{ stroke: colorValue(e.color) }} markerEnd={e.toEnd === "none" ? undefined : "url(#nl-arrow)"} markerStart={e.fromEnd === "arrow" ? "url(#nl-arrow)" : undefined} />
                  {e.label && (
                    <text x={mid.x} y={mid.y - 6} className="canvas-edge-label">
                      {e.label}
                    </text>
                  )}
                </g>
              );
            })}
            {linking &&
              (() => {
                const a = byId.get(linking.from);
                if (!a) return null;
                const p = anchor(a, "right");
                return <path d={`M${p.x},${p.y} L${linking.x},${linking.y}`} className="canvas-edge" />;
              })()}
          </svg>
          {data.nodes.map((n) => (
            <div
              key={n.id}
              data-card={n.id}
              className={`canvas-card ${n.type} ${selected === n.id ? "selected" : ""}`}
              style={{ left: n.x, top: n.y, width: n.width, height: n.height, borderColor: colorValue(n.color), ...(n.type === "group" ? { background: colorValue(n.color) ? `${colorValue(n.color)}14` : undefined } : {}) }}
              onPointerDown={(e) => startDrag(e, n, "move")}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (n.type === "text") setEditing(n.id);
                else if (n.type === "group")
                  void askText(t("ob.canvasGroupName"), n.label ?? "").then((label) => label !== null && update(n.id, { label }));
              }}
            >
              {n.type === "group" ? <div className="canvas-group-label">{n.label}</div> : cardBody(n)}
              <span className="canvas-connect" title={t("ob.canvasConnect")} onPointerDown={(e) => startLink(e, n)} />
              <span className="canvas-resize" onPointerDown={(e) => startDrag(e, n, "resize")} />
            </div>
          ))}
        </div>
        {!data.nodes.length && <p className="canvas-hint muted">{t("ob.canvasHint")}</p>}
      </div>
      {picker && (
        <NotePicker
          nodes={nodes.filter((n) => n.layoutMode !== "canvas")}
          placeholder={t("ob.switcherPlaceholder")}
          onClose={() => setPicker(null)}
          onPick={(note) => addNode({ type: "file", file: note.path, x: picker.x, y: picker.y, width: 300, height: 160 })}
        />
      )}
    </div>
  );
}
