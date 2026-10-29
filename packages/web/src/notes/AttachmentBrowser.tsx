// İlişik (ek) tarayıcısı: `Attachments/` klasöründeki tüm resim, ses, çizim ve dosyalar; türe göre süzme,
// yeniden adlandırma (bağlantılar güncellenir) ve eki kullanan nota gitme.

import { useCallback, useEffect, useState } from "react";
import { askText } from "../ask.tsx";
import { api, type AttachmentInfo } from "../api.ts";
import { fileUrl } from "../editor/paths.ts";
import { t } from "../i18n/index.ts";
import { relTime } from "./NoteList.tsx";

type Filter = "all" | "image" | "audio" | "drawing" | "file";

const size = (b: number) => (b < 1024 ? `${b} B` : b < 1024 ** 2 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 ** 2).toFixed(1)} MB`);
const ICON: Record<AttachmentInfo["kind"], string> = { image: "🖼", audio: "🎙", video: "🎬", drawing: "✎", pdf: "📄", file: "📎" };

export function AttachmentBrowser({ changeTick, onOpen, onToast }: { changeTick: number; onOpen: (id: string) => void; onToast: (m: string) => void }) {
  const [items, setItems] = useState<AttachmentInfo[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const load = useCallback(() => api.attachments().then(setItems, () => setItems([])), []);
  useEffect(() => void load(), [load, changeTick]);

  const shown = (items ?? []).filter((a) => filter === "all" || a.kind === filter || (filter === "file" && ["file", "pdf", "video"].includes(a.kind)));

  async function rename(a: AttachmentInfo) {
    const name = await askText(t("att.renamePrompt"), a.name.replace(/\.[^.]+$/, ""));
    if (!name?.trim()) return;
    try {
      await api.renameAttachment(a.path, name);
      await load();
    } catch (e) {
      onToast((e as Error).message);
    }
  }

  return (
    <div className="note-list-page">
      <div className="note-list-head">
        <h1>
          <span className="note-list-icon">📎</span>
          {t("att.title")}
          {items && <span className="note-count">{shown.length}</span>}
        </h1>
        <div className="segmented small">
          {(
            [
              ["all", "att.all"],
              ["image", "att.images"],
              ["drawing", "att.drawings"],
              ["audio", "att.audio"],
              ["file", "att.files"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>
              {t(label)}
            </button>
          ))}
        </div>
      </div>
      {items && shown.length === 0 && <p className="muted empty-list">{t("att.empty")}</p>}
      <div className="att-grid">
        {shown.map((a) => (
          <div key={a.path} className="att-card">
            <a className="att-preview" href={fileUrl(a.path)} target="_blank" rel="noopener" title={t("att.open")}>
              {a.kind === "image" || a.kind === "drawing" ? <img src={fileUrl(a.path)} alt="" loading="lazy" /> : a.kind === "audio" ? null : <span className="att-icon">{ICON[a.kind]}</span>}
            </a>
            {a.kind === "audio" && <audio controls preload="none" src={fileUrl(a.path)} />}
            <div className="att-name" title={a.path}>
              {ICON[a.kind]} {a.name}
            </div>
            <div className="att-meta muted small">
              {size(a.size)} · {relTime(a.modifiedAt)}
            </div>
            <div className="att-actions">
              {a.refs.length ? (
                a.refs.slice(0, 3).map((r) => (
                  <button key={r.id} className="link-btn" onClick={() => onOpen(r.id)} title={t("att.showInNote")}>
                    ↗ {r.title}
                  </button>
                ))
              ) : (
                <span className="muted small">{t("att.unused")}</span>
              )}
              <button className="link-btn" onClick={() => rename(a)}>
                ✎ {t("att.rename")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
