// Lectern: Origin'deki PDF'leri okuma ve işaretleme. Metin seçilip renkli vurgulanır, vurgulara yorum yazılır;
// vurgular tek tıkla bir nota aktarılır (her vurgu sayfasına dönen bir bağlantıyla). İşaretlemeler
// `.nularche/annotations/` altında saklanır (bkz. core/src/annotations.ts). Sayfalar görünür olduklarında çizilir.

import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HighlightColor, PdfAnnotations, PdfHighlight } from "../../../core/src/annotations.ts";
import { api, SHADOW, type NodeMeta } from "../api.ts";
import { dirname, fileUrl, relative } from "../editor/paths.ts";
import { t } from "../i18n/index.ts";
import { getPref, setPref } from "../prefs.ts";
import { Icon } from "../ui/Icon.tsx";
import "./lectern.css";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const COLORS: HighlightColor[] = ["yellow", "green", "blue", "pink", "purple"];
const ZOOMS = [0.6, 0.8, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

type Rect = PdfHighlight["rects"][number];

interface Props {
  path: string;
  page?: number;
  highlight?: string;
  nodes: NodeMeta[];
  onOpenNote: (id: string) => void;
  onChanged: () => void;
  onToast: (msg: string) => void;
}

const newId = () => `hl-${Math.random().toString(36).slice(2, 8)}`;
const fileName = (p: string) => p.split("/").pop() ?? p;
const linkPath = (from: string, to: string) => relative(dirname(from), to).split("/").map(encodeURIComponent).join("/");

/** Notun içine yazılacak alıntı: metin, blok kimliği ve PDF'nin sayfasına dönen bağlantı. */
export function quoteMarkdown(h: PdfHighlight, pdfPath: string, notePath: string | null): string {
  const target = notePath ? linkPath(notePath, pdfPath) : pdfPath.split("/").map(encodeURIComponent).join("/");
  const text = h.text.replace(/\s+/g, " ").trim();
  const lines = [`> ${text} ^${h.id}`, ">", `> — [${t("lectern.pageShort", { n: h.page })}](${target}#page=${h.page}&hl=${h.id})`];
  if (h.comment?.trim()) lines.push("", h.comment.trim());
  return lines.join("\n");
}

export default function LecternView({ path, page, highlight, nodes, onOpenNote, onChanged, onToast }: Props) {
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ann, setAnn] = useState<PdfAnnotations | null>(null);
  const [zoom, setZoomState] = useState<number>(() => Number(getPref("lecternZoom", 1.25)) || 1.25);
  const [current, setCurrent] = useState(1);
  const [pending, setPending] = useState<{ page: number; rects: Rect[]; text: string; x: number; y: number } | null>(null);
  const [focus, setFocus] = useState<string | null>(highlight ?? null);
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const annRef = useRef(ann);
  annRef.current = ann;

  const setZoom = (z: number) => {
    setZoomState(z);
    setPref("lecternZoom", z);
  };

  // Belgeyi ve işaretlemeleri yükle.
  useEffect(() => {
    let live = true;
    setDoc(null);
    setError(null);
    const task = pdfjs.getDocument({ url: fileUrl(path), enableXfa: false });
    task.promise.then(
      async (d) => {
        if (!live) return;
        const dims: { w: number; h: number }[] = [];
        for (let i = 1; i <= d.numPages; i++) {
          const vp = (await d.getPage(i)).getViewport({ scale: 1 });
          dims.push({ w: vp.width, h: vp.height });
        }
        if (!live) return;
        // Yakınlaştırma hiç seçilmediyse sayfa genişliğe sığdırılır.
        if (getPref<number | null>("lecternZoom", null) === null && scroller.current && dims[0]) {
          setZoomState(Math.min(2, Math.max(0.6, Math.floor(((scroller.current.clientWidth - 64) / dims[0].w) * 20) / 20)));
        }
        setSizes(dims);
        setDoc(d);
      },
      (e) => live && setError(String((e as Error).message ?? e)),
    );
    fetch(`/api/annotations?path=${encodeURIComponent(path)}`)
      .then((r) => (r.ok ? r.json() : { v: 1, path, highlights: [] }))
      .then((a: PdfAnnotations) => live && setAnn(a))
      .catch(() => live && setAnn({ v: 1, path, highlights: [] }));
    return () => {
      live = false;
      void task.destroy();
    };
  }, [path]);

  const save = useCallback(
    async (next: PdfAnnotations) => {
      setAnn(next);
      const r = await fetch(`/api/annotations?path=${encodeURIComponent(path)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
      if (!r.ok) onToast(t("lectern.saveFailed"));
    },
    [path, onToast],
  );

  // Açılışta istenen sayfaya ya da son okunan sayfaya git.
  const jumped = useRef(false);
  useEffect(() => {
    if (!doc || !ann || jumped.current) return;
    jumped.current = true;
    const target = highlight ? ann.highlights.find((h) => h.id === highlight)?.page : undefined;
    const p = page ?? target ?? ann.lastPage;
    if (p && p > 1) requestAnimationFrame(() => goTo(p));
  }, [doc, ann]); // eslint-disable-line react-hooks/exhaustive-deps

  const goTo = (p: number) => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-page="${p}"]`);
    el?.scrollIntoView({ block: "start" });
  };

  // Görünen sayfayı izle (son okunan sayfa olarak saklanır).
  useEffect(() => {
    const el = scroller.current;
    if (!el || !doc) return;
    let timer: number | undefined;
    const onScroll = () => {
      const pages = [...el.querySelectorAll<HTMLElement>(".lectern-page")];
      const mid = el.getBoundingClientRect().top + el.clientHeight / 3;
      const at = pages.find((p) => p.getBoundingClientRect().bottom > mid);
      const n = Number(at?.dataset.page ?? 1);
      setCurrent(n);
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        const a = annRef.current;
        if (a && a.lastPage !== n) void save({ ...a, lastPage: n });
      }, 1500);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => (el.removeEventListener("scroll", onScroll), clearTimeout(timer));
  }, [doc, save]);

  // Metin seçilince vurgulama araç çubuğu.
  const onMouseUp = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return setPending(null);
    const range = sel.getRangeAt(0);
    const pageEl = (range.startContainer.parentElement ?? null)?.closest<HTMLElement>(".lectern-page");
    if (!pageEl) return setPending(null);
    const box = pageEl.getBoundingClientRect();
    const rects: Rect[] = [];
    for (const r of range.getClientRects()) {
      if (r.width < 1 || r.height < 1) continue;
      // Yalnızca başladığı sayfadaki parçalar (sayfalar arası seçimde ilk sayfa).
      if (r.bottom < box.top || r.top > box.bottom) continue;
      rects.push([(r.left - box.left) / box.width, (r.top - box.top) / box.height, r.width / box.width, r.height / box.height]);
    }
    const text = sel.toString().replace(/\s+/g, " ").trim();
    if (!rects.length || !text) return setPending(null);
    const last = range.getClientRects()[range.getClientRects().length - 1];
    const host = scroller.current!.getBoundingClientRect();
    setPending({ page: Number(pageEl.dataset.page), rects: mergeRects(rects), text, x: last.right - host.left, y: last.bottom - host.top + scroller.current!.scrollTop });
  };

  async function addHighlight(color: HighlightColor) {
    if (!pending || !ann) return;
    const h: PdfHighlight = { id: newId(), page: pending.page, rects: pending.rects, text: pending.text, color, created: Date.now() };
    window.getSelection()?.removeAllRanges();
    setPending(null);
    await save({ ...ann, highlights: [...ann.highlights, h] });
    setFocus(h.id);
    // Not zaten varsa yeni vurgu sonuna eklenir.
    const note = ann.noteId ? nodes.find((n) => n.id === ann.noteId) : undefined;
    if (note && !note.locked) {
      try {
        const d = await api.read(note.id);
        await api.update(note.id, { body: `${d.body.trimEnd()}\n\n${quoteMarkdown(h, path, d.path)}\n`, baseRevision: d.revision });
        onChanged();
      } catch {
        // not değişmiş olabilir: kullanıcı "Nota aktar" ile yeniden aktarabilir
      }
    }
  }

  async function copyQuote(h: PdfHighlight | { text: string; page: number; id?: string }) {
    const full: PdfHighlight = { id: h.id ?? newId(), page: h.page, rects: [], text: h.text, color: "yellow", created: 0, ...("comment" in h && h.comment ? { comment: h.comment } : {}) };
    await navigator.clipboard.writeText(quoteMarkdown(full, path, null)).catch(() => undefined);
    onToast(t("lectern.copied"));
  }

  async function exportToNote() {
    if (!ann) return;
    const existing = ann.noteId ? nodes.find((n) => n.id === ann.noteId) : undefined;
    if (existing) return onOpenNote(existing.id);
    const sorted = [...ann.highlights].sort((a, b) => a.page - b.page || a.rects[0][1] - b.rects[0][1]);
    const created = await api.create(`${fileName(path).replace(/\.pdf$/i, "")} — ${t("lectern.notes")}`, SHADOW);
    const body = [`${t("lectern.source")}: [${fileName(path)}](${linkPath(created.path, path)})`, ...sorted.map((h) => quoteMarkdown(h, path, created.path))].join("\n\n");
    await api.update(created.id, { body: `${body}\n`, fields: { icon: "📑" } });
    await save({ ...ann, noteId: created.id });
    onChanged();
    onToast(t("lectern.noteCreated"));
    onOpenNote(created.id);
  }

  const updateHighlight = (id: string, patch: Partial<PdfHighlight>) => ann && void save({ ...ann, highlights: ann.highlights.map((h) => (h.id === id ? { ...h, ...patch } : h)) });
  const removeHighlight = (id: string) => ann && void save({ ...ann, highlights: ann.highlights.filter((h) => h.id !== id) });

  const byPage = useMemo(() => {
    const m = new Map<number, PdfHighlight[]>();
    for (const h of ann?.highlights ?? []) m.set(h.page, [...(m.get(h.page) ?? []), h]);
    return m;
  }, [ann]);
  const list = useMemo(() => [...(ann?.highlights ?? [])].sort((a, b) => a.page - b.page || a.rects[0][1] - b.rects[0][1]), [ann]);
  const note = ann?.noteId ? nodes.find((n) => n.id === ann.noteId) : undefined;

  return (
    <div className="lectern" data-testid="lectern">
      <div className="topbar lectern-bar">
        <div className="crumbs">
          <Icon name="file-type-pdf" size={16} /> <span title={path}>{fileName(path)}</span>
        </div>
        <div className="topbar-right">
          {doc && (
            <span className="muted small" data-testid="lectern-page">
              {t("lectern.pageOf", { n: current, total: doc.numPages })}
            </span>
          )}
          <button className="icon-btn" title={t("lectern.zoomOut")} onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.findIndex((z) => z >= zoom) - 1)])}>
            <Icon name="minus" size={14} />
          </button>
          <span className="muted small">{Math.round(zoom * 100)}%</span>
          <button className="icon-btn" title={t("lectern.zoomIn")} onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.findIndex((z) => z > zoom))] ?? zoom)}>
            <Icon name="plus" size={14} />
          </button>
          <button className="secondary" onClick={() => void exportToNote()} disabled={!ann} data-testid="lectern-note">
            <Icon name="notes" size={14} /> {note ? t("lectern.openNote") : t("lectern.toNote")}
          </button>
        </div>
      </div>
      <div className="lectern-body">
        <div className="lectern-pages" ref={scroller} onMouseUp={onMouseUp}>
          {error && <p className="error-text">{t("lectern.openFailed", { error })}</p>}
          {!doc && !error && <p className="muted">…</p>}
          {doc &&
            sizes.map((s, i) => (
              <PageView
                key={`${i}:${zoom}`}
                doc={doc}
                n={i + 1}
                zoom={zoom}
                size={s}
                highlights={byPage.get(i + 1) ?? []}
                focus={focus}
              />
            ))}
          {pending && (
            <div className="lectern-pop" style={{ left: Math.max(8, pending.x - 120), top: pending.y + 6 }} onMouseUp={(e) => e.stopPropagation()}>
              {COLORS.map((c) => (
                <button key={c} className={`hl-dot hl-${c}`} title={t(`lectern.color.${c}` as never)} onClick={() => void addHighlight(c)} data-testid={`hl-${c}`} />
              ))}
              <button className="icon-btn" title={t("lectern.copyQuote")} onClick={() => void copyQuote(pending)}>
                <Icon name="copy" size={14} />
              </button>
            </div>
          )}
        </div>
        <aside className="lectern-side">
          <h4>
            {t("lectern.highlights")} <span className="muted small">{list.length}</span>
          </h4>
          {!list.length && <p className="muted small">{t("lectern.empty")}</p>}
          {list.map((h) => (
            <div key={h.id} className={`lectern-hl ${focus === h.id ? "on" : ""}`} data-testid="lectern-hl">
              <button className="lectern-hl-text" onClick={() => (setFocus(h.id), goTo(h.page))}>
                <span className={`hl-bar hl-${h.color}`} />
                <span className="muted small">{t("lectern.pageShort", { n: h.page })}</span> {h.text}
              </button>
              <textarea
                placeholder={t("lectern.comment")}
                defaultValue={h.comment ?? ""}
                rows={h.comment ? 2 : 1}
                onBlur={(e) => e.target.value !== (h.comment ?? "") && updateHighlight(h.id, { comment: e.target.value })}
              />
              <div className="row">
                {COLORS.map((c) => (
                  <button key={c} className={`hl-dot small hl-${c} ${h.color === c ? "on" : ""}`} onClick={() => updateHighlight(h.id, { color: c })} />
                ))}
                <span className="grow" />
                <button className="icon-btn" title={t("lectern.copyQuote")} onClick={() => void copyQuote(h)}>
                  <Icon name="copy" size={14} />
                </button>
                <button className="icon-btn" title={t("lectern.remove")} onClick={() => removeHighlight(h.id)}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}

/** Aynı satırdaki bitişik dikdörtgenleri birleştirir (seçim satır başına çok parça üretir). */
function mergeRects(rects: Rect[]): Rect[] {
  const sorted = [...rects].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const out: Rect[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] - r[1]) < 0.004 && Math.abs(last[3] - r[3]) < 0.006 && r[0] <= last[0] + last[2] + 0.01) {
      const right = Math.max(last[0] + last[2], r[0] + r[2]);
      last[2] = right - last[0];
    } else out.push([...r] as Rect);
  }
  return out;
}

