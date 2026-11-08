// Yorumlar paneli (2.0): notun pasajlarına bağlı yorum dizileri; yanıt, çözüldü işareti, düzenleme ve silme.
// Yorumlar Markdown dosyasını değiştirmez (bkz. core/src/comments.ts). Metni değişen ve bulunamayan pasajların
// yorumları "yerinden kopmuş" olarak işaretlenir.

import { useEffect, useRef, useState } from "react";
import { api, type NoteComment } from "../api.ts";
import { getActiveEditor } from "../commands.ts";
import { ago, t } from "../i18n/index.ts";
import { locateAnchor } from "../../../core/src/writing.ts";
import { plainIndex, setStudioData } from "./editor-plugins.ts";

export const COMMENTS_EVENT = "nl-comments";
export const COMMENT_FOCUS_EVENT = "nl-comment-focus";

/** Yorumlar değişti (bu pencerede ya da başka bir istemcide): açık görünümler yenilensin. */
export function commentsChanged(): void {
  dispatchEvent(new Event(COMMENTS_EVENT));
}

/** Bir notun yorumlarını yükleyip editör süslemelerine verir; değişince yeniden yükler. */
export function useNoteComments(noteId: string | null, enabled = true): NoteComment[] {
  const [list, setList] = useState<NoteComment[]>([]);
  useEffect(() => {
    if (!noteId || !enabled) return setList([]);
    let alive = true;
    const load = () =>
      api.comments(noteId).then(
        (c) => {
          if (!alive) return;
          setList(c);
          setStudioData({ comments: { noteId, list: c.map((x) => ({ id: x.id, anchor: x.anchor, resolved: x.resolved })) } });
        },
        () => alive && setList([]),
      );
    void load();
    addEventListener(COMMENTS_EVENT, load);
    return () => {
      alive = false;
      removeEventListener(COMMENTS_EVENT, load);
    };
  }, [noteId, enabled]);
  return list;
}

export function CommentsPanel({ nodeId, onToast }: { nodeId: string; onToast: (msg: string) => void }) {
  const list = useNoteComments(nodeId);
  const [showResolved, setShowResolved] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [reply, setReply] = useState<Record<string, string>>({});
  const box = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");

  // Editörün düz metni: hangi yorumların yerinden koptuğunu göstermek için.
  useEffect(() => {
    const read = () => {
      const e = getActiveEditor();
      setText(e ? plainIndex(e.state.doc).text : "");
    };
    read();
    const timer = setInterval(read, 2000);
    return () => clearInterval(timer);
  }, [nodeId]);

  useEffect(() => {
    const onFocus = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      setActive(id);
      if (list.find((c) => c.id === id)?.resolved) setShowResolved(true);
      requestAnimationFrame(() => box.current?.querySelector(`[data-cid="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    };
    addEventListener(COMMENT_FOCUS_EVENT, onFocus);
    return () => removeEventListener(COMMENT_FOCUS_EVENT, onFocus);
  }, [list]);

  useEffect(() => {
    setStudioData({ activeComment: active });
    return () => setStudioData({ activeComment: null });
  }, [active]);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      commentsChanged();
    } catch (e) {
      onToast((e as Error).message);
    }
  };

  const reveal = (c: NoteComment) => {
    setActive(c.id);
    const el = document.querySelector<HTMLElement>(`.ProseMirror[data-note-id="${nodeId}"] [data-comment-id="${c.id}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const shown = list.filter((c) => showResolved || !c.resolved);
  const resolvedCount = list.filter((c) => c.resolved).length;
  return (
    <div className="comments-panel" ref={box}>
      <p className="muted small">{t("ws.commentsHint")}</p>
      {resolvedCount > 0 && (
        <label className="check small">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> {t("ws.showResolved", { n: resolvedCount })}
        </label>
      )}
      {!shown.length && <p className="muted small">{t("ws.noComments")}</p>}
      {shown.map((c) => {
        const orphan = !!text && locateAnchor(text, c.anchor) < 0;
        return (
          <div key={c.id} data-cid={c.id} className={`comment ${active === c.id ? "active" : ""} ${c.resolved ? "resolved" : ""}`} onClick={() => reveal(c)}>
            <blockquote title={orphan ? t("ws.orphan") : undefined}>
              {orphan && "⚠︎ "}
              {c.anchor.text.length > 140 ? `${c.anchor.text.slice(0, 140)}…` : c.anchor.text}
            </blockquote>
            {editing === c.id ? (
              <div onClick={(e) => e.stopPropagation()}>
                <textarea value={draft} rows={3} autoFocus onChange={(e) => setDraft(e.target.value)} />
                <div className="row">
                  <button className="primary small-btn" onClick={() => void act(() => api.updateComment(nodeId, c.id, { body: draft })).then(() => setEditing(null))}>
                    {t("common.save")}
                  </button>
                  <button className="secondary small-btn" onClick={() => setEditing(null)}>
                    {t("common.cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <p className="comment-body">{c.body}</p>
            )}
            <div className="muted small">
              {c.author ? `${c.author} · ` : ""}
              {ago(c.createdAt)}
            </div>
            {c.replies.map((r) => (
              <div key={r.id} className="comment-reply">
                <p>{r.body}</p>
                <span className="muted small">
                  {r.author ? `${r.author} · ` : ""}
                  {ago(r.createdAt)}
                </span>
              </div>
            ))}
            <div className="comment-actions" onClick={(e) => e.stopPropagation()}>
              <input
                value={reply[c.id] ?? ""}
                placeholder={t("ws.reply")}
                onChange={(e) => setReply({ ...reply, [c.id]: e.target.value })}
                onKeyDown={(e) => {
                  const v = (reply[c.id] ?? "").trim();
                  if (e.key === "Enter" && v) void act(() => api.replyComment(nodeId, c.id, v)).then(() => setReply({ ...reply, [c.id]: "" }));
                }}
              />
              <button className="icon-btn" title={c.resolved ? t("ws.reopen") : t("ws.resolve")} onClick={() => void act(() => api.updateComment(nodeId, c.id, { resolved: !c.resolved }))}>
                {c.resolved ? "↺" : "✓"}
              </button>
              <button className="icon-btn" title={t("ws.editComment")} onClick={() => (setEditing(c.id), setDraft(c.body))}>
                ✎
              </button>
              <button className="icon-btn" title={t("common.remove")} onClick={() => confirm(t("ws.deleteCommentConfirm")) && void act(() => api.deleteComment(nodeId, c.id))}>
                🗑
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
