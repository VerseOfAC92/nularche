// Ayarlar: görünüm, dil, Origin klasörü, arşivler, yapay zekâ bağlantıları, sürüm.

import { useCallback, useEffect, useState } from "react";
import { AiSetup } from "./ai/AiSetup.tsx";
import { desktop } from "./desktop.ts";
import { getTheme, setTheme, type ThemeChoice } from "./theme.ts";
import { setLang, t, useLang } from "./i18n/index.ts";

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
  const lang = useLang();

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
          <h2>{t("settings.title")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("common.close")}>
            ✕
          </button>
        </header>

        <h3>{t("settings.appearance")}</h3>
        <div className="segmented">
          {(
            [
              ["system", t("settings.themeSystem")],
              ["light", t("settings.themeLight")],
              ["dark", t("settings.themeDark")],
            ] as const
          ).map(([value, label]) => (
            <button key={value} className={theme === value ? "on" : ""} onClick={() => (setTheme(value), setThemeState(value))}>
              {label}
            </button>
          ))}
        </div>

        {theme === "system" && <p className="muted small">{t("settings.themeHint")}</p>}

        <h3>{t("settings.language")}</h3>
        <div className="segmented">
          {(
            [
              ["tr", "Türkçe"],
              ["en", "English"],
            ] as const
          ).map(([value, label]) => (
            <button key={value} className={lang === value ? "on" : ""} onClick={() => (setLang(value), void desktop?.setLanguage(value))}>
              {label}
            </button>
          ))}
        </div>

        <h3>Origin</h3>
        {desktop && info ? (
          <>
            <p className="muted">
              {t("settings.originHint")}
            </p>
            <code className="path">{info.originDir}</code>
            <div className="row">
              <button className="secondary" onClick={() => desktop!.revealOrigin()}>
                {t("settings.revealFolder")}
              </button>
              <button className="secondary" onClick={async () => (await desktop!.changeOrigin()) && onClose()}>
                {t("settings.openOtherOrigin")}
              </button>
            </div>
          </>
        ) : (
          <p className="muted">{t("settings.originBrowser")}</p>
        )}

        {desktop && (
          <>
            <h3>{t("settings.archives")}</h3>
            <p className="muted">
              {t("settings.archivesHint")}
            </p>
            <div className="row">
              <button
                className="secondary"
                onClick={async () => {
                  const out = await desktop!.exportArchive(null, "nla");
                  if (out) onToast(t("settings.archiveSaved", { path: out }));
                }}
              >
                {t("settings.exportNla")}
              </button>
              <button
                className="secondary"
                onClick={async () => {
                  const res = await desktop!.importArchive();
                  if (res) {
                    onChanged();
                    onToast(t("settings.imported", { count: res.imported }));
                  }
                }}
              >
                {t("settings.importArchive")}
              </button>
            </div>
          </>
        )}

        <h3>{t("settings.ai")}</h3>
        <p className="muted">{t("settings.aiIntro")}</p>
        <AiSetup tick={aiTick} onToast={onToast} />

        <h3>{t("settings.about")}</h3>
        <p className="muted">
          Nularche {info?.version ?? ""} · /ˈnʌl.ɑːrk/ · {t("settings.license")} ·{" "}
          <a href="https://github.com/VerseOfAC92/nularche" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </p>
      </div>
    </div>
  );
}
