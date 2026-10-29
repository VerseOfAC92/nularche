// Obsidian'dan gelen ayarlar: düzenleyici (varsayılan görünüm, özellikler, okunabilir satır uzunluğu), dosyalar
// (yeni not yeri, hariç tutulanlar), görünüm (vurgu rengi, CSS parçacıkları) ve kısayol düzenleyici.

import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { ALL_COMMANDS, comboOf, type CommandSpec } from "../commands.ts";
import { t } from "../i18n/index.ts";
import { usePref } from "../prefs.ts";
import { keys } from "../shortcuts.tsx";

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map(([v, label]) => (
        <button key={v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function VaultSettings() {
  const [defaultView, setDefaultView] = usePref<"edit" | "read">("defaultView", "edit");
  const [propsInDoc, setPropsInDoc] = usePref<"visible" | "hidden">("propertiesInDoc", "visible");
  const [readable, setReadable] = usePref<boolean>("readableLineLength", false);
  const [location, setLocation] = usePref<"shadow" | "current">("newNoteLocation", "shadow");
  const [startup, setStartup] = usePref<"last" | "daily" | "home">("startupView", "last");
  const [autoPair, setAutoPair] = usePref<boolean>("autoPair", false);
  const [excluded, setExcluded] = usePref<string[]>("excludedFiles", []);
  const [accent, setAccent] = usePref<string>("accentColor", "");
  const [enabled, setEnabled] = usePref<string[]>("enabledSnippets", []);
  const [snippets, setSnippets] = useState<{ name: string }[]>([]);
  const [draft, setDraft] = useState(excluded.join("\n"));
  const loadSnippets = () => api.snippets().then(setSnippets, () => setSnippets([]));
  useEffect(() => void loadSnippets(), []);

  return (
    <>
      <h3>{t("ob.setEditor")}</h3>
      <p className="muted small">{t("ob.setDefaultView")}</p>
      <Segmented value={defaultView} onChange={setDefaultView} options={[["edit", t("ob.editView")], ["read", t("ob.readingView")]]} />
      <p className="muted small">{t("ob.setProperties")}</p>
      <Segmented value={propsInDoc} onChange={setPropsInDoc} options={[["visible", t("ob.visible")], ["hidden", t("ob.hidden")]]} />
      <label className="check">
        <input type="checkbox" checked={readable} onChange={(e) => setReadable(e.target.checked)} /> {t("ob.setReadable")}
      </label>
      <label className="check">
        <input type="checkbox" checked={autoPair} onChange={(e) => setAutoPair(e.target.checked)} /> {t("ob.setAutoPair")}
      </label>

      <h3>{t("ob.setFiles")}</h3>
      <p className="muted small">{t("ob.setStartup")}</p>
      <Segmented value={startup} onChange={setStartup} options={[["last", t("ob.startupLast")], ["daily", t("ob.startupDaily")], ["home", t("ob.startupHome")]]} />
      <p className="muted small">{t("ob.setNewNote")}</p>
      <Segmented value={location} onChange={setLocation} options={[["shadow", "Shadow"], ["current", t("ob.besideCurrent")]]} />
      <label className="field">
        <span>{t("ob.setExcluded")}</span>
        <textarea rows={3} value={draft} placeholder={"Arşiv/\n/taslak-.*/"} onChange={(e) => setDraft(e.target.value)} onBlur={() => setExcluded(draft.split("\n").map((x) => x.trim()).filter(Boolean))} />
      </label>

      <h3>{t("ob.setLook")}</h3>
      <div className="row">
        <label className="check">
          {t("ob.accent")} <input type="color" value={accent || "#00a8b5"} onChange={(e) => setAccent(e.target.value)} />
        </label>
        {accent && (
          <button className="secondary" onClick={() => setAccent("")}>
            {t("ob.reset")}
          </button>
        )}
      </div>
      <p className="muted small">{t("ob.snippetsHint")}</p>
      {snippets.length ? (
        snippets.map((sn) => (
          <label key={sn.name} className="check">
            <input type="checkbox" checked={enabled.includes(sn.name)} onChange={(e) => setEnabled(e.target.checked ? [...enabled, sn.name] : enabled.filter((x) => x !== sn.name))} /> {sn.name}.css
          </label>
        ))
      ) : (
        <p className="muted small">{t("ob.noSnippets")}</p>
      )}
      <div className="row">
        <button className="secondary" onClick={() => void loadSnippets()}>
          ↻ {t("ob.reloadSnippets")}
        </button>
      </div>
    </>
  );
}

/** Kısayol düzenleyici (Obsidian "Hotkeys"): her komuta kendi kısayolunu atayın; çakışmalar gösterilir. */
export function HotkeyEditor() {
  const [hotkeys, setHotkeys] = usePref<Record<string, string>>("hotkeys", {});
  const [filter, setFilter] = useState("");
  const [recording, setRecording] = useState<string | null>(null);
  const seen = new Set<string>();
  const cmds = ALL_COMMANDS.filter((c) => !seen.has(c.id) && seen.add(c.id));
  const comboOfCmd = (c: CommandSpec) => (c.id in hotkeys ? hotkeys[c.id] || undefined : c.combo);
  const counts = new Map<string, number>();
  for (const c of cmds) {
    const k = comboOfCmd(c);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setRecording(null);
      if (["Meta", "Control", "Alt", "Shift"].includes(e.key)) return;
      const combo = e.key === "Backspace" && !e.metaKey && !e.ctrlKey && !e.altKey ? "" : comboOf(e);
      setHotkeys({ ...hotkeys, [recording]: combo });
      setRecording(null);
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [recording, hotkeys, setHotkeys]);

  const q = filter.toLocaleLowerCase("tr");
  return (
    <div className="hotkeys">
      <input className="hotkey-filter" placeholder={t("ob.hotkeyFilter")} value={filter} onChange={(e) => setFilter(e.target.value)} />
      <p className="muted small">{t("ob.hotkeyHint")}</p>
      <div className="hotkey-list">
        {cmds
          .filter((c) => !q || t(c.label).toLocaleLowerCase("tr").includes(q))
          .map((c) => {
            const combo = comboOfCmd(c);
            const conflict = combo && (counts.get(combo) ?? 0) > 1;
            return (
              <div key={c.id} className={`hotkey-row ${conflict ? "conflict" : ""}`}>
                <span className="grow">{t(c.label)}</span>
                <button className={`secondary hotkey-key ${recording === c.id ? "on" : ""}`} onClick={() => setRecording(c.id)} title={conflict ? t("ob.hotkeyConflict") : undefined}>
                  {recording === c.id ? t("ob.pressKeys") : combo ? keys(combo) : "—"}
                </button>
                {c.id in hotkeys && (
                  <button
                    className="icon-btn"
                    title={t("ob.reset")}
                    onClick={() => {
                      const next = { ...hotkeys };
                      delete next[c.id];
                      setHotkeys(next);
                    }}
                  >
                    ↺
                  </button>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