function PageView({
  doc,
  n,
  zoom,
  size,
  highlights,
  focus,
}: {
  doc: pdfjs.PDFDocumentProxy;
  n: number;
  zoom: number;
  size: { w: number; h: number };
  highlights: PdfHighlight[];
  focus: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let renderTask: pdfjs.RenderTask | null = null;
    let textLayer: pdfjs.TextLayer | null = null;
    void (async () => {
      const page = await doc.getPage(n);
      if (cancelled) return;
      const viewport = page.getViewport({ scale: zoom });
      const dpr = window.devicePixelRatio || 1;
      const c = canvas.current!;
      c.width = Math.floor(viewport.width * dpr);
      c.height = Math.floor(viewport.height * dpr);
      c.style.width = `${viewport.width}px`;
      c.style.height = `${viewport.height}px`;
      renderTask = page.render({ canvas: c, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      await renderTask.promise.catch(() => undefined);
      if (cancelled || !text.current) return;
      text.current.replaceChildren();
      textLayer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: text.current, viewport });
      await textLayer.render().catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [visible, doc, n, zoom]);

  return (
    <div
      ref={ref}
      className="lectern-page"
      data-page={n}
      style={{ width: size.w * zoom, height: size.h * zoom, ["--total-scale-factor" as string]: zoom, ["--scale-factor" as string]: zoom }}
    >
      <canvas ref={canvas} />
      <div className="lectern-marks">
        {highlights.flatMap((h) =>
          h.rects.map((r, i) => (
            <div
              key={`${h.id}:${i}`}
              className={`lectern-mark hl-${h.color} ${focus === h.id ? "on" : ""}`}
              style={{ left: `${r[0] * 100}%`, top: `${r[1] * 100}%`, width: `${r[2] * 100}%`, height: `${r[3] * 100}%` }}
            />
          )),
        )}
      </div>
      <div ref={text} className="textLayer" />
      <span className="lectern-num">{n}</span>
    </div>
  );
}
