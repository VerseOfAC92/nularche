// Ayarlar → Otomasyon → Vigil: zamanlanmış otomasyonları ekleme, düzenleme, açıp kapatma ve hemen çalıştırma.

import { useState } from "react";
import { cleanVigils, nextRun, type Vigil, type VigilFreq } from "../../../core/src/vigil-schedule.ts";
import type { NodeMeta } from "../api.ts";
import { getLang, t } from "../i18n/index.ts";
import { usePref } from "../prefs.ts";
import { Icon } from "../ui/Icon.tsx";
import { recordRun, runVigil } from "./runner.ts";

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
const weekdayName = (d: number) => new Date(2026, 10, 15 + d).toLocaleDateString(getLang() === "en" ? "en-GB" : "tr-TR", { weekday: "long" }); // 16 Kasım 2026 pazartesi

export function whenText(v: Vigil): string {
  const s = v.schedule;
  if (s.freq === "daily") return t("vigil.everyDay", { time: s.time });
  if (s.freq === "weekly") return t("vigil.everyWeek", { day: weekdayName(s.weekday ?? 1), time: s.time });
  return t("vigil.everyMonth", { day: s.day ?? 1, time: s.time });
}

export const nextText = (v: Vigil) => new Date(nextRun(v.schedule, Date.now())).toLocaleString(getLang() === "en" ? "en-GB" : "tr-TR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const blank = (): Vigil => ({
  id: `v-${Math.random().toString(36).slice(2, 9)}`,
  name: "",
  enabled: true,
  created: Date.now(),
  schedule: { freq: "weekly", weekday: 1, time: "09:00" },
  action: { kind: "ai", prompt: "" },
});

export function VigilSettings({ nodes, onToast, onChanged }: { nodes: NodeMeta[]; onToast: (msg: string) => void; onChanged: () => void }) {
  const [raw, setRaw] = usePref<unknown>("vigils", []);
  const list = cleanVigils(raw);
  const [edit, setEdit] = useState<Vigil | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const arches = nodes.filter((n) => n.parentNodeId === null && n.archeId === n.id && !n.template && !n.archeLock);

  const save = (v: Vigil) => {
    const exists = list.some((x) => x.id === v.id);
    setRaw(exists ? list.map((x) => (x.id === v.id ? v : x)) : [...list, v]);
    setEdit(null);
  };

  const runNow = async (v: Vigil) => {
    setBusy(v.id);
    const r = await runVigil(v);
    recordRun(v.id, r);
    setBusy(null);
    onChanged();
    onToast(r.ok ? t("vigil.ran", { name: v.name, result: r.message ?? "" }) : t("vigil.failed", { name: v.name, error: r.message ?? "" }));
  };

  const example = () =>
    setEdit({ ...blank(), name: t("vigil.exampleName"), action: { kind: "ai", prompt: t("vigil.examplePrompt") } });

  return (
    <section className="settings-card">
      <h4>{t("vigil.title")}</h4>
      <p className="muted small">{t("vigil.hint")}</p>
      {!list.length && !edit && <p className="muted small">{t("vigil.none")}</p>}
      {list.map((v) => (
        <div key={v.id} className="vigil-row" data-testid="vigil-row">
          <label className="check">
            <input type="checkbox" checked={v.enabled} onChange={(e) => setRaw(list.map((x) => (x.id === v.id ? { ...x, enabled: e.target.checked } : x)))} />
          </label>
          <div className="grow">
            <div>
              <Icon name={v.action.kind === "ai" ? "sparkles" : "file-text"} size={14} /> <strong>{v.name}</strong>
            </div>
            <div className="muted small">
              {whenText(v)} · {v.action.kind === "ai" ? "Nularche AI" : t("vigil.digest")}
              {v.enabled ? ` · ${t("vigil.next", { when: nextText(v) })}` : ""}
            </div>
            {v.lastResult && (
              <div className={`small ${v.lastResult.ok ? "muted" : "error-text"}`}>
                {t("vigil.last", { when: new Date(v.lastResult.at).toLocaleString(getLang() === "en" ? "en-GB" : "tr-TR") })} — {v.lastResult.message}
              </div>
            )}
          </div>
          <button className="secondary" disabled={!!busy} onClick={() => void runNow(v)}>
            {busy === v.id ? "…" : t("vigil.runNow")}
          </button>
          <button className="icon-btn" title={t("vigil.edit")} onClick={() => setEdit(v)}>
            <Icon name="pencil" size={14} />
          </button>
          <button className="icon-btn" title={t("vigil.delete")} onClick={() => confirm(t("vigil.deleteConfirm", { name: v.name })) && setRaw(list.filter((x) => x.id !== v.id))}>
            <Icon name="trash" size={14} />
          </button>
        </div>
      ))}
      {edit ? (
        <VigilForm value={edit} arches={arches} onCancel={() => setEdit(null)} onSave={save} />
      ) : (
        <div className="row">
          <button className="secondary" onClick={() => setEdit(blank())} data-testid="vigil-add">
            <Icon name="plus" size={14} /> {t("vigil.add")}
          </button>
          <button className="link-btn" onClick={example}>
            {t("vigil.example")}
          </button>
        </div>
      )}
    </section>
  );
}

