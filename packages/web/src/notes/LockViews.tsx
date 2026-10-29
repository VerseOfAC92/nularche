// Not kilidi pencereleri: kilitleme (parola + doğrulama + ipucu) ve kilitli notu açma ekranı.

import { useEffect, useRef, useState } from "react";
import { t } from "../i18n/index.ts";

export function LockDialog({ onLock, onClose }: { onLock: (password: string, hint: string) => Promise<void>; onClose: () => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [hint, setHint] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (pw.length < 4) return setError(t("lock.short"));
    if (pw !== pw2) return setError(t("lock.mismatch"));
    setBusy(true);
    try {
      await onLock(pw, hint.trim());
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="overlay" onMouseDown={onClose}>
      <form className="dialog small-dialog" onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => (e.preventDefault(), void submit())} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <header>
          <h2>🔒 {t("lock.title")}</h2>
        </header>
        <p className="muted small">{t("lock.explain")}</p>
        <label className="field">
          <span>{t("lock.password")}</span>
          <input type="password" autoFocus value={pw} onChange={(e) => (setPw(e.target.value), setError(null))} autoComplete="new-password" />
        </label>
        <label className="field">
          <span>{t("lock.confirm")}</span>
          <input type="password" value={pw2} onChange={(e) => (setPw2(e.target.value), setError(null))} autoComplete="new-password" />
        </label>
        <label className="field">
          <span>{t("lock.hint")}</span>
          <input value={hint} onChange={(e) => setHint(e.target.value)} maxLength={120} />
        </label>
        {error && <p className="error-text">{error}</p>}
        <div className="dialog-actions">
          <span className="grow" />
          <button type="button" className="secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {t("lock.do")}
          </button>
        </div>
      </form>
    </div>
  );
}

export function LockScreen({ title, hint, onUnlock }: { title: string; hint?: string; onUnlock: (password: string) => Promise<boolean> }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <form
      className="lock-screen"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const ok = await onUnlock(pw);
        setBusy(false);
        if (!ok) {
          setError(true);
          setPw("");
          ref.current?.focus();
        }
      }}
    >
      <div className="lock-icon">🔒</div>
      <h2>{t("lock.locked")}</h2>
      <p className="muted">{title}</p>
      <p className="muted small">{t("lock.enter")}</p>
      <input ref={ref} type="password" value={pw} placeholder={t("lock.password")} onChange={(e) => (setPw(e.target.value), setError(false))} />
      {error && <p className="error-text">{t("lock.wrong")}</p>}
      {hint && <p className="muted small">{t("lock.showHint", { hint })}</p>}
      <button className="primary" type="submit" disabled={busy || !pw}>
        {busy ? "…" : t("lock.open")}
      </button>
    </form>
  );
}
