// Ayarlar: görünüm, dil, Origin klasörü, arşivler, yapay zekâ bağlantıları, sürüm.

import { useCallback, useEffect, useState } from "react";
import { AiSetup } from "./ai/AiSetup.tsx";
import { CalendarAccounts } from "./calendar/CalendarSync.tsx";
import { desktop } from "./desktop.ts";
import { getTheme, setTheme, type ThemeChoice } from "./theme.ts";
import { setLang, t, useLang } from "./i18n/index.ts";
import { exportNode } from "./exporting.ts";
import { keys } from "./shortcuts.tsx";
import { api } from "./api.ts";
import { usePref } from "./prefs.ts";
import { BackgroundPicker } from "./focus/BackgroundPicker.tsx";
import { HotkeyEditor, VaultSettings } from "./vault/VaultSettings.tsx";
import type { MathMode } from "./editor/notes-extensions.ts";

export function Settings({
  onClose,
  onToast,
  onChanged,
  aiTick,
  onShortcuts,
  onImport,
}: {
  onImport: (folder: boolean) => void;
  onShortcuts: () => void;
  onClose: () => void;
  onToast: (msg: string) => void;
  onChanged: () => void;
  aiTick: number;
}) {
  const [info, setInfo] = useState<{ version: string; originDir: string; warning: string | null } | null>(null);
  const [theme, setThemeState] = useState<ThemeChoice>(getTheme);
  const lang = useLang();
  const [published, setPublished] = useState<number | null>(null);
  const [titles, setTitles] = useState<Map<string, string>>(new Map());
  const [mathMode, setMathMode] = usePref<MathMode>("mathMode", "suggest");
  const [spellcheck, setSpellcheck] = usePref<boolean>("spellcheck", true);
  const [wordCount, setWordCount] = usePref<boolean>("wordCount", true);
  useEffect(() => {
    api.list().then(
      (ns) => (setPublished(ns.filter((n) => n.publish && !n.template).length), setTitles(new Map(ns.map((n) => [n.id, n.title])))),
      () => setPublished(0),
    );
  }, []);

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

        <h3>{t("settings.writing")}</h3>
        <p className="muted small">{t("settings.mathHint")}</p>
        <div className="segmented">
          {(
            [
              ["off", t("settings.mathOff")],
              ["suggest", t("settings.mathSuggest")],
              ["insert", t("settings.mathInsert")],
            ] as const
          ).map(([value, label]) => (
            <button key={value} className={mathMode === value ? "on" : ""} onClick={() => setMathMode(value)}>
              {label}
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={spellcheck} onChange={(e) => setSpellcheck(e.target.checked)} /> {t("settings.spellcheck")}
        </label>
        <label className="check">
          <input type="checkbox" checked={wordCount} onChange={(e) => setWordCount(e.target.checked)} /> {t("settings.wordCount")}
        </label>

        <VaultSettings />

        <h3>{t("focus.background")}</h3>
        <BackgroundPicker />

        <h3>{t("settings.import")}</h3>
        <p className="muted small">{t("settings.importHint")}</p>
        <div className="row">
          <button className="secondary" onClick={() => (onClose(), onImport(false))}>
            {t("settings.importFiles")}
          </button>
          <button className="secondary" onClick={() => (onClose(), onImport(true))}>
            {t("settings.importFolder")}
          </button>
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

        <h3>{t("keys.title")}</h3>
        <p className="muted">{t("keys.settingsHint", { key: keys("Mod+/") })}</p>
        <div className="row">
          <button className="secondary" onClick={onShortcuts}>
            ⌨ {t("keys.show")}
          </button>
        </div>
        <HotkeyEditor />

        <h3>{t("export.publishTitle")}</h3>
        <p className="muted">{t("export.publishHint", { count: published ?? 0 })}</p>
        <div className="row">
          <button
            className="secondary"
            disabled={!published}
            onClick={async () => {
              try {
                const out = await exportNode("site", null);
                if (out) onToast(out === "downloaded" ? t("export.downloaded") : t("export.siteSaved", { path: out }));
              } catch (e) {
                onToast((e as Error).message);
              }
            }}
          >
            🌐 {desktop ? t("export.createSite") : t("export.downloadSite")}
          </button>
        </div>

        <h3>{t("cal.title")}</h3>
        <CalendarAccounts onToast={onToast} titleOf={(id) => titles.get(id)} />

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