function VigilForm({ value, arches, onSave, onCancel }: { value: Vigil; arches: NodeMeta[]; onSave: (v: Vigil) => void; onCancel: () => void }) {
  const [v, setV] = useState<Vigil>(value);
  const s = v.schedule;
  const setS = (patch: Partial<Vigil["schedule"]>) => setV({ ...v, schedule: { ...s, ...patch } });
  const valid = v.name.trim() && /^\d{1,2}:\d{2}$/.test(s.time) && (v.action.kind === "digest" || v.action.prompt.trim());
  return (
    <form className="vigil-form" onSubmit={(e) => (e.preventDefault(), valid && onSave({ ...v, name: v.name.trim() }))} data-testid="vigil-form">
      <input placeholder={t("vigil.name")} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} maxLength={80} autoFocus />
      <div className="row">
        <div className="segmented">
          {(["daily", "weekly", "monthly"] as VigilFreq[]).map((f) => (
            <button type="button" key={f} className={s.freq === f ? "on" : ""} onClick={() => setS({ freq: f })}>
              {t(`vigil.${f}`)}
            </button>
          ))}
        </div>
        {s.freq === "weekly" && (
          <select value={s.weekday ?? 1} onChange={(e) => setS({ weekday: Number(e.target.value) })}>
            {WEEKDAYS.map((d) => (
              <option key={d} value={d}>
                {weekdayName(d)}
              </option>
            ))}
          </select>
        )}
        {s.freq === "monthly" && (
          <label className="row small">
            {t("vigil.dayOfMonth")}
            <input type="number" min={1} max={28} value={s.day ?? 1} onChange={(e) => setS({ day: Math.min(28, Math.max(1, Number(e.target.value) || 1)) })} style={{ width: 56 }} />
          </label>
        )}
        <input type="time" value={s.time} onChange={(e) => setS({ time: e.target.value })} />
      </div>
      <div className="segmented">
        <button type="button" className={v.action.kind === "ai" ? "on" : ""} onClick={() => setV({ ...v, action: { kind: "ai", prompt: v.action.kind === "ai" ? v.action.prompt : "" } })}>
          Nularche AI
        </button>
        <button type="button" className={v.action.kind === "digest" ? "on" : ""} onClick={() => setV({ ...v, action: { kind: "digest", days: 7, parentId: null } })}>
          {t("vigil.digest")}
        </button>
      </div>
      {v.action.kind === "ai" ? (
        <>
          <textarea rows={4} placeholder={t("vigil.promptPlaceholder")} value={v.action.prompt} onChange={(e) => setV({ ...v, action: { kind: "ai", prompt: e.target.value } })} />
          <p className="muted small">{t("vigil.aiHint")}</p>
        </>
      ) : (
        <div className="row small">
          <label className="row">
            {t("vigil.days")}
            <input type="number" min={1} max={366} value={v.action.days} onChange={(e) => v.action.kind === "digest" && setV({ ...v, action: { ...v.action, days: Math.max(1, Math.min(366, Number(e.target.value) || 7)) } })} style={{ width: 64 }} />
          </label>
          <label className="row">
            {t("vigil.where")}
            <select value={v.action.parentId ?? ""} onChange={(e) => v.action.kind === "digest" && setV({ ...v, action: { ...v.action, parentId: e.target.value || null } })}>
              <option value="">Shadow</option>
              {arches.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.icon ? `${a.icon} ` : ""}
                  {a.title}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="row">
        <button className="primary" type="submit" disabled={!valid}>
          {t("vigil.save")}
        </button>
        <button className="secondary" type="button" onClick={onCancel}>
          {t("vigil.cancel")}
        </button>
      </div>
    </form>
  );
}
