// Otomatik mod kurulumu: kullanıcı tarayıcıda Google hesabıyla giriş yapıp ücretsiz bir Gemini API
// anahtarı alır ve bir kez Nularche'ye yapıştırır. Sonrasında Nularche AI istekleri arka planda işlenir.

import { useCallback, useEffect, useState } from "react";
import { desktop } from "../desktop.ts";

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
      onToast("✓ Otomatik mod hazır. Nularche AI istekleri artık arka planda işlenecek.");
      await refresh();
      announce();
      onChanged?.();
    } else setError(res.error ?? "Anahtar doğrulanamadı.");
  }

  if (status.hasKey) {
    return (
      <div className="auto-box on">
        <div className="auto-head">
          <span className="ok">✓ Otomatik mod {status.enabled ? "açık" : "kapalı"}</span>
          <span className="pill">Gemini · {status.model}</span>
        </div>
        <p className="muted small">
          Nularche AI'a yazdığınız istekler arka planda Gemini'ye gider; düzenleme uygulanır ve cevap aynı pencerede görünür. Kopyalama ya da
          yapıştırma gerekmez.
        </p>
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
            {status.enabled ? "Otomatik modu kapat" : "Otomatik modu aç"}
          </button>
          <button
            className="secondary"
            onClick={() =>
              confirm("Gemini anahtarı silinsin mi?") &&
              desktop!
                .autoClear()
                .then(refresh)
                .then(() => (announce(), onChanged?.()))
            }
          >
            Anahtarı kaldır
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auto-box">
      <p className="muted small">
        Tamamen otomatik çalışma için Google'ın <b>ücretsiz</b> Gemini anahtarını kullanın: kredi kartı gerekmez, Gemini/Google üyeliğinizden
        bağımsızdır ve günlük bir ücretsiz kotası vardır.
      </p>
      <div className="ai-row">
        <span className="ai-step-no">a</span>
        <span className="ai-row-name">Tarayıcıda Google hesabınızla giriş yapın ve “API anahtarı oluştur”a basın</span>
        <button className="primary" onClick={() => desktop!.aiDownload(GEMINI_KEY_URL)}>
          Anahtar al
        </button>
      </div>
      <div className="ai-row">
        <span className="ai-step-no">b</span>
        <input
          className="key-input"
          type="password"
          placeholder="Anahtarı buraya yapıştırın (AIza…)"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <button className="primary" disabled={!key.trim() || busy} onClick={save}>
          {busy ? "Doğrulanıyor…" : "Kaydet"}
        </button>
      </div>
      {error && <p className="warn small">{error}</p>}
      <p className="muted small">
        Anahtar bu Mac'te şifreli saklanır ve yalnızca Google'a gönderilir. Not: Google'ın ücretsiz katmanında gönderilen içerik ürün geliştirmede
        kullanılabilir; çok gizli notlar için bunu göz önünde bulundurun.
      </p>
    </div>
  );
}
