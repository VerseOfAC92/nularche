// Çöp: silinen Node'lar (alt Node'larıyla) burada durur. Geri getirilen Node eski yerine döner;
// eski yeri artık yoksa Shadow'a gelir. Kalıcı silme yalnızca kullanıcı onaylarsa yapılır.

import { useCallback, useEffect, useState } from "react";
import { api, type TrashEntry, errorMessage } from "./api.ts";
import { ago, t } from "./i18n/index.ts";
import { Icon } from "./ui/Icon.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";

/** Klasör notu yolunu ("A/B/B.md") okunur konuma ("A/B") çevirir. */
function displayPath(p: string): string {
  const parts = p.replace(/\.md$/, "").split("/");
  if (parts.length > 1 && parts[parts.length - 1] === parts[parts.length - 2]) parts.pop();
  return parts.join("/");
}

export function TrashView({
  changeTick,
  onChanged,
  onToast,
}: {
  changeTick: number;
  onChanged: () => void;
  onToast: (msg: string) => void;
}) {
  const [entries, setEntries] = useState<TrashEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => api.trashList().then(setEntries, () => setEntries([])), []);
  useEffect(() => {
    void load();
  }, [load, changeTick]);

  async function restore(e: TrashEntry) {
    setBusy(e.entry);
    try {
      const node = await api.restore(e.entry);
      onChanged();
      await load();
      onToast(node.archeId === null ? t("trash.restoredShadow", { title: node.title }) : t("trash.restored", { title: node.title }));
    } catch (err) {
      onToast(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove(e: TrashEntry) {
    if (!confirm(t("trash.deleteConfirm", { title: e.title }))) return;
    await api.deleteTrash(e.entry).catch((err: unknown) => onToast(errorMessage(err)));
    onChanged();
    await load();
  }

  async function emptyAll() {
    if (!entries?.length || !confirm(t("trash.emptyConfirm", { count: entries.length }))) return;
    await api.emptyTrash().catch((err: unknown) => onToast(errorMessage(err)));
    onChanged();
    await load();
  }

  return (
    <article className="page trash-page">
      <div className="trash-head">
        <h1><Icon name="trash" size={26} /> {t("trash.title")}</h1>
        {!!entries?.length && (
          <button className="secondary danger" onClick={emptyAll}>
            {t("trash.empty")}
          </button>
        )}
      </div>
      <p className="muted">{t("trash.hint")}</p>
      {entries && entries.length === 0 && <EmptyState icon="trash" text={t("trash.none")} />}
      <div className="trash-list">
        {entries?.map((e) => (
          <div key={e.entry} className="trash-row">
            <div className="trash-info">
              <strong>{e.title}</strong>
              <span className="muted small">
                {t("trash.deletedAgo", { when: ago(e.trashedAt) })}
                {e.childCount > 0 && ` · ${t("trash.children", { count: e.childCount })}`}
                {" · "}
                {e.originalPath ? t("trash.from", { path: displayPath(e.originalPath) }) : t("trash.fromUnknown")}
              </span>
            </div>
            <button className="primary" disabled={busy === e.entry} onClick={() => restore(e)}>
              <Icon name="restore" /> {t("trash.restore")}
            </button>
            <button className="secondary" onClick={() => remove(e)} title={t("trash.deleteForever")}>
              {t("trash.deleteForever")}
            </button>
          </div>
        ))}
      </div>
    </article>
  );
}
