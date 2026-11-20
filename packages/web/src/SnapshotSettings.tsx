// Ayarlar → Güvenlik → Anlık görüntüler: Origin'in tamamının geçmişteki hâlleri (bkz. core/src/snapshots.ts).
// Anlık görüntü almak, içindeki değişiklikleri incelemek, tek dosyayı ya da Origin'in tamamını geri yüklemek.

import { useCallback, useEffect, useState } from "react";
import { api, type SnapshotFile, type SnapshotSummary } from "./api.ts";
import { t, useLang } from "./i18n/index.ts";
import { Icon } from "./ui/Icon.tsx";

const size = (b: number) => (b < 1024 ? `${b} B` : b < 1024 ** 2 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 ** 2).toFixed(1)} MB`);
const PAGE = 15;

export function SnapshotSettings({ onToast, onChanged }: { onToast: (msg: string) => void; onChanged: () => void }) {
  const lang = useLang();
  const [list, setList] = useState<SnapshotSummary[] | null>(null);
  const [encrypted, setEncrypted] = useState(false);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<{ id: string; files: SnapshotFile[] | null } | null>(null);
  const [preview, setPreview] = useState<{ path: string; text: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.snapshots().then(
      (r) => (setList(r.snapshots), setEncrypted(r.encrypted), setError(null)),
      (e) => setError((e as Error).message),
    );
  }, []);
  useEffect(refresh, [refresh]);

  const when = (at: number) => new Date(at).toLocaleString(lang === "tr" ? "tr-TR" : "en-GB", { dateStyle: "medium", timeStyle: "short" });

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      onToast((e as Error).message);
    } finally {
      setBusy(false);
      refresh();
    }
  }

  const take = () =>
    run(async () => {
      await api.createSnapshot(label);
      setLabel("");
      onToast(t("snap.taken"));
    });

  const restoreAll = (s: SnapshotSummary) =>
    run(async () => {
      if (!confirm(t("snap.restoreConfirm", { when: when(s.at) }))) return;
      const r = await api.restoreSnapshot(s.id, undefined, t("snap.beforeRestore"));
      onChanged();
      onToast(t("snap.restored", { n: r.restored + r.removed }));
    });

  const restoreFile = (s: SnapshotSummary, f: SnapshotFile) =>
    run(async () => {
      if (!confirm(f.status === "added" ? t("snap.removeFileConfirm", { path: f.path }) : t("snap.restoreFileConfirm", { path: f.path }))) return;
      await api.restoreSnapshot(s.id, [f.path], t("snap.beforeRestore"));
      onChanged();
      onToast(t("snap.fileRestored", { path: f.path }));
      setOpen({ id: s.id, files: await api.snapshotFiles(s.id) });
    });

  const toggle = async (s: SnapshotSummary) => {
    if (open?.id === s.id) return setOpen(null);
    setPreview(null);
    setOpen({ id: s.id, files: null });
    try {
      setOpen({ id: s.id, files: await api.snapshotFiles(s.id) });
    } catch (e) {
      setOpen(null);
      onToast((e as Error).message);
    }
  };

  const rename = (s: SnapshotSummary) =>
    run(async () => {
      const next = prompt(t("snap.renamePrompt"), s.label ?? "");
      if (next === null) return;
      await api.renameSnapshot(s.id, next || null);
    });

  const remove = (s: SnapshotSummary) =>
    run(async () => {
      if (!confirm(t("snap.deleteConfirm", { when: when(s.at) }))) return;
      await api.deleteSnapshot(s.id);
      if (open?.id === s.id) setOpen(null);
    });

  return (
    <section className="settings-card">
      <h4>{t("snap.title")}</h4>
      <p className="muted small">{t("snap.hint")}</p>
      <p className="muted small">
        <Icon name={encrypted ? "shield-check" : "alert-triangle"} size={14} /> {encrypted ? t("snap.encrypted") : t("snap.notEncrypted")}
      </p>
      <form className="row" onSubmit={(e) => (e.preventDefault(), void take())}>
        <input className="grow" placeholder={t("snap.labelPlaceholder")} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} />
        <button className="secondary" type="submit" disabled={busy} data-testid="snap-take">
          <Icon name="camera" size={14} /> {t("snap.take")}
        </button>
      </form>
      {error && <p className="error-text small">{error}</p>}
      {list && list.length === 0 && <p className="muted small">{t("snap.none")}</p>}
      <div className="snap-list">
        {list?.slice(0, shown).map((s) => (
          <div key={s.id} className={`snap-item ${open?.id === s.id ? "open" : ""}`} data-testid="snap-item">
            <div className="row">
              <button className="snap-head grow" onClick={() => void toggle(s)} aria-expanded={open?.id === s.id}>
                <Icon name={open?.id === s.id ? "chevron-down" : "chevron-right"} size={14} />
                <span className="snap-when">{when(s.at)}</span>
                {s.label ? <span className="pill">{s.label}</span> : <span className="muted small">{s.auto ? t("snap.auto") : t("snap.manual")}</span>}
                <span className="muted small snap-delta">
                  {s.added ? ` +${s.added}` : ""}
                  {s.changed ? ` ~${s.changed}` : ""}
                  {s.removed ? ` −${s.removed}` : ""}
                  {!s.added && !s.changed && !s.removed ? ` ${t("snap.noChange")}` : ""} · {t("snap.files", { n: s.files })} · {size(s.bytes)}
                </span>
              </button>
              <button className="icon-btn" title={t("snap.rename")} disabled={busy} onClick={() => void rename(s)}>
                <Icon name="pencil" size={14} />
              </button>
              <button className="icon-btn" title={t("snap.delete")} disabled={busy} onClick={() => void remove(s)}>
                <Icon name="trash" size={14} />
              </button>
            </div>
            {open?.id === s.id && (
              <div className="snap-body">
                {open.files === null ? (
                  <p className="muted small">…</p>
                ) : (
                  <SnapshotDiff
                    files={open.files}
                    busy={busy}
                    onRestore={(f) => void restoreFile(s, f)}
                    onPreview={async (f) => {
                      if (preview?.path === f.path) return setPreview(null);
                      const r = await api.snapshotFile(s.id, f.path).catch(() => null);
                      setPreview(r ? { path: f.path, text: r.text } : null);
                    }}
                    preview={preview}
                  />
                )}
                {s.skipped > 0 && <p className="muted small">{t("snap.skipped", { n: s.skipped })}</p>}
                <button className="secondary" disabled={busy} onClick={() => void restoreAll(s)} data-testid="snap-restore-all">
                  <Icon name="history" size={14} /> {t("snap.restoreAll")}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {list && list.length > shown && (
        <button className="link-btn" onClick={() => setShown((n) => n + PAGE)}>
          {t("snap.more", { n: list.length - shown })}
        </button>
      )}
    </section>
  );
}

function SnapshotDiff({
  files,
  busy,
  onRestore,
  onPreview,
  preview,
}: {
  files: SnapshotFile[];
  busy: boolean;
  onRestore: (f: SnapshotFile) => void;
  onPreview: (f: SnapshotFile) => void;
  preview: { path: string; text: string | null } | null;
}) {
  const changed = files.filter((f) => f.status !== "same");
  if (!changed.length) return <p className="muted small">{t("snap.identical")}</p>;
  const label = { changed: t("snap.stChanged"), deleted: t("snap.stDeleted"), added: t("snap.stAdded"), same: "" } as const;
  return (
    <>
      <p className="muted small">{t("snap.diffHint")}</p>
      <ul className="snap-files">
        {changed.map((f) => (
          <li key={f.path}>
            <div className="row">
              <span className={`snap-st ${f.status}`}>{label[f.status]}</span>
              <span className="grow snap-path" title={f.path}>
                {f.path}
              </span>
              {f.status !== "added" && /\.md$/i.test(f.path) && (
                <button className="link-btn small" onClick={() => onPreview(f)}>
                  {t("snap.preview")}
                </button>
              )}
              <button className="secondary small" disabled={busy} onClick={() => onRestore(f)}>
                {f.status === "added" ? t("snap.removeFile") : t("snap.restoreFile")}
              </button>
            </div>
            {preview?.path === f.path && <pre className="snap-preview">{preview.text ?? t("snap.noPreview")}</pre>}
          </li>
        ))}
      </ul>
    </>
  );
}
