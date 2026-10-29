// Çizim penceresi: kalem, fosforlu kalem ve silgi; renk ve kalınlık; geri al ve temizle. PNG olarak `Attachments/`'a kaydedilir.
// Var olan bir çizim düzenlenirken resim tuvale arka plan olarak yüklenir; kaydetmek yeni bir dosya oluşturur.

import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { t } from "../i18n/index.ts";

type Tool = "pen" | "marker" | "eraser";
const COLORS = ["#1f2328", "#e6edf3", "#f85149", "#f0883e", "#d29922", "#3fb950", "#00a8b5", "#2f81f7", "#a371f7"];
const W = 1600;
const H = 1000;

/** Kaydedilirse Attachments yolunu döndürür. */
export function DrawingDialog({ src, onDone }: { src: string | null; onDone: (path: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(() => (document.documentElement.dataset.theme === "light" ? COLORS[0] : COLORS[6]));
  const [size, setSize] = useState(4);
  const [saving, setSaving] = useState(false);
  const history = useRef<ImageData[]>([]);
  const drawing = useRef<{ x: number; y: number } | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    const ctx = canvas.current!.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    if (src) {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(W / img.width, H / img.height, 1);
        ctx.drawImage(img, 0, 0, img.width * scale, img.height * scale);
      };
      img.src = src;
    }
  }, [src]);

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  const down = (e: React.PointerEvent) => {
    const ctx = canvas.current!.getContext("2d")!;
    history.current.push(ctx.getImageData(0, 0, W, H));
    if (history.current.length > 40) history.current.shift();
    force((n) => n + 1);
    canvas.current!.setPointerCapture(e.pointerId);
    drawing.current = pos(e);
    move(e);
  };

  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = canvas.current!.getContext("2d")!;
    const p = pos(e);
    const pressure = e.pointerType === "pen" ? Math.max(0.3, e.pressure) : 1;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = tool === "marker" ? 0.35 : 1;
    ctx.strokeStyle = tool === "eraser" ? "#ffffff" : color;
    ctx.lineWidth = (tool === "eraser" ? size * 6 : tool === "marker" ? size * 4 : size) * pressure;
    ctx.beginPath();
    ctx.moveTo(drawing.current.x, drawing.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    drawing.current = p;
  };

  const undo = () => {
    const prev = history.current.pop();
    if (prev) canvas.current!.getContext("2d")!.putImageData(prev, 0, 0);
    force((n) => n + 1);
  };

  const clear = () => {
    const ctx = canvas.current!.getContext("2d")!;
    history.current.push(ctx.getImageData(0, 0, W, H));
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    force((n) => n + 1);
  };

  const save = async () => {
    setSaving(true);
    const blob = await new Promise<Blob | null>((resolve) => canvas.current!.toBlob(resolve, "image/png"));
    if (!blob) return setSaving(false);
    try {
      const { path } = await api.upload(new File([blob], `${t("draw.fileName")}.png`, { type: "image/png" }));
      onDone(path);
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="overlay">
      <div
        className="dialog drawing-dialog"
        onKeyDown={(e) => {
          if (e.key === "Escape") onDone(null);
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") (e.preventDefault(), undo());
        }}
        tabIndex={-1}
      >
        <div className="draw-tools">
          {(["pen", "marker", "eraser"] as Tool[]).map((k) => (
            <button key={k} className={`secondary ${tool === k ? "on" : ""}`} onClick={() => setTool(k)}>
              {k === "pen" ? "✎" : k === "marker" ? "▮" : "⌫"} {t(k === "pen" ? "draw.pen" : k === "marker" ? "draw.marker" : "draw.eraser")}
            </button>
          ))}
          <span className="sep" />
          {COLORS.map((c) => (
            <button key={c} className={`swatch ${color === c ? "on" : ""}`} style={{ background: c }} onClick={() => (setColor(c), tool === "eraser" && setTool("pen"))} aria-label={c} />
          ))}
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} title={t("focus.custom")} />
          <span className="sep" />
          <label className="muted small">
            {t("draw.size")} <input type="range" min={1} max={20} value={size} onChange={(e) => setSize(Number(e.target.value))} />
          </label>
          <span className="grow" />
          <button className="secondary" onClick={undo} disabled={!history.current.length}>
            ↶ {t("draw.undo")}
          </button>
          <button className="secondary" onClick={clear}>
            {t("draw.clear")}
          </button>
        </div>
        <canvas ref={canvas} width={W} height={H} className={`draw-canvas tool-${tool}`} onPointerDown={down} onPointerMove={move} onPointerUp={() => (drawing.current = null)} onPointerCancel={() => (drawing.current = null)} />
        <div className="dialog-actions">
          <span className="grow" />
          <button className="secondary" onClick={() => onDone(null)}>
            {t("common.cancel")}
          </button>
          <button className="primary" onClick={save} disabled={saving}>
            {t("draw.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
