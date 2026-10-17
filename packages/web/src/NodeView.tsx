// Tek bir Node'un görünümü: kapak, ikon, başlık, Stream editörü ve geri bağlantılar.
// Otomatik kaydetme ve çakışma (ör. Claude aynı anda düzenlediğinde) burada yönetilir.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, SHADOW, type NodeDoc, type NodeMeta, type PageFieldPatch } from "./api.ts";
import { desktop } from "./desktop.ts";
import { Editor } from "./editor/Editor.tsx";
import { NularcheMark } from "./ai/NularcheMark.tsx";
import { t, type StringKey } from "./i18n/index.ts";
import { fileUrl, resolveRelative } from "./editor/paths.ts";
import { DatabaseView } from "./database/DatabaseView.tsx";
import { exportNode, type ExportKind } from "./exporting.ts";
import { RowProperties } from "./database/RowProperties.tsx";
import { DatabaseHostContext } from "./database/InlineDatabase.tsx";
import { freshDatabase, serializeDatabase } from "./database/model.ts";

type Status = "saved" | "dirty" | "saving" | "conflict" | "error";
const SAVE_DELAY_MS = 800;
const STATUS_KEY: Record<Status, StringKey> = {
  saved: "node.saved",
  dirty: "node.editing",
  saving: "node.saving",
  conflict: "node.conflict",
  error: "node.saveFailed",
};
const GRADIENTS = ["gradient-1", "gradient-2", "gradient-3", "gradient-4", "gradient-5", "gradient-6"];
const EMOJIS =
  "📄📝📌📎📚📖🧠💡🔬🧪⚙️🛠️🧩🗂️📁🗃️📊📈🎯✅🚀⭐🔥🌱🌍🏠💼🎓🎨🎵🎬📷✈️🗺️🕰️⏳🔒🔑💬❓❗🧭🔗🧱🌀◈◇".match(/\p{Extended_Pictographic}️?|[◈◇]/gu) ?? [];

export interface NodeViewProps {
  id: string;
  nodes: NodeMeta[];
  changeTick: number;
  onNavigate: (id: string) => void;
  onOpenPath: (path: string) => void;
  onChanged: () => void;
  onTrash: (node: NodeMeta) => void;
  onToast: (msg: string) => void;
  onGone: () => void;
  /** Nularche AI'a bağlam: açık Node ve seçili metin. */
  onContext: (ctx: { nodeId: string; nodeTitle: string; selection?: string }) => void;
  onOpenAI: () => void;
}

