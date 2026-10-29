// Sunum (Obsidian "Slides"): not `---` ayırıcılarından slaytlara bölünür ve tam ekran gösterilir.
// ←/→, boşluk ve PageUp/PageDown ile gezinilir; Esc kapatır.

import { useEffect, useMemo, useState } from "react";
import { desktop } from "../desktop.ts";
import { safeHtml } from "../editor/obsidian-nodes.tsx";
import { toEditorMarkdown } from "../editor/paths.ts";
import { t } from "../i18n/index.ts";

/** Kod blokları dışındaki `---` satırlarından böler; boş slaytlar atlanır. */
export function splitSlides(md: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let fence: string | null = null;
  for (const line of md.split("\n")) {
    const f = /^(```|~~~)/.exec(line)?.[1];
    if (f) fence = fence === f ? null : (fence ?? f);
    if (!fence && /^-{3,}\s*$/.test(line)) {
      out.push(cur.join("\n"));
      cur = [];
    } else cur.push(line);
  }
  out.push(cur.join("\n"));
  return out.filter((s) => s.trim());
}

export function Slides({ title, body, path, onClose }: { title: string; body: string; path: string; onClose: () => void }) {
  const slides = useMemo(() => splitSlides(body), [body]);
  const [i, setI] = useState(0);
  useEffect(() => {
    void desktop?.setFullScreen(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") (e.preventDefault(), onClose());
      else if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key)) (e.preventDefault(), setI((x) => Math.min(x + 1, slides.length - 1)));
      else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) (e.preventDefault(), setI((x) => Math.max(x - 1, 0)));
    };
    addEventListener("keydown", onKey, true);
    return () => {
      removeEventListener("keydown", onKey, true);
      void desktop?.setFullScreen(false);
    };
  }, [slides.length, onClose]);
  const html = slides.length ? safeHtml(toEditorMarkdown(slides[i], path)) : `<h1>${title.replace(/[<&]/g, "")}</h1>`;
  return (
    <div className="slides" onClick={(e) => (e.clientX > innerWidth / 3 ? setI((x) => Math.min(x + 1, slides.length - 1)) : setI((x) => Math.max(x - 1, 0)))}>
      <div className="slide" dangerouslySetInnerHTML={{ __html: html }} />
      <div className="slides-bar" onClick={(e) => e.stopPropagation()}>
        <span>{title}</span>
        <span className="grow" />
        <span>
          {Math.min(i + 1, Math.max(slides.length, 1))} / {Math.max(slides.length, 1)}
        </span>
        <button className="focus-btn" onClick={onClose} title={t("common.close")}>
          ✕
        </button>
      </div>
    </div>
  );
}
