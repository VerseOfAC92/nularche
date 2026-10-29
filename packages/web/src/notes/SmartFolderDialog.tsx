// Akıllı klasör oluşturma/düzenleme penceresi: etiket, tarih, yapılacak, ek, Arche, iğne ve kilit koşulları.

import { useMemo, useState } from "react";
import type { NodeMeta, TagCount } from "../api.ts";
import { t } from "../i18n/index.ts";
import { newSmartId, smartMatches, type SmartFolder } from "./smart.ts";

const DAYS = [0, 1, 7, 30, 90, 365];

export function SmartFolderDialog({
  initial,
  nodes,
  tags,
  onSave,
  onDelete,
  onClose,
}: {
  initial?: Partial<SmartFolder>;
  nodes: NodeMeta[];
  tags: TagCount[];
  onSave: (f: SmartFolder) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [f, setF] = useState<SmartFolder>(() => ({ id: newSmartId(), name: "", match: "all", tagMode: "any", ...initial }));
  const set = (patch: Partial<SmartFolder>) => setF((x) => ({ ...x, ...patch }));
  const count = useMemo(() => smartMatches(f, nodes).length, [f, nodes]);
  const arches = nodes.filter((n) => n.archeId === n.id && !n.template);
  const toggle = (list: string[] | undefined, v: string) => (list?.includes(v) ? list.filter((x) => x !== v) : [...(list ?? []), v]);

  return (
    <div className="overlay" onMouseDown={onClose} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <form
        className="dialog smart-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (f.name.trim()) onSave({ ...f, name: f.name.trim() });
        }}
      >
        <header>
          <h2>⚙︎ {initial?.id ? t("smart.edit") : t("smart.new")}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t("common.close")}>
            ✕
          </button>
        </header>
        <label className="field">
          <span>{t("smart.name")}</span>
          <input autoFocus value={f.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <div className="smart-row">
          {t("smart.match")}
          <div className="segmented small">
            {(["all", "any"] as const).map((m) => (
              <button type="button" key={m} className={f.match === m ? "on" : ""} onClick={() => set({ match: m })}>
                {t(m === "all" ? "smart.all" : "smart.any")}
              </button>
            ))}
          </div>
        </div>

        <h3>{t("smart.tags")}</h3>
        <div className="chip-list">
          {tags.map((tg) => (
            <button type="button" key={tg.tag} className={`chip ${f.tags?.includes(tg.tag) ? "on" : ""}`} onClick={() => set({ tags: toggle(f.tags, tg.tag) })}>
              #{tg.tag} <small>{tg.count}</small>
            </button>
          ))}
          {!tags.length && <p className="muted small">{t("tags.hint")}</p>}
        </div>
        {(f.tags?.length ?? 0) > 1 && (
          <div className="segmented small">
            {(["any", "all"] as const).map((m) => (
              <button type="button" key={m} className={(f.tagMode ?? "any") === m ? "on" : ""} onClick={() => set({ tagMode: m })}>
                {t(m === "any" ? "smart.tagsAny" : "smart.tagsAll")}
              </button>
            ))}
          </div>
        )}

        <div className="smart-grid">
          {(
            [
              ["createdDays", "smart.created"],
              ["editedDays", "smart.edited"],
            ] as const
          ).map(([k, label]) => (
            <label className="field" key={k}>
              <span>{t(label)}</span>
              <select value={f[k] ?? 0} onChange={(e) => set({ [k]: Number(e.target.value) || undefined })}>
                {DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d ? t("smart.withinDays", { n: d }) : t("smart.anyDate")}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label className="field">
            <span>{t("smart.checklists")}</span>
            <select value={f.checklist ?? ""} onChange={(e) => set({ checklist: (e.target.value || undefined) as SmartFolder["checklist"] })}>
              <option value="">{t("smart.ignore")}</option>
              <option value="has">{t("smart.hasTodos")}</option>
              <option value="open">{t("smart.hasOpen")}</option>
              <option value="done">{t("smart.allDone")}</option>
            </select>
          </label>
          <label className="field">
            <span>{t("smart.attachments")}</span>
            <select value={f.attachments ? "1" : ""} onChange={(e) => set({ attachments: e.target.value === "1" || undefined })}>
              <option value="">{t("smart.ignore")}</option>
              <option value="1">{t("smart.hasAttachments")}</option>
            </select>
          </label>
        </div>

        {arches.length > 0 && (
          <>
            <h3>{t("smart.arches")}</h3>
            <div className="chip-list">
              {arches.map((a) => (
                <button type="button" key={a.id} className={`chip ${f.archeIds?.includes(a.id) ? "on" : ""}`} onClick={() => set({ archeIds: toggle(f.archeIds, a.id) })}>
                  {a.icon ?? "◈"} {a.title}
                </button>
              ))}
            </div>
          </>
        )}
        <label className="check">
          <input type="checkbox" checked={!!f.pinned} onChange={(e) => set({ pinned: e.target.checked || undefined })} /> {t("smart.pinned")}
        </label>
        <label className="check">
          <input type="checkbox" checked={!!f.locked} onChange={(e) => set({ locked: e.target.checked || undefined })} /> {t("smart.locked")}
        </label>

        <div className="dialog-actions">
          {onDelete && (
            <button type="button" className="secondary danger" onClick={onDelete}>
              {t("smart.delete")}
            </button>
          )}
          <span className="muted small">{t("smart.preview", { n: count })}</span>
          <span className="grow" />
          <button type="button" className="secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="primary" disabled={!f.name.trim()}>
            {t("smart.save")}
          </button>
        </div>
      </form>
    </div>
  );
}
