// Ayarlar: solda kategoriler (arama ile süzülür), sağda seçili kategorinin ayarları kartlar halinde.
// Görünüm, Yazma, Aura ve Odak, Otomasyon, Notlar ve Origin, Kısayollar, Yayınlama, Takvim, Yapay zekâ, Hakkında.
// Son açılan kategori hatırlanır.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AiSetup } from "./ai/AiSetup.tsx";
import { CalendarAccounts } from "./calendar/CalendarSync.tsx";
import { desktop } from "./desktop.ts";
import { getTheme, setTheme, type ThemeChoice } from "./theme.ts";
import { setLang, t, useLang, type StringKey } from "./i18n/index.ts";
import { exportNode } from "./exporting.ts";
import { keys } from "./shortcuts.tsx";
import { api } from "./api.ts";
import { usePref } from "./prefs.ts";
import { BackgroundPicker } from "./focus/BackgroundPicker.tsx";
import { HotkeyEditor, VaultSettings } from "./vault/VaultSettings.tsx";
import type { MathMode } from "./editor/notes-extensions.ts";
import type { NodeMeta } from "./api.ts";
import { StudioSettings } from "./studio/StudioSettings.tsx";
import { runCommand } from "./commands.ts";

type CategoryId = "appearance" | "writing" | "aura" | "automation" | "origin" | "keys" | "publish" | "calendar" | "ai" | "about";

interface Category {
  id: CategoryId;
  icon: string;
  label: StringKey;
  hint: StringKey;
  /** Aramada eşleşecek ek sözcükler (her iki dilde). */
  keywords: string;
}

const CATEGORIES: Category[] = [
  { id: "appearance", icon: "🎨", label: "settings.catAppearance", hint: "settings.catAppearanceHint", keywords: "tema theme dil language kontrast contrast renk accent css snippet görünüm" },
  { id: "writing", icon: "✍️", label: "settings.catWriting", hint: "settings.catWritingHint", keywords: "yazım spell kelime word hedef goal font yazı tipi matematik math düzenleyici editor okuma reading lore" },
  { id: "aura", icon: "♪", label: "settings.catAura", hint: "settings.catAuraHint", keywords: "aura ses sound daktilo typewriter ortam ambience clepsydra zamanlayıcı timer odak focus arka plan background manzara" },
  { id: "automation", icon: "⚡", label: "settings.catAutomation", hint: "settings.catAutomationHint", keywords: "sigil kısaltma shortcut rite komut command conduit yakalama capture" },
  { id: "origin", icon: "🗄", label: "settings.catOrigin", hint: "settings.catOriginHint", keywords: "origin klasör folder içe aktar import arşiv archive nla yedek backup ark dosya file açılış startup hariç excluded" },
  { id: "keys", icon: "⌨", label: "settings.catKeys", hint: "settings.catKeysHint", keywords: "kısayol shortcut hotkey klavye keyboard" },
  { id: "publish", icon: "🌐", label: "settings.catPublish", hint: "settings.catPublishHint", keywords: "yayınla publish site web" },
  { id: "calendar", icon: "🗓", label: "settings.catCalendar", hint: "settings.catCalendarHint", keywords: "takvim calendar google apple icloud" },
  { id: "ai", icon: "✦", label: "settings.catAi", hint: "settings.catAiHint", keywords: "ai yapay zekâ claude chatgpt gemini mcp" },
  { id: "about", icon: "ⓘ", label: "settings.catAbout", hint: "settings.catAboutHint", keywords: "hakkında about sürüm version lisans license sözlük glossary" },
];

/** Bir kategori içindeki başlıklı kart. */
function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="settings-card">
      <h4>{title}</h4>
      {hint && <p className="muted small">{hint}</p>}
      {children}
    </section>
  );
}

