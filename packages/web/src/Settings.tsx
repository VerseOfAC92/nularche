// Ayarlar: görünüm, Origin klasörü, Claude bağlantısı (MCP kaydı), arşivler, sürüm.

import { useCallback, useEffect, useState } from "react";
import { copyText, desktop, type ClaudeStatus } from "./desktop.ts";
import { getTheme, setTheme, type ThemeChoice } from "./theme.ts";

export function Settings({ onClose, onToast, onChanged }: { onClose: () => void; onToast: (msg: string) => void; onChanged: () => void }) {
  const [info, setInfo] = useState<{ version: string; originDir: string; warning: string | null } | null>(null);
  const [status, setStatus] = useState<ClaudeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [theme, setThemeState] = useState<ThemeChoice>(getTheme);

  const refresh = useCallback(async () => {
    if (!desktop) return;
    setInfo(await desktop.info());
    setStatus(await desktop.claudeStatus());
  }, []);

  useEffect(() => {
    refresh();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [refresh, onClose]);

  async function apply() {
    if (!desktop) return;
    setBusy(true);
    const res = await desktop.claudeApply();
    setBusy(false);
    setResult(res.ok ? `Bağlandı.${res.backup ? ` Yedek: ${res.backup}` : ""} Şimdi Claude Desktop'ı açın.` : `Bağlanamadı: ${res.error}`);
    refresh();
  }

  const plan = status && "status" in status.plan ? status.plan : null;
  const planError = status && "error" in status.plan ? status.plan.error : null;

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>Ayarlar</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Kapat">
            ✕
          </button>
        </header>

        <h3>Görünüm</h3>
        <div className="segmented">
          {(
            [
              ["dark", "Koyu"],
              ["light", "Açık"],
              ["system", "Sistem"],
            ] as const
          ).map(([value, label]) => (
            <button key={value} className={theme === value ? "on" : ""} onClick={() => (setTheme(value), setThemeState(value))}>
              {label}
            </button>
          ))}
        </div>

        <h3>Origin</h3>
        {desktop && info ? (
          <>
            <p className="muted">
              Tüm Node'larınız bu klasörde düz Markdown (.md) dosyaları olarak durur; Time Machine, iCloud ya da git ile yedekleyebilirsiniz.
            </p>
            <code className="path">{info.originDir}</code>
            <div className="row">
              <button className="secondary" onClick={() => desktop!.revealOrigin()}>
                Klasörü göster
              </button>
              <button className="secondary" onClick={async () => (await desktop!.changeOrigin()) && onClose()}>
                Başka Origin aç…
              </button>
            </div>
          </>
        ) : (
          <p className="muted">Tarayıcı sürümünde Origin klasörü sunucunun NULARCHE_ORIGIN ayarıyla belirlenir.</p>
        )}

        {desktop && (
          <>
            <h3>Arşivler</h3>
            <p className="muted">
              <b>.nla</b> (Nularche Archive) tüm Origin'in ya da bir şablon setinin yedeğidir; <b>.nlc</b> (Nularche Container) tek bir Node'u
              ekleriyle birlikte taşır. İçe aktarılanlar Shadow'a gelir.
            </p>
            <div className="row">
              <button
                className="secondary"
                onClick={async () => {
                  const out = await desktop!.exportArchive(null, "nla");
                  if (out) onToast(`Arşiv kaydedildi: ${out}`);
                }}
              >
                Origin'i .nla olarak dışa aktar…
              </button>
              <button
                className="secondary"
                onClick={async () => {
                  const res = await desktop!.importArchive();
                  if (res) {
                    onChanged();
                    onToast(`${res.imported} Node içe aktarıldı (Shadow).`);
                  }
                }}
              >
                .nla / .nlc içe aktar…
              </button>
            </div>
          </>
        )}

        <h3>Claude bağlantısı</h3>
        <p className="muted">
          Nularche AI içermez. Claude Desktop veya Claude Code, “nularche” MCP sunucusu üzerinden Node'larınızı okuyup düzenler; kendi Claude
          aboneliğiniz kullanılır, API anahtarı gerekmez.
        </p>
        {desktop ? (
          <>
            {(info?.warning || status?.warning) && <p className="warn">{info?.warning || status?.warning}</p>}
            <h4>Claude Desktop</h4>
            {planError && <p className="warn">{planError}</p>}
            {plan && plan.status === "unchanged" && <p className="ok">✓ Bağlı. Claude Desktop'ta “nularche” araçları kullanılabilir.</p>}
            {plan && plan.status !== "unchanged" && (
              <>
                <p>
                  {plan.status === "add" ? "Henüz bağlı değil." : "Kayıt bu kurulumla eşleşmiyor (uygulama ya da Origin taşınmış olabilir)."}{" "}
                  Bağlanınca <code>{plan.configPath}</code> dosyasına yalnızca <code>nularche</code> girdisi yazılır
                  {plan.legacyServers.length ? `, eski “${plan.legacyServers.join(", ")}” kaydı kaldırılır` : ""}
                  {plan.otherServers.length ? `; diğer sunucular (${plan.otherServers.join(", ")}) korunur` : ""} ve önce yedek alınır.
                </p>
                {status?.running && (
                  <p className="warn">
                    Claude Desktop açık. Değişiklik kapanışta silineceği için önce Claude Desktop'tan tamamen çıkın (⌘Q), sonra “Yeniden denetle”ye
                    basın.
                  </p>
                )}
                <div className="row">
                  <button className="primary" disabled={busy || !!status?.running} onClick={apply}>
                    {plan.status === "add" ? "Claude Desktop'a bağlan" : "Kaydı güncelle"}
                  </button>
                  <button className="secondary" onClick={refresh}>
                    Yeniden denetle
                  </button>
                </div>
              </>
            )}
            {result && <p className="muted">{result}</p>}
            <h4>Claude Code</h4>
            <p className="muted">Terminalde bir kez çalıştırın:</p>
            <pre className="cmd">{status?.claudeCode}</pre>
            <button className="secondary" onClick={() => status && copyText(status.claudeCode).then(() => onToast("Komut kopyalandı"))}>
              Komutu kopyala
            </button>
          </>
        ) : (
          <p className="muted">
            Kaynak koddan çalıştırırken Claude Desktop'ı kapatıp <code>npm run register:desktop</code> komutunu çalıştırın. Masaüstü uygulamasında bu
            işlem bu ekrandan tek tıkla yapılır.
          </p>
        )}

        <h3>Hakkında</h3>
        <p className="muted">
          Nularche {info?.version ?? ""} · /ˈnʌl.ɑːrk/ · MIT lisansı ·{" "}
          <a href="https://github.com/VerseOfAC92/nularche" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </p>
      </div>
    </div>
  );
}
