// Otomatik mod kurulumu: kullanıcı tarayıcıda Google hesabıyla giriş yapıp ücretsiz bir Gemini API
// anahtarı alır ve bir kez Nularche'ye yapıştırır. Sonrasında Nularche AI istekleri arka planda işlenir.

import { useCallback, useEffect, useState } from "react";
import { desktop } from "../desktop.ts";
import { t } from "../i18n/index.ts";

export const GEMINI_KEY_URL = "https://aistudio.google.com/app/apikey";

export type AutoStatus = { enabled: boolean; hasKey: boolean; model: string | null; encryption: boolean };

/** Otomatik mod ayarı değiştiğinde tüm bileşenlere haber verir. */
const AUTO_EVENT = "nularche:auto-changed";
const announce = () => window.dispatchEvent(new Event(AUTO_EVENT));

export function useAutoStatus(tick = 0): [AutoStatus | null, () => Promise<void>] {
  const [status, setStatus] = useState<AutoStatus | null>(null);
  const refresh = useCallback(async () => {
    if (desktop) setStatus(await desktop.autoStatus());
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh, tick]);
  useEffect(() => {
    const on = () => void refresh();
    window.addEventListener(AUTO_EVENT, on);
    return () => window.removeEventListener(AUTO_EVENT, on);
  }, [refresh]);
  return [status, refresh];
}

export function AutoModeSetup({ onToast, onChanged }: { onToast: (msg: string) => void; onChanged?: () => void }) {
  const [status, refresh] = useAutoStatus();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!desktop || !status) return null;

  async function save() {
    setBusy(true);
    setError(null);
    const res = await desktop!.autoSetKey(key);
    setBusy(false);
    if (res.ok) {
      setKey("");
      onToast(t("auto.ready"));
      await refresh();
      announce();
      onChanged?.();
    } else setError(res.error ?? t("auto.keyInvalid"));
  }

  if (status.hasKey) {
    return (
      <div className="auto-box on">
        <div className="auto-head">
          <span className="ok">✓ {status.enabled ? t("auto.on") : t("auto.off")}</span>
          <span className="pill">Gemini · {status.model}</span>
        </div>
        <p className="muted small">{t("auto.onText")}</p>
        <div className="row" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="secondary"
            onClick={() =>
              desktop!
                .autoEnable(!status.enabled)
                .then(refresh)
                .then(() => (announce(), onChanged?.()))
            }
          >
            {status.enabled ? t("auto.turnOff") : t("auto.turnOn")}
          </button>
          <button
            className="secondary"
            onClick={() =>
              confirm(t("auto.removeConfirm")) &&
              desktop!
                .autoClear()
                .then(refresh)
                .then(() => (announce(), onChanged?.()))
            }
          >
            {t("auto.removeKey")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auto-box">
      <p className="muted small">{t("auto.intro")}</p>
      <div className="ai-row">
        <span className="ai-step-no">a</span>
        <span className="ai-row-name">{t("auto.stepA")}</span>
        <button className="primary" onClick={() => desktop!.aiDownload(GEMINI_KEY_URL)}>
          {t("auto.getKey")}
        </button>
      </div>
      <div className="ai-row">
        <span className="ai-step-no">b</span>
        <input
          className="key-input"
          type="password"
          placeholder={t("auto.keyPlaceholder")}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <button className="primary" disabled={!key.trim() || busy} onClick={save}>
          {busy ? t("auto.verifying") : t("common.save")}
        </button>
      </div>
      {error && <p className="warn small">{error}</p>}
      <p className="muted small">{t("auto.privacy")}</p>
    </div>
  );
}