export function Settings({
  nodes,
  onClose,
  onToast,
  onChanged,
  aiTick,
  onShortcuts,
  onImport,
}: {
  nodes: NodeMeta[];
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
  const [saved, setSaved] = usePref<CategoryId>("settingsTab", "appearance");
  const [query, setQuery] = useState("");
  const tab: CategoryId = CATEGORIES.some((c) => c.id === saved) ? saved : "appearance";

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

  const q = query.trim().toLocaleLowerCase("tr");
  const visible = useMemo(
    () => (q ? CATEGORIES.filter((c) => `${t(c.label)} ${t(c.hint)} ${c.keywords}`.toLocaleLowerCase("tr").includes(q)) : CATEGORIES),
    [q, lang], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const current = CATEGORIES.find((c) => c.id === tab)!;

  const segmented = <T extends string>(value: T, options: [T, string][], onChange: (v: T) => void) => (
    <div className="segmented">
      {options.map(([v, label]) => (
        <button key={v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );

  const content: Record<CategoryId, () => ReactNode> = {
    appearance: () => (
      <>
        <Card title={t("settings.theme")} hint={theme === "system" ? t("settings.themeHint") : undefined}>
          {segmented<ThemeChoice>(
            theme,
            [
              ["system", t("settings.themeSystem")],
              ["light", t("settings.themeLight")],
              ["dark", t("settings.themeDark")],
            ],
            (v) => (setTheme(v), setThemeState(v)),
          )}
          <StudioSettings part="contrast" nodes={nodes} onToast={onToast} />
        </Card>
        <Card title={t("settings.language")}>
          {segmented<"tr" | "en">(
            lang,
            [
              ["tr", "Türkçe"],
              ["en", "English"],
            ],
            (v) => (setLang(v), void desktop?.setLanguage(v)),
          )}
        </Card>
        <Card title={t("ob.setLook")}>
          <VaultSettings part="look" />
        </Card>
      </>
    ),
    writing: () => (
      <>
        <Card title={t("settings.writing")}>
          <label className="check">
            <input type="checkbox" checked={spellcheck} onChange={(e) => setSpellcheck(e.target.checked)} /> {t("settings.spellcheck")}
          </label>
          <label className="check">
            <input type="checkbox" checked={wordCount} onChange={(e) => setWordCount(e.target.checked)} /> {t("settings.wordCount")}
          </label>
        </Card>
        <Card title={t("settings.goalsAndFonts")}>
          <StudioSettings part="goals" nodes={nodes} onToast={onToast} />
        </Card>
        <Card title={t("ob.setEditor")}>
          <VaultSettings part="editor" />
        </Card>
        <Card title={t("settings.mathTitle")} hint={t("settings.mathHint")}>
          {segmented<MathMode>(
            mathMode,
            [
              ["off", t("settings.mathOff")],
              ["suggest", t("settings.mathSuggest")],
              ["insert", t("settings.mathInsert")],
            ],
            setMathMode,
          )}
        </Card>
      </>
    ),
    aura: () => (
      <>
        <Card title="Aura" hint={t("gloss.aura")}>
          <StudioSettings part="sound" nodes={nodes} onToast={onToast} />
        </Card>
        <Card title="Clepsydra" hint={t("gloss.clepsydra")}>
          <StudioSettings part="timer" nodes={nodes} onToast={onToast} />
        </Card>
        <Card title={t("focus.background")}>
          <BackgroundPicker />
        </Card>
      </>
    ),
    automation: () => (
      <>
        <Card title={t("ws.textShortcuts")} hint={t("gloss.sigil")}>
          <StudioSettings part="shortcuts" nodes={nodes} onToast={onToast} />
        </Card>
        <Card title={t("ws.customCommands")} hint={t("gloss.rite")}>
          <StudioSettings part="commands" nodes={nodes} onToast={onToast} />
        </Card>
        <Card title={t("ws.captureTitle")} hint={t("gloss.conduit")}>
          <StudioSettings part="capture" nodes={nodes} onToast={onToast} />
        </Card>
      </>
    ),
    origin: () => (
      <>
        <Card title="Origin" hint={desktop && info ? t("settings.originHint") : t("settings.originBrowser")}>
          {desktop && info && (
            <>
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
          )}
        </Card>
        <Card title={t("ob.setFiles")}>
          <VaultSettings part="files" />
        </Card>
        <Card title={t("ws.backupTitle")} hint={t("gloss.ark")}>
          <StudioSettings part="backup" nodes={nodes} onToast={onToast} />
        </Card>
        {desktop && (
          <Card title={t("settings.archives")} hint={t("settings.archivesHint")}>
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
          </Card>
        )}
        <Card title={t("settings.import")} hint={t("settings.importHint")}>
          <div className="row">
            <button className="secondary" onClick={() => (onClose(), onImport(false))}>
              {t("settings.importFiles")}
            </button>
            <button className="secondary" onClick={() => (onClose(), onImport(true))}>
              {t("settings.importFolder")}
            </button>
          </div>
        </Card>
      </>
    ),
    keys: () => (
      <Card title={t("keys.title")} hint={t("keys.settingsHint", { key: keys("Mod+/") })}>
        <div className="row">
          <button className="secondary" onClick={onShortcuts}>
            ⌨ {t("keys.show")}
          </button>
        </div>
        <HotkeyEditor />
      </Card>
    ),
    publish: () => (
      <Card title={t("export.publishTitle")} hint={t("export.publishHint", { count: published ?? 0 })}>
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
      </Card>
    ),
    calendar: () => (
      <Card title={t("cal.title")}>
        <CalendarAccounts onToast={onToast} titleOf={(id) => titles.get(id)} />
      </Card>
    ),
    ai: () => (
      <Card title={t("settings.ai")} hint={t("settings.aiIntro")}>
        <AiSetup tick={aiTick} onToast={onToast} />
      </Card>
    ),
    about: () => (
      <>
        <Card title="Nularche">
          <p className="muted">
            Nularche {info?.version ?? ""} · /ˈnʌl.ɑːrk/ · {t("settings.license")} ·{" "}
            <a href="https://github.com/VerseOfAC92/nularche" target="_blank" rel="noreferrer">
              GitHub
            </a>
          </p>
        </Card>
        <Card title={t("gloss.title")} hint={t("gloss.intro")}>
          <div className="row">
            <button className="secondary" onClick={() => (onClose(), runCommand("help.glossary"))}>
              ⓘ {t("gloss.open")}
            </button>
          </div>
        </Card>
      </>
    ),
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog settings-dialog" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={t("settings.title")}>
        <nav className="settings-nav" aria-label={t("settings.title")}>
          <h2>{t("settings.title")}</h2>
          <input className="settings-search" type="search" placeholder={t("settings.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="settings-tabs" role="tablist">
            {visible.map((c) => (
              <button key={c.id} role="tab" aria-selected={tab === c.id} className={tab === c.id ? "on" : ""} onClick={() => setSaved(c.id)}>
                <span className="settings-tab-icon" aria-hidden>
                  {c.icon}
                </span>
                {t(c.label)}
              </button>
            ))}
            {!visible.length && <p className="muted small">{t("settings.noMatch")}</p>}
          </div>
        </nav>
        <div className="settings-main">
          <header>
            <div>
              <h3>
                {current.icon} {t(current.label)}
              </h3>
              <p className="muted small">{t(current.hint)}</p>
            </div>
            <button className="icon-btn" onClick={onClose} aria-label={t("common.close")}>
              ✕
            </button>
          </header>
          <div className="settings-body" key={tab}>
            {content[tab]()}
          </div>
        </div>
      </div>
    </div>
  );
}