export function NodeView(props: NodeViewProps) {
  const { id, nodes } = props;
  const [doc, setDoc] = useState<NodeDoc | null>(null);
  const [version, setVersion] = useState(0);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<Status>("saved");
  const [error, setError] = useState<string | null>(null);
  const [backlinks, setBacklinks] = useState<NodeMeta[]>([]);
  const [menu, setMenu] = useState<"icon" | "more" | null>(null);

  const revision = useRef<string | null>(null);
  const pending = useRef<{ body?: string; title?: string }>({});
  const timer = useRef<number | undefined>(undefined);
  const statusRef = useRef<Status>("saved");
  statusRef.current = status;
  const propsRef = useRef(props);
  propsRef.current = props;
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const focusedNew = useRef(false);

  const load = useCallback((n: NodeDoc) => {
    revision.current = n.revision;
    pending.current = {};
    setDoc(n);
    setTitle(n.title);
    setVersion((v) => v + 1);
    setStatus("saved");
  }, []);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const patch = pending.current;
    if (patch.body === undefined && patch.title === undefined) return;
    pending.current = {};
    setStatus("saving");
    try {
      const saved = await api.update(id, { ...patch, baseRevision: revision.current ?? undefined });
      revision.current = saved.revision;
      setDoc((d) => (d ? { ...d, path: saved.path, title: saved.title } : d));
      setStatus(pending.current.body !== undefined || pending.current.title !== undefined ? "dirty" : "saved");
      if (patch.title !== undefined) propsRef.current.onChanged();
    } catch (e) {
      pending.current = { ...patch, ...pending.current };
      if (e instanceof ApiError && e.code === "conflict") setStatus("conflict");
      else {
        setStatus("error");
        setError((e as Error).message);
      }
    }
  }, [id]);

  const schedule = useCallback(
    (patch: { body?: string; title?: string }) => {
      pending.current = { ...pending.current, ...patch };
      if (statusRef.current === "conflict") return;
      setStatus("dirty");
      clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
    },
    [flush],
  );

  const setFields = useCallback(
    async (fields: PageFieldPatch) => {
      await flush();
      try {
        const saved = await api.update(id, { fields, baseRevision: revision.current ?? undefined });
        revision.current = saved.revision;
        setDoc((d) => (d ? { ...d, ...saved, body: d.body } : d));
        propsRef.current.onChanged();
      } catch (e) {
        if (e instanceof ApiError && e.code === "conflict") setStatus("conflict");
        else setError((e as Error).message);
      }
    },
    [id, flush],
  );

  // Yükle; ayrılırken bekleyen değişiklikleri kaydet.
  useEffect(() => {
    let cancelled = false;
    api
      .read(id)
      .then((n) => !cancelled && load(n))
      .catch(() => !cancelled && propsRef.current.onGone());
    api.backlinks(id).then(
      (b) => !cancelled && setBacklinks(b),
      () => undefined,
    );
    const onHide = () => void flush();
    addEventListener("pagehide", onHide);
    return () => {
      cancelled = true;
      removeEventListener("pagehide", onHide);
      void flush();
    };
  }, [id, load, flush]);

  // Origin dışarıdan değişince (ör. Claude MCP ile) bu Node'u yenile.
  useEffect(() => {
    if (props.changeTick === 0) return;
    api.backlinks(id).then(setBacklinks, () => undefined);
    api
      .read(id)
      .then((fresh) => {
        if (fresh.revision === revision.current) return;
        if (statusRef.current === "saved") load(fresh);
        else if (statusRef.current !== "saving") setStatus("conflict");
      })
      .catch(() => propsRef.current.onGone());
  }, [props.changeTick, id, load]);

  // Nularche AI'a açık Node'u bildir.
  useEffect(() => {
    if (doc) propsRef.current.onContext({ nodeId: doc.id, nodeTitle: title || doc.title });
  }, [doc?.id, title]); // eslint-disable-line react-hooks/exhaustive-deps

  // Uzun başlıklar kesilmesin: başlık alanı içeriğe göre satır kaydırır ve yüksekliği büyür.
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [title, doc?.id]);
  useEffect(() => {
    const onResize = () => {
      const el = titleRef.current;
      if (el) {
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
      }
    };
    addEventListener("resize", onResize);
    return () => removeEventListener("resize", onResize);
  }, []);

  // Yeni oluşturulmuş (adsız) Node açıldığında başlık seçili gelsin.
  useEffect(() => {
    if (!doc || focusedNew.current) return;
    focusedNew.current = true;
    if (["Adsız", "Untitled"].includes(doc.title) && doc.body.trim() === "" && Date.now() - doc.createdAt < 15_000) {
      titleRef.current?.focus();
      titleRef.current?.select();
    }
  }, [doc]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flush();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [flush]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const ancestors = useMemo(() => {
    const out: NodeMeta[] = [];
    let cur = byId.get(id);
    while (cur?.parentNodeId) {
      cur = byId.get(cur.parentNodeId);
      if (cur) out.unshift(cur);
    }
    return out;
  }, [byId, id]);

  async function resolveConflict(keepMine: boolean) {
    const fresh = await api.read(id);
    if (keepMine) {
      revision.current = fresh.revision;
      setStatus("dirty");
      await flush();
    } else load(fresh);
  }

  async function createChild(childTitle: string) {
    await flush();
    try {
      const child = await api.create(childTitle, id);
      propsRef.current.onChanged();
      return child;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }

  async function createDatabase(dbTitle: string) {
    await flush();
    try {
      const n = await api.create(dbTitle, id, "", { database: freshDatabase() });
      propsRef.current.onChanged();
      return n;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }

  async function uploadCover() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f || !doc) return;
      const { path } = await api.upload(f);
      // Kapak, Node'a göre göreli yol olarak saklanır (bağlantılarla aynı kural).
      const depth = doc.path.split("/").length - 1;
      await setFields({ cover: `${"../".repeat(depth)}${path}` });
    };
    input.click();
  }

  if (!doc) return <div className="page" />;

  const isShadow = byId.get(id)?.archeId === null;
  const selfMeta = byId.get(id);
  const parentDb = doc.parentNodeId ? byId.get(doc.parentNodeId) : undefined;
  const cover = doc.cover;
  const coverStyle =
    cover && !GRADIENTS.includes(cover)
      ? { backgroundImage: `url("${/^https?:/.test(cover) ? cover : fileUrl(resolveRelative(doc.path, cover) ?? cover)}")` }
      : undefined;

  return (
    <>
      <div className="topbar">
        <div className="crumbs">
          {isShadow && (
            <span>
              <a onClick={() => (location.hash = "shadow")}>Shadow</a> /{" "}
            </span>
          )}
          {ancestors.map((a) => (
            <span key={a.id}>
              <a onClick={() => props.onNavigate(a.id)}>
                {a.icon ? `${a.icon} ` : ""}
                {a.title}
              </a>{" "}
              /{" "}
            </span>
          ))}
          <span>{title || t("common.untitled")}</span>
        </div>
        <div className="topbar-right">
          <span className={`status ${status}`}>{t(STATUS_KEY[status])}</span>
          <button className="claude-btn" onClick={props.onOpenAI} title={t("node.openAi")}>
            <NularcheMark size={15} /> Nularche AI
          </button>
          <button
            className={`icon-btn ${doc.favorite ? "on" : ""}`}
            title={doc.favorite ? t("node.unfavorite") : t("node.favorite")}
            onClick={() => setFields({ favorite: doc.favorite ? null : true })}
          >
            {doc.favorite ? "★" : "☆"}
          </button>
          <div className="rel">
            <button className="icon-btn" title={t("node.more")} onClick={() => setMenu(menu === "more" ? null : "more")}>
              ⋯
            </button>
            {menu === "more" && (
              <div className="menu-pop" onMouseLeave={() => setMenu(null)}>
                {!isShadow && (
                  <button
                    onClick={async () => {
                      setMenu(null);
                      await flush();
                      await api.move(id, SHADOW);
                      props.onChanged();
                    }}
                  >
                    ◐ {t("node.moveToShadow")}
                  </button>
                )}
                {isShadow && (
                  <button
                    onClick={async () => {
                      setMenu(null);
                      await flush();
                      await api.move(id, null);
                      props.onChanged();
                      props.onToast(t("node.nowArche"));
                    }}
                  >
                    ◈ {t("node.makeArche")}
                  </button>
                )}
                <button
                  onClick={async () => {
                    setMenu(null);
                    await flush();
                    const copy = await api.duplicate(id, { title: `${title || doc.title} (${t("node.copy")})` });
                    props.onChanged();
                    props.onNavigate(copy.id);
                  }}
                >
                  ⧉ {t("node.duplicate")}
                </button>
                <button
                  onClick={async () => {
                    setMenu(null);
                    await setFields({ template: doc.template ? null : true });
                    props.onToast(doc.template ? t("tpl.unmarked") : t("tpl.marked"));
                  }}
                >
                  📋 {doc.template ? t("tpl.unmark") : t("tpl.mark")}
                </button>
                {!doc.database && (
                  <button
                    onClick={async () => {
                      setMenu(null);
                      await setFields({ database: freshDatabase() });
                      props.onToast(t("db.turnedInto"));
                    }}
                  >
                    ▦ {t("db.turnInto")}
                  </button>
                )}
                <hr />
                {(
                  [
                    ["md", "⇩", t("export.md")],
                    ["html", "⇩", t("export.html")],
                  ] as [ExportKind, string, string][]
                ).map(([kind, icon, label]) => (
                  <button
                    key={kind}
                    onClick={async () => {
                      setMenu(null);
                      await flush();
                      try {
                        const out = await exportNode(kind, id);
                        if (out) props.onToast(out === "downloaded" ? t("export.downloaded") : t("export.saved", { path: out }));
                      } catch (e) {
                        props.onToast((e as Error).message);
                      }
                    }}
                  >
                    {icon} {label}
                  </button>
                ))}
                <button
                  onClick={async () => {
                    setMenu(null);
                    await setFields({ publish: doc.publish ? null : true });
                    props.onToast(doc.publish ? t("export.unpublished") : t("export.published"));
                  }}
                >
                  🌐 {doc.publish ? t("export.unpublish") : t("export.publish")}
                </button>
                {desktop && (
                  <button
                    onClick={async () => {
                      setMenu(null);
                      await flush();
                      const out = await desktop!.printPdf(title || doc.title);
                      if (out) props.onToast(t("node.pdfSaved", { path: out }));
                    }}
                  >
                    ⎙ {t("node.savePdf")}
                  </button>
                )}
                {desktop && (
                  <button
                    onClick={async () => {
                      setMenu(null);
                      await flush();
                      const out = await desktop!.exportArchive(id, "nlc");
                      if (out) props.onToast(t("node.exported", { path: out }));
                    }}
                  >
                    ⇪ {t("node.exportNlc")}
                  </button>
                )}
                <hr />
                <button
                  className="danger"
                  onClick={() => {
                    setMenu(null);
                    const meta = byId.get(id);
                    if (meta) props.onTrash(meta);
                  }}
                >
                  🗑 {t("common.moveToTrash")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {doc.template && <div className="banner template-banner">📋 {parentDb?.database ? t("tpl.rowBanner") : t("tpl.banner")}</div>}
      {status === "conflict" && (
        <div className="banner conflict">
          {t("node.conflictBanner")}
          <button onClick={() => resolveConflict(false)}>{t("node.loadNew")}</button>
          <button onClick={() => resolveConflict(true)}>{t("node.keepMine")}</button>
        </div>
      )}
      {error && (
        <div className="banner error" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      {cover && (
        <div className={`cover ${GRADIENTS.includes(cover) ? cover : ""}`} style={coverStyle}>
          <div className="cover-actions">
            <button onClick={() => setFields({ cover: GRADIENTS[(GRADIENTS.indexOf(cover) + 1) % GRADIENTS.length] })}>{t("node.changeColor")}</button>
            <button onClick={uploadCover}>{t("node.uploadImage")}</button>
            <button onClick={() => setFields({ cover: null })}>{t("common.remove")}</button>
          </div>
        </div>
      )}

      <article className={`page ${cover ? "has-cover" : ""} ${doc.database ? "wide" : ""}`}>
        {doc.icon && (
          <div className="rel">
            <span className="page-icon" onClick={() => setMenu(menu === "icon" ? null : "icon")} title={t("node.changeIcon")}>
              {doc.icon}
            </span>
          </div>
        )}
        <div className="page-meta-actions">
          {!doc.icon && <button onClick={() => setMenu("icon")}>☺ {t("node.addIcon")}</button>}
          {!cover && <button onClick={() => setFields({ cover: GRADIENTS[Math.floor(Math.random() * GRADIENTS.length)] })}>▭ {t("node.addCover")}</button>}
        </div>
        {menu === "icon" && (
          <div className="pop anchored" style={{ top: doc.icon ? 80 : 70 }} onMouseLeave={() => setMenu(null)}>
            <div className="emoji-grid">
              {EMOJIS.map((em) => (
                <button key={em} onClick={() => (setMenu(null), setFields({ icon: em }))}>
                  {em}
                </button>
              ))}
            </div>
            {doc.icon && (
              <div className="row" style={{ padding: 4 }}>
                <button className="secondary" onClick={() => (setMenu(null), setFields({ icon: null }))}>
                  {t("node.removeIcon")}
                </button>
              </div>
            )}
          </div>
        )}
        <textarea
          ref={titleRef}
          className="title-input"
          rows={1}
          value={title}
          placeholder={t("common.untitled")}
          onChange={(e) => {
            // Başlık tek satırlık bir metindir; yapıştırılan satır sonları boşluğa çevrilir.
            const value = e.target.value.replace(/\s*\n\s*/g, " ");
            setTitle(value);
            if (value.trim()) schedule({ title: value });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              document.querySelector<HTMLElement>(".ProseMirror")?.focus();
            }
          }}
        />
        {parentDb?.database && selfMeta && (
          <RowProperties
            row={{ ...selfMeta, props: doc.props }}
            dbNode={parentDb}
            nodes={nodes}
            setRowProps={(p) => setFields({ props: p })}
            onChanged={props.onChanged}
            onNavigate={props.onNavigate}
            onToast={props.onToast}
          />
        )}
        {doc.database && selfMeta && (
          <DatabaseView
            dbNode={{ ...selfMeta, database: doc.database }}
            nodes={nodes}
            onChanged={props.onChanged}
            onNavigate={props.onNavigate}
            onToast={props.onToast}
            saveSchema={(db) => setFields({ database: serializeDatabase(db) })}
          />
        )}
        <DatabaseHostContext.Provider value={{ nodes, onChanged: props.onChanged, onNavigate: props.onNavigate, onToast: props.onToast }}>
        <Editor
          docKey={`${doc.id}:${version}`}
          markdown={doc.body}
          nodePath={doc.path}
          nodes={nodes}
          currentId={id}
          onChange={(body) => schedule({ body })}
          onOpenPath={(p) => (void flush(), props.onOpenPath(p))}
          onCreateChild={createChild}
          onCreateDatabase={createDatabase}
          onError={setError}
          onSelectionText={(sel) => props.onContext({ nodeId: id, nodeTitle: title || doc.title, selection: sel })}
        />
        </DatabaseHostContext.Provider>
        {backlinks.length > 0 && (
          <section className="backlinks">
            <h4>{t("node.backlinks")} · {backlinks.length}</h4>
            {backlinks.map((b) => (
              <button key={b.id} onClick={() => props.onNavigate(b.id)}>
                {b.icon ?? "◇"} {b.title}
              </button>
            ))}
          </section>
        )}
      </article>
    </>
  );
}
