// Ayarlar → Yazma stüdyosu (2.0): hedefler, yazı tipi, yüksek kontrast, wiki anma tespiti, daktilo ve ortam sesleri,
// zamanlayıcı, metin kısaltmaları, özel komutlar, akıllı yakalama kuralları ve otomatik yedekleme.

import { useEffect, useState } from "react";
import { api, type CaptureConfig, type CaptureKind, type NodeMeta } from "../api.ts";
import { desktop, type BackupStatus } from "../desktop.ts";
import { t } from "../i18n/index.ts";
import { usePref } from "../prefs.ts";
import { BUNDLED_FONTS } from "./fonts.ts";
import { AMBIENCES, bell, setAmbience, typeSound, type Ambience, type TypeProfile } from "./sounds.ts";
import type { TextShortcut } from "./editor-plugins.ts";

export interface CustomCommand {
  id: string;
  name: string;
  action: "insert" | "open" | "capture" | "run";
  value: string;
}

const CAPTURE_KINDS: CaptureKind[] = ["card", "outline", "wiki", "task"];

export type StudioPart = "goals" | "contrast" | "sound" | "timer" | "shortcuts" | "commands" | "capture" | "backup";

/** Yazma stüdyosu ayarları; Ayarlar penceresi her kategoride yalnızca istenen parçayı gösterir. */
export function StudioSettings({ nodes, onToast, part }: { nodes: NodeMeta[]; onToast: (msg: string) => void; part: StudioPart }) {
  const [dailyGoal, setDailyGoal] = usePref<number>("dailyGoal", 0);
  const [writingFont, setWritingFont] = usePref<string>("writingFont", "");
  const [contrast, setContrast] = usePref<boolean>("highContrast", false);
  const [mentions, setMentions] = usePref<boolean>("wikiMentions", true);
  const [typeOn, setTypeOn] = usePref<boolean>("typeSounds", false);
  const [typeVol, setTypeVol] = usePref<number>("typeVolume", 0.5);
  const [profile, setProfile] = usePref<TypeProfile>("typeProfile", "light");
  const [bellOn, setBellOn] = usePref<boolean>("typeBell", true);
  const [margin, setMargin] = usePref<number>("typeMargin", 72);
  const [ambience, setAmb] = usePref<Ambience>("ambience", "off");
  const [ambLevel, setAmbLevel] = usePref<number>("ambienceLevel", 0.5);
  const [focusMin, setFocusMin] = usePref<number>("timerFocus", 25);
  const [breakMin, setBreakMin] = usePref<number>("timerBreak", 5);
  const [timerSound, setTimerSound] = usePref<boolean>("timerSound", true);
  const [shortcuts, setShortcuts] = usePref<TextShortcut[]>("textShortcuts", []);
  const [commands, setCommands] = usePref<CustomCommand[]>("customCommands", []);

  const num = (v: string, min: number, max: number, fallback: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };

  const exportFile = () => {
    const blob = new Blob([JSON.stringify({ format: "nularche-shortcuts", version: 1, textShortcuts: shortcuts, customCommands: commands }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "nularche-shortcuts.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const importFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      try {
        const data = JSON.parse(await input.files![0].text()) as { textShortcuts?: unknown; customCommands?: unknown };
        const ts = (Array.isArray(data.textShortcuts) ? data.textShortcuts : []).filter((x): x is TextShortcut => !!x && typeof x.abbr === "string" && typeof x.text === "string");
        const cc = (Array.isArray(data.customCommands) ? data.customCommands : []).filter(
          (x): x is CustomCommand => !!x && typeof x.id === "string" && typeof x.name === "string" && ["insert", "open", "capture", "run"].includes(x.action) && typeof x.value === "string",
        );
        const byAbbr = new Map([...shortcuts, ...ts].map((s) => [s.abbr, s]));
        const byId = new Map([...commands, ...cc].map((c) => [c.id, c]));
        setShortcuts([...byAbbr.values()]);
        setCommands([...byId.values()]);
        onToast(t("ws.imported", { a: ts.length, b: cc.length }));
      } catch {
        onToast(t("ws.importFailed"));
      }
    };
    input.click();
  };

  if (part === "goals")
    return (
      <>
      <label className="field inline">
        <span>{t("ws.dailyGoal")}</span>
        <input type="number" min={0} max={100000} step={50} value={dailyGoal || ""} placeholder={t("ws.off")} onChange={(e) => setDailyGoal(num(e.target.value, 0, 100000, 0))} />
      </label>
      <label className="field inline">
        <span>{t("ws.writingFont")}</span>
        <select value={writingFont} onChange={(e) => setWritingFont(e.target.value)}>
          <option value="">{t("font.default")}</option>
          {BUNDLED_FONTS.map((f) => (
            <option key={f.family} value={f.family} style={{ fontFamily: f.family }}>
              {f.family} — {t(`ws.font.${f.note}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={mentions} onChange={(e) => setMentions(e.target.checked)} /> {t("ws.wikiMentionsSetting")}
      </label>

      </>
    );
  if (part === "contrast") return <label className="check">
        <input type="checkbox" checked={contrast} onChange={(e) => setContrast(e.target.checked)} /> {t("ws.highContrastLabel")}
      </label>;
  if (part === "sound")
    return (
      <>
      <p className="muted small">{t("ws.soundHint")}</p>
      <label className="check">
        <input type="checkbox" checked={typeOn} onChange={(e) => setTypeOn(e.target.checked)} /> {t("ws.typeSounds")}
      </label>
      {typeOn && (
        <div className="indent">
          <div className="segmented small">
            {(["light", "heavy"] as const).map((p) => (
              <button key={p} className={profile === p ? "on" : ""} onClick={() => (setProfile(p), typeSound("key", typeVol, p))}>
                {t(p === "light" ? "ws.portable" : "ws.desk")}
              </button>
            ))}
          </div>
          <label className="field inline">
            <span>{t("ws.volume")}</span>
            <input type="range" min={0} max={1} step={0.05} value={typeVol} onChange={(e) => setTypeVol(Number(e.target.value))} onPointerUp={() => typeSound("key", typeVol, profile)} />
          </label>
          <label className="check">
            <input type="checkbox" checked={bellOn} onChange={(e) => (setBellOn(e.target.checked), e.target.checked && bell(typeVol))} /> {t("ws.marginBell")}
          </label>
          {bellOn && (
            <label className="field inline">
              <span>{t("ws.marginColumn")}</span>
              <input type="number" min={20} max={200} value={margin} onChange={(e) => setMargin(num(e.target.value, 20, 200, 72))} />
            </label>
          )}
        </div>
      )}
      <label className="field inline">
        <span>{t("ws.ambience")}</span>
        <select value={ambience} onChange={(e) => setAmb(e.target.value as Ambience)}>
          {AMBIENCES.map((a) => (
            <option key={a} value={a}>
              {t(`ws.amb.${a}`)}
            </option>
          ))}
        </select>
      </label>
      {ambience !== "off" && (
        <label className="field inline">
          <span>{t("ws.ambienceLevel")}</span>
          <input type="range" min={0} max={1} step={0.05} value={ambLevel} onChange={(e) => (setAmbLevel(Number(e.target.value)), setAmbience(ambience, Number(e.target.value)))} />
        </label>
      )}

      </>
    );
  if (part === "timer")
    return (
      <>
      <div className="row">
        <label className="field inline">
          <span>{t("ws.timerFocus")}</span>
          <input type="number" min={1} max={180} value={focusMin} onChange={(e) => setFocusMin(num(e.target.value, 1, 180, 25))} /> {t("ws.min")}
        </label>
        <label className="field inline">
          <span>{t("ws.timerBreak")}</span>
          <input type="number" min={1} max={60} value={breakMin} onChange={(e) => setBreakMin(num(e.target.value, 1, 60, 5))} /> {t("ws.min")}
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={timerSound} onChange={(e) => setTimerSound(e.target.checked)} /> {t("ws.timerSound")}
      </label>

      </>
    );
  if (part === "shortcuts")
    return (
      <>
      <p className="muted small">{t("ws.textShortcutsHint")}</p>
      <table className="kv-table">
        <tbody>
          {shortcuts.map((s, i) => (
            <tr key={i}>
              <td>
                <input value={s.abbr} placeholder=";imza" onChange={(e) => setShortcuts(shortcuts.map((x, j) => (j === i ? { ...x, abbr: e.target.value.replace(/\s/g, "") } : x)))} />
              </td>
              <td>
                <textarea rows={1} value={s.text} placeholder={t("ws.expansion")} onChange={(e) => setShortcuts(shortcuts.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
              </td>
              <td>
                <button className="icon-btn" onClick={() => setShortcuts(shortcuts.filter((_, j) => j !== i))} aria-label={t("common.remove")}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="secondary small-btn" onClick={() => setShortcuts([...shortcuts, { abbr: "", text: "" }])}>
        ＋ {t("ws.addShortcut")}
      </button>

      </>
    );
  if (part === "capture") return <CaptureSettings nodes={nodes} onToast={onToast} />;
  if (part === "backup") return desktop ? <BackupSettings onToast={onToast} /> : <p className="muted small">{t("ws.backupDesktopOnly")}</p>;
  return (
    <>
      <p className="muted small">{t("ws.customCommandsHint")}</p>
      {commands.map((c, i) => {
        const set = (p: Partial<CustomCommand>) => setCommands(commands.map((x, j) => (j === i ? { ...x, ...p } : x)));
        return (
          <div key={c.id} className="custom-cmd">
            <input value={c.name} placeholder={t("ws.commandName")} onChange={(e) => set({ name: e.target.value })} />
            <select value={c.action} onChange={(e) => set({ action: e.target.value as CustomCommand["action"], value: "" })}>
              <option value="insert">{t("ws.cmd.insert")}</option>
              <option value="open">{t("ws.cmd.open")}</option>
              <option value="capture">{t("ws.cmd.capture")}</option>
              <option value="run">{t("ws.cmd.run")}</option>
            </select>
            {c.action === "open" ? (
              <select value={c.value} onChange={(e) => set({ value: e.target.value })}>
                <option value="">{t("ws.pickNote")}</option>
                {nodes
                  .filter((n) => !n.template)
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.title}
                    </option>
                  ))}
              </select>
            ) : (
              <textarea rows={1} value={c.value} placeholder={c.action === "run" ? "view.focus, timer.toggle" : t("ws.commandValue")} onChange={(e) => set({ value: e.target.value })} />
            )}
            <button className="icon-btn" onClick={() => setCommands(commands.filter((_, j) => j !== i))} aria-label={t("common.remove")}>
              ✕
            </button>
          </div>
        );
      })}
      <div className="row">
        <button className="secondary small-btn" onClick={() => setCommands([...commands, { id: `c${Date.now().toString(36)}`, name: "", action: "insert", value: "" }])}>
          ＋ {t("ws.addCommand")}
        </button>
        <button className="secondary small-btn" onClick={exportFile}>
          ⇩ {t("ws.exportShortcuts")}
        </button>
        <button className="secondary small-btn" onClick={importFile}>
          ⇧ {t("ws.importShortcuts")}
        </button>
      </div>

    </>
  );
}

function CaptureSettings({ nodes, onToast }: { nodes: NodeMeta[]; onToast: (msg: string) => void }) {
  const [config, setConfig] = useState<CaptureConfig | null>(null);
  useEffect(() => {
    api.captureConfig().then(setConfig, () => setConfig({ autoRoute: true, rules: [], defaults: {} }));
  }, []);
  if (!config) return null;
  const save = async (next: CaptureConfig) => {
    setConfig(next);
    try {
      await api.setCaptureConfig(next);
    } catch (e) {
      onToast((e as Error).message);
    }
  };
  const targets = (kind: CaptureKind) =>
    nodes.filter((n) => !n.locked && (kind === "card" ? n.layoutMode === "cards" : kind === "outline" ? n.layoutMode === "outline" : kind === "wiki" ? n.layoutMode === "wiki" || isInWiki(n, nodes) : n.layoutMode === "stream" && !n.database));
  return (
    <>
      <p className="muted small">{t("ws.captureHint")}</p>
      <label className="check">
        <input type="checkbox" checked={config.autoRoute} onChange={(e) => void save({ ...config, autoRoute: e.target.checked })} /> {t("ws.autoRoute")}
      </label>
      <table className="kv-table">
        <thead>
          <tr>
            <th>@</th>
            <th>{t("ws.kind")}</th>
            <th>{t("ws.target")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {config.rules.map((r, i) => {
            const set = (p: Partial<CaptureConfig["rules"][number]>) => void save({ ...config, rules: config.rules.map((x, j) => (j === i ? { ...x, ...p } : x)) });
            return (
              <tr key={i}>
                <td>
                  <input value={r.handle} onChange={(e) => setConfig({ ...config, rules: config.rules.map((x, j) => (j === i ? { ...x, handle: e.target.value } : x)) })} onBlur={() => void save(config)} />
                </td>
                <td>
                  <select value={r.kind} onChange={(e) => set({ kind: e.target.value as CaptureKind, target: "" })}>
                    {CAPTURE_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {t(`ws.ck.${k}`)}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select value={r.target} onChange={(e) => set({ target: e.target.value })}>
                    <option value="">—</option>
                    {targets(r.kind).map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.title}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button className="icon-btn" onClick={() => void save({ ...config, rules: config.rules.filter((_, j) => j !== i) })} aria-label={t("common.remove")}>
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button className="secondary small-btn" onClick={() => setConfig({ ...config, rules: [...config.rules, { handle: "", kind: "card", target: "" }] })}>
        ＋ {t("ws.addRule")}
      </button>
      <div className="capture-defaults">
        <span className="muted small">{t("ws.defaultTargets")}</span>
        {CAPTURE_KINDS.map((k) => (
          <label key={k} className="field inline">
            <span>{t(`ws.ck.${k}`)}</span>
            <select value={config.defaults[k] ?? ""} onChange={(e) => void save({ ...config, defaults: { ...config.defaults, [k]: e.target.value || undefined } })}>
              <option value="">{t("ws.stayInShadow")}</option>
              {targets(k).map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </>
  );
}

function isInWiki(n: NodeMeta, nodes: NodeMeta[]): boolean {
  for (let p = nodes.find((x) => x.id === n.parentNodeId); p; p = nodes.find((x) => x.id === p!.parentNodeId)) if (p.layoutMode === "wiki") return true;
  return false;
}

function BackupSettings({ onToast }: { onToast: (msg: string) => void }) {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => void desktop!.backupStatus().then(setStatus);
  useEffect(refresh, []);
  if (!status) return null;
  return (
    <>
      <p className="muted small">{t("ws.backupHint")}</p>
      <div className="row">
        <code className="path grow">{status.dir ?? t("ws.noBackupFolder")}</code>
        <button className="secondary small-btn" onClick={async () => (await desktop!.backupChooseDir()) && refresh()}>
          {status.dir ? t("ws.changeFolder") : t("ws.chooseFolder")}
        </button>
        {status.dir && (
          <button className="secondary small-btn" onClick={() => void desktop!.backupReveal()}>
            {t("settings.revealFolder")}
          </button>
        )}
      </div>
      {status.dir && (
        <>
          <div className="row">
            <label className="field inline">
              <span>{t("ws.backupEvery")}</span>
              <select value={status.interval} onChange={async (e) => (await desktop!.backupSet({ interval: e.target.value as BackupStatus["interval"] }), refresh())}>
                {(["off", "hourly", "daily", "weekly"] as const).map((i) => (
                  <option key={i} value={i}>
                    {t(`ws.every.${i}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field inline">
              <span>{t("ws.backupKeep")}</span>
              <input type="number" min={1} max={200} value={status.keep} onChange={async (e) => (await desktop!.backupSet({ keep: Math.max(1, Math.min(200, Number(e.target.value) || 10)) }), refresh())} />
            </label>
          </div>
          <div className="row">
            <button
              className="primary small-btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const res = await desktop!.backupNow();
                setBusy(false);
                onToast(res.ok ? t("ws.backupDone", { name: res.name ?? "" }) : t("ws.backupFailed", { error: res.error ?? "" }));
                refresh();
              }}
            >
              {busy ? t("ws.backingUp") : t("ws.backupNow")}
            </button>
            <span className="muted small">
              {status.lastAt ? t("ws.lastBackup", { when: new Date(status.lastAt).toLocaleString() }) : t("ws.neverBackedUp")}
              {status.lastError ? ` · ⚠︎ ${status.lastError}` : ""}
              {status.count ? ` · ${t("ws.backupCount", { n: status.count })}` : ""}
            </span>
          </div>
        </>
      )}
    </>
  );
}
