// Uygulama içi metin sorma penceresi. Electron `window.prompt()` desteklemediği için (her zaman boş döner) metin
// isteyen her yer bunu kullanır. `AskHost` App içinde bir kez çizilir; `askText` sonucu bir Promise ile döndürür.

import { useEffect, useState } from "react";
import { t } from "./i18n/index.ts";

interface AskRequest {
  message: string;
  value: string;
  placeholder?: string;
  resolve: (v: string | null) => void;
}

let show: ((r: AskRequest) => void) | null = null;

/** Kullanıcıdan tek satır metin ister; vazgeçilirse null. */
export function askText(message: string, value = "", placeholder?: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (show) show({ message, value, placeholder, resolve });
    else resolve(window.prompt(message, value));
  });
}

export function AskHost() {
  const [req, setReq] = useState<AskRequest | null>(null);
  const [text, setText] = useState("");
  useEffect(() => {
    show = (r) => {
      setReq((cur) => (cur?.resolve(null), r));
      setText(r.value);
    };
    return () => {
      show = null;
    };
  }, []);
  if (!req) return null;
  const done = (v: string | null) => {
    req.resolve(v);
    setReq(null);
  };
  return (
    <div className="overlay" onMouseDown={() => done(null)}>
      <form className="dialog small-dialog" onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => (e.preventDefault(), done(text))}>
        <label className="field">
          <span>{req.message}</span>
          <input autoFocus value={text} placeholder={req.placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Escape" && (e.preventDefault(), done(null))} onFocus={(e) => e.target.select()} />
        </label>
        <div className="dialog-actions">
          <span className="grow" />
          <button type="button" className="secondary" onClick={() => done(null)}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="primary">
            {t("common.ok")}
          </button>
        </div>
      </form>
    </div>
  );
}
