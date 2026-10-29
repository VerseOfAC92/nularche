// Bağlantı penceresi (⌘L): bağlantı metni ve adresi; http, https ve mailto adresleri kabul edilir, şema yoksa https:// eklenir.

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { t } from "../i18n/index.ts";
import { keys } from "../shortcuts.tsx";

/** Kullanıcının yazdığı adresi doğrular ve tamamlar; geçersizse null. */
export function normalizeUrl(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(s)) s = `mailto:${s}`;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol === "mailto:") return /@/.test(u.pathname) ? s : null;
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return /\./.test(u.hostname) || u.hostname === "localhost" ? s : null;
  } catch {
    return null;
  }
}

export function LinkDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const existing = editor.getAttributes("link").href as string | undefined;
  const isFileLink = existing?.startsWith("/files/");
  const [text, setText] = useState(() => {
    if (existing) editor.chain().extendMarkRange("link").run();
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to, " ");
  });
  const [url, setUrl] = useState(existing && !isFileLink ? existing : "");
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLInputElement>(null);
  const ref = useRef<HTMLInputElement>(null);
  // Seçili metin yoksa önce bağlantı metni, varsa doğrudan adres yazılır.
  useEffect(() => {
    (text ? ref.current : textRef.current)?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    const href = isFileLink && !url ? existing! : normalizeUrl(url);
    if (!href) return setError(t("link.invalid"));
    const label = text.trim() || url.trim();
    const { from, to } = editor.state.selection;
    const current = editor.state.doc.textBetween(from, to, " ");
    const chain = editor.chain().focus();
    if (label !== current) chain.insertContentAt({ from, to }, { type: "text", text: label, marks: [{ type: "link", attrs: { href } }] });
    else chain.extendMarkRange("link").setLink({ href });
    chain.run();
    onClose();
  };

  const remove = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    onClose();
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <form
        className="dialog small-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => (e.preventDefault(), save())}
        onKeyDown={(e) => e.key === "Escape" && (e.preventDefault(), onClose())}
      >
        <header>
          <h2>{t("link.title")}</h2>
        </header>
        <label className="field">
          <span>{t("link.text")}</span>
          <input ref={textRef} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <label className="field">
          <span>{t("link.url")}</span>
          <input ref={ref} value={url} placeholder={isFileLink ? existing : t("link.placeholder")} onChange={(e) => (setUrl(e.target.value), setError(null))} />
        </label>
        {error ? <p className="error-text">{error}</p> : <p className="muted small">{t("link.hint", { key: keys("Mod") })}</p>}
        <div className="dialog-actions">
          {existing && (
            <button type="button" className="secondary danger" onClick={remove}>
              {t("link.remove")}
            </button>
          )}
          <span className="grow" />
          <button type="button" className="secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="primary">
            {t("link.save")}
          </button>
        </div>
      </form>
    </div>
  );
}
