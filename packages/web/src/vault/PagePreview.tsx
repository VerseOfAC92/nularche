// Sayfa önizlemesi (Obsidian "Page preview"): bir not bağlantısının üzerine gelince notun içeriği küçük bir pencerede
// görünür. Düzenlerken ⌘/Ctrl basılıyken, okuma görünümünde ve kenar panelinde doğrudan çalışır.

import { useEffect, useRef, useState } from "react";
import { api, type NodeMeta } from "../api.ts";
import { headingSection, safeHtml } from "../editor/obsidian-nodes.tsx";
import { toEditorMarkdown, vaultPathFromUrl } from "../editor/paths.ts";
import { modPressed } from "../shortcuts.tsx";
import { t } from "../i18n/index.ts";

interface Preview {
  id: string;
  title: string;
  html: string;
  x: number;
  y: number;
}

/** Fare altındaki öğenin gösterdiği not yolu ve başlık (yoksa null). */
function targetOf(el: HTMLElement): { path: string; heading: string | null; anchor: HTMLElement } | null {
  const wiki = el.closest<HTMLElement>("[data-path]");
  if (wiki) return { path: wiki.dataset.path!, heading: wiki.dataset.heading ?? null, anchor: wiki };
  const a = el.closest<HTMLAnchorElement>("a[href]");
  if (!a) return null;
  const href = a.getAttribute("href") ?? "";
  const path = vaultPathFromUrl(href.split("#")[0]);
  if (!path || !path.endsWith(".md")) return null;
  const hash = href.includes("#") ? decodeURIComponent(href.split("#")[1]) : null;
  return { path, heading: hash, anchor: a };
}

export function PagePreview({ nodes }: { nodes: NodeMeta[] }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const timer = useRef<number | undefined>(undefined);
  const over = useRef<HTMLElement | null>(null);
  const insidePopup = useRef(false);

  useEffect(() => {
    const hide = () => {
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => !insidePopup.current && setPreview(null), 250);
    };
    const onOver = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest(".page-preview")) return;
      const target = targetOf(el);
      if (!target) return void (over.current && ((over.current = null), hide()));
      const reading = !!el.closest(".page.reading, .side-panel, .backlinks, .wiki-embed-body, .canvas-card");
      if (!reading && !modPressed(e)) return;
      if (over.current === target.anchor) return;
      over.current = target.anchor;
      clearTimeout(timer.current);
      timer.current = window.setTimeout(async () => {
        const n = nodesRef.current.find((x) => x.path === target.path);
        if (!n || over.current !== target.anchor) return;
        const d = await api.read(n.id).catch(() => null);
        if (!d || over.current !== target.anchor) return;
        const body = d.locked ? `🔒 ${t("ob.embedLocked")}` : target.heading ? (headingSection(d.body, target.heading) ?? d.body) : d.body;
        const r = target.anchor.getBoundingClientRect();
        const x = Math.max(8, Math.min(r.left, innerWidth - 440));
        const y = r.bottom + 360 > innerHeight ? Math.max(8, r.top - 368) : r.bottom + 6;
        setPreview({ id: n.id, title: n.title, html: safeHtml(toEditorMarkdown(body, d.path)), x, y });
      }, 350);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPreview(null);
    document.addEventListener("mouseover", onOver);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("keydown", onKey);
      clearTimeout(timer.current);
    };
  }, []);

  if (!preview) return null;
  return (
    <div
      className="page-preview"
      style={{ left: preview.x, top: preview.y }}
      onMouseEnter={() => (insidePopup.current = true)}
      onMouseLeave={() => {
        insidePopup.current = false;
        setPreview(null);
      }}
    >
      <div className="page-preview-title">{preview.title}</div>
      <div className="page-preview-body" dangerouslySetInnerHTML={{ __html: preview.html }} />
    </div>
  );
}
