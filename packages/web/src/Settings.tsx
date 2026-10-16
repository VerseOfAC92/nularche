// Ayarlar: görünüm, Origin klasörü, Claude bağlantısı (MCP kaydı), arşivler, sürüm.

import { useCallback, useEffect, useState } from "react";
import { AiSetup } from "./ai/AiSetup.tsx";
import { desktop } from "./desktop.ts";
import { getTheme, setTheme, type ThemeChoice } from "./theme.ts";

export function Settings({
  onClose,
  onToast,
  onChanged,
  aiTick,
}: {
  onClose: () => void;
  onToast: (msg: string) => void;
  onChanged: () => void;
  aiTick: number;
}) {
  const [info, setInfo] = useState<{ version: string; originDir: string; warning: string | null } | null>(null);
  const [theme, setThemeState] = useState<ThemeChoice>(getTheme);

  const refresh = useCallback(async () => {
    if (!desktop) return;
    setInfo(await desktop.info());
  }, []);

  useEffect(() => {
    refresh();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [refresh, onClose]);

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

        <h3>Yapay zekâ</h3>
        <p className="muted">
          Nularche'nin içinde yapay zekâ yoktur. Seçtiğiniz yapay zekânın resmi uygulamasına kendi hesabınızla giriş yaparsınız; Nularche o uygulamaya
          “nularche” bağlantısını (MCP) kurar ve isteklerinizi sağ alttaki <b>Nularche AI</b> penceresinden iletirsiniz.
        </p>
        <AiSetup tick={aiTick} onToast={onToast} />

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
