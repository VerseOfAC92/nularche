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
import { modPressed } from "./shortcuts.tsx";
import { RowProperties } from "./database/RowProperties.tsx";
import { DatabaseHostContext } from "./database/InlineDatabase.tsx";
import { freshDatabase, serializeDatabase } from "./database/model.ts";
import { isLockedBody } from "../../core/src/note-text.ts";
import { closeAllLocked, forgetNote, isUnlocked, lockHint, lockNote, onLockChange, resealNote, unlockNote } from "./lock.ts";
import { LockDialog, LockScreen } from "./notes/LockViews.tsx";
import { DEFAULT_FONT_SIZE, FontDialog, fontStack } from "./notes/FontDialog.tsx";
import type { EditorStats } from "./editor/Editor.tsx";
import { getActiveEditor, registerCommand } from "./commands.ts";
import { askText } from "./ask.tsx";
import { rangeMarkdown } from "./editor/text-tools.ts";
import { fromEditorMarkdown, toEditorMarkdown } from "./editor/paths.ts";
import { fillTemplate } from "../../core/src/note-text.ts";
import { headings } from "./editor/notes-extensions.ts";
import { PropertiesBlock } from "./vault/PropertiesBlock.tsx";
import { CanvasView } from "./vault/CanvasView.tsx";
import { Slides } from "./vault/Slides.tsx";
import { NotePicker } from "./vault/Palettes.tsx";
import { pushRecent, usePref } from "./prefs.ts";
import type { MathMode } from "./editor/notes-extensions.ts";

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
  /** Bir #etikete tıklanınca (⌘/Ctrl ile) o etiketin not listesi. */
  onOpenTag?: (tag: string) => void;
  /** [[wiki]] hedefi henüz yoksa bu başlıkla not oluşturup açar. */
  onCreateTitle?: (title: string) => void;
  /** Odak modunda: üst çubuk ve kapak gizlenir. */
  focus?: boolean;
}

/** Sesli okuma (sistem sesleri). */
function speak(text: string): void {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const lang = /[çğışöüÇĞİŞÖÜ]/.test(text) ? "tr-TR" : document.documentElement.lang === "tr" ? "tr-TR" : "en-GB";
  u.lang = lang;
  const voice = speechSynthesis.getVoices().find((v) => v.lang.replace("_", "-").startsWith(lang.slice(0, 2)));
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
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
  /** Kilitli notun açılmış (düz) içeriği; null = kilitli ve kapalı. */
  const [plain, setPlain] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"lock" | "font" | null>(null);
  const [stats, setStats] = useState<EditorStats | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [mathMode] = usePref<MathMode>("mathMode", "suggest");
  const [spellcheck] = usePref<boolean>("spellcheck", true);
  const [showStats] = usePref<boolean>("wordCount", true);
  const [defaultView] = usePref<"edit" | "read">("defaultView", "edit");
  const [propsInDoc] = usePref<"visible" | "hidden">("propertiesInDoc", "visible");
  /** Okuma görünümü (⌘E): editör salt okunur. */
  const [reading, setReading] = useState(defaultView === "read");
  const [propTick, setPropTick] = useState(0);
  const [slides, setSlides] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [templatePick, setTemplatePick] = useState(false);

  const revision = useRef<string | null>(null);
  const pending = useRef<{ body?: string; title?: string }>({});
  const timer = useRef<number | undefined>(undefined);
  const statusRef = useRef<Status>("saved");
  statusRef.current = status;
  const propsRef = useRef(props);
  propsRef.current = props;
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const focusedNew = useRef(false);
  /** Not kilitli mi (kayıtlar şifrelenerek yazılır). */
  const lockedRef = useRef(false);

  const load = useCallback((n: NodeDoc) => {
    revision.current = n.revision;
    pending.current = {};
    if (!(n.locked || isLockedBody(n.body))) setPlain(null);
    else if (!isUnlocked(n.id)) setPlain(null);
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
      if (patch.body !== undefined && lockedRef.current) {
        const sealed = await resealNote(id, patch.body, t("lock.notice"));
        if (sealed === null) throw new Error(t("lock.locked"));
        patch.body = sealed;
      }
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
        // Kaydedilen sayfa esas alınır: kaldırılan alanlar (kapak, simge, yazı tipi…) yanıtta yer almaz, eski değer kalmamalı.
        setDoc((d) => (d ? { ...saved, body: d.body } : d));
        propsRef.current.onChanged();
      } catch (e) {
        if (e instanceof ApiError && e.code === "conflict") setStatus("conflict");
        else setError((e as Error).message);
      }
    },
    [id, flush],
  );

  const setProperties = useCallback(
    async (properties: Record<string, unknown>) => {
      await flush();
      try {
        const saved = await api.update(id, { properties, baseRevision: revision.current ?? undefined });
        revision.current = saved.revision;
        setDoc((d) => (d ? { ...saved, body: d.body } : d));
        propsRef.current.onChanged();
      } catch (e) {
        if (e instanceof ApiError && e.code === "conflict") setStatus("conflict");
        else setError((e as Error).message);
      }
    },
    [id, flush],
  );

  // Okuma görünümünde editör salt okunur olur.
  useEffect(() => {
    const timer = setInterval(() => {
      const e = getActiveEditor();
      if (e && e.isEditable === reading) e.setEditable(!reading);
    }, 300);
    return () => clearInterval(timer);
  }, [reading]);

  /** Seçimi ya da belge aralığını yeni bir nota taşır; yerine yeni nota bağlantı koyar (Obsidian "Note composer"). */
  async function extractRange(from: number, to: number, newTitle: string, contentFrom = from) {
    const e = getActiveEditor();
    const d = docRef.current;
    if (!e || !d) return;
    const md = rangeMarkdown(e, Math.min(contentFrom, to), to);
    await flush();
    try {
      const parent = d.parentNodeId ?? (d.archeId === null ? SHADOW : null);
      const created = await api.create(newTitle, parent);
      await api.update(created.id, { body: fromEditorMarkdown(md, created.path) });
      e.chain().focus().insertContentAt({ from, to }, `[${newTitle.replace(/[[\]]/g, "")}](${fileUrl(created.path)})`, { contentType: "markdown" } as never).run();
      propsRef.current.onChanged();
      propsRef.current.onToast(t("ob.extracted", { title: created.title }));
    } catch (err) {
      setError((err as Error).message);
    }
  }

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

  useEffect(() => pushRecent(id), [id]);

  // "Tüm kilitli notları kapat": açık içeriği bellekten at.
  useEffect(
    () =>
      onLockChange(() => {
        if (lockedRef.current && !isUnlocked(id)) setPlain(null);
      }),
    [id, flush],
  );

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
      if (modPressed(e) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flush();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [flush]);

  const docRef = useRef(doc);
  docRef.current = doc;
  /** Kilitli notun editördeki güncel düz içeriği (kilit kaldırılırken yazılır). */
  const liveBody = useRef<string | null>(null);

  async function exportAs(kind: ExportKind) {
    await flush();
    try {
      const out = await exportNode(kind, id);
      if (out) propsRef.current.onToast(out === "downloaded" ? t("export.downloaded") : t("export.saved", { path: out }));
    } catch (e) {
      propsRef.current.onToast((e as Error).message);
    }
  }

  async function lockWith(password: string, hint: string) {
    await flush();
    const fresh = await api.read(id);
    const sealed = await lockNote(id, password, fresh.body, hint || undefined, t("lock.notice"));
    const saved = await api.update(id, { body: sealed, fields: { locked: true }, baseRevision: fresh.revision });
    revision.current = saved.revision;
    lockedRef.current = true;
    liveBody.current = fresh.body;
    setPlain(fresh.body);
    setDoc({ ...saved, body: fresh.body });
    setVersion((v) => v + 1);
    propsRef.current.onChanged();
    propsRef.current.onToast(t("lock.done"));
  }

  async function removeLock() {
    if (liveBody.current === null || !confirm(t("lock.removeConfirm"))) return;
    await flush();
    const saved = await api.update(id, { body: liveBody.current, fields: { locked: null }, baseRevision: revision.current ?? undefined });
    forgetNote(id);
    lockedRef.current = false;
    load(saved);
    propsRef.current.onChanged();
    propsRef.current.onToast(t("lock.removed"));
  }

  const fontStep = (delta: number) => {
    const cur = docRef.current?.fontSize ?? DEFAULT_FONT_SIZE;
    const next = Math.min(32, Math.max(12, cur + delta));
    void setFields({ fontSize: next === DEFAULT_FONT_SIZE ? null : next });
  };

  // Menü ve kısayol komutları (bu sayfa açıkken).
  useEffect(() => {
    const d = () => docRef.current;
    const offs = [
      registerCommand("note.pin", () => d() && void setFields({ pinned: d()!.pinned ? null : true }).then(() => propsRef.current.onToast(d()!.pinned ? t("cmd.unpin") : t("node.pinned")))),
      registerCommand("note.lightBg", () => d() && void setFields({ lightBg: d()!.lightBg ? null : true })),
      registerCommand("page.sortChecked", () => d() && void setFields({ sortChecked: d()!.sortChecked ? null : true })),
      registerCommand("note.lock", () => {
        if (!d()) return;
        if (lockedRef.current) return void removeLock();
        setDialog("lock");
      }),
      registerCommand("note.closeLocked", () => {
        void flush().then(() => {
          closeAllLocked();
          propsRef.current.onToast(t("lock.closedAll"));
        });
      }),
      registerCommand("font.panel", () => setDialog("font")),
      registerCommand("font.bigger", () => fontStep(1)),
      registerCommand("font.smaller", () => fontStep(-1)),
      registerCommand("note.print", () => void flush().then(() => (desktop ? desktop.print() : window.print()))),
      registerCommand("note.window", () => void flush().then(() => desktop?.openWindow(id))),
      registerCommand("note.export.pdf", () => void flush().then(async () => {
        const out = await desktop?.printPdf(d()?.title ?? "Node");
        if (out) propsRef.current.onToast(t("node.pdfSaved", { path: out }));
        else if (!desktop) window.print();
      })),
      registerCommand("note.export.docx", () => void exportAs("docx")),
      registerCommand("note.export.rtf", () => void exportAs("rtf")),
      registerCommand("note.export.txt", () => void exportAs("txt")),
      registerCommand("note.export.md", () => void exportAs("md")),
      registerCommand("note.export.html", () => void exportAs("html")),
      registerCommand("speech.start", () => {
        const sel = getSelection()?.toString().trim();
        const text = sel || document.querySelector(".page .ProseMirror")?.textContent || "";
        if (!text) return;
        speak(text);
        setSpeaking(true);
      }),
      registerCommand("speech.stop", () => (speechSynthesis.cancel(), setSpeaking(false))),
      registerCommand("note.addProperty", () => setPropTick((x) => x + 1)),
      registerCommand("note.reading", () => setReading((r) => !r)),
      registerCommand("note.slides", () => void flush().then(() => setSlides(true))),
      registerCommand("note.merge", () => setMergeOpen(true)),
      registerCommand("insert.template", () => setTemplatePick(true)),
      registerCommand("note.extract", async () => {
        const e = getActiveEditor();
        if (!e || e.state.selection.empty) return propsRef.current.onToast(t("ob.selectFirst"));
        const { from, to } = e.state.selection;
        const first = e.state.doc.textBetween(from, to, "\n").split("\n")[0].slice(0, 60).trim();
        const name = (await askText(t("ob.extractTitle"), first))?.trim();
        if (name) await extractRange(from, to, name);
      }),
      registerCommand("note.extractHeading", async () => {
        const e = getActiveEditor();
        if (!e) return;
        const top = e.state.selection.$from.depth > 0 ? e.state.selection.$from.before(1) : 0;
        const all = headings(e.state.doc);
        const owner = all.filter((h) => h.pos <= top).pop();
        if (!owner) return propsRef.current.onToast(t("ob.noHeadingHere"));
        const next = all.find((h) => h.pos > owner.pos && h.level <= owner.level);
        const end = next ? next.pos : e.state.doc.content.size;
        await extractRange(owner.pos, end, owner.text.trim() || t("common.untitled"), owner.pos + (e.state.doc.nodeAt(owner.pos)?.nodeSize ?? 0));
      }),
      registerCommand("note.copyPath", async () => {
        const d = docRef.current;
        if (!d) return;
        const root = await desktop?.originPath();
        const text = root ? `${root}/${d.path}` : d.path;
        if (desktop) await desktop.copy(text);
        else await navigator.clipboard.writeText(text);
        propsRef.current.onToast(t("ob.pathCopied"));
      }),
      registerCommand("note.reveal", () => {
        const d = docRef.current;
        if (d && desktop) void desktop.revealPath(d.path);
        else propsRef.current.onToast(t("media.desktopOnly"));
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [id, flush, setFields]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!speaking) return;
    const timer = setInterval(() => !speechSynthesis.speaking && setSpeaking(false), 500);
    return () => clearInterval(timer);
  }, [speaking]);
  useEffect(() => () => speechSynthesis.cancel(), [id]);

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

  const locked = !!doc.locked || isLockedBody(doc.body);
  lockedRef.current = locked;
  const pageStyle = {
    ...(doc.font ? { "--page-font": fontStack(doc.font) } : {}),
    ...(doc.fontSize ? { "--page-font-size": `${doc.fontSize}px` } : {}),
  } as React.CSSProperties;

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
          {locked && plain !== null && (
            <button className="status-pill" title={t("lock.close")} onClick={() => void flush().then(() => (forgetNote(id), setPlain(null)))}>
              🔓 {t("lock.badge")}
            </button>
          )}
          {doc.pinned && <span className="status-pill">📌 {t("node.pinned")}</span>}
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
                <button onClick={() => (setMenu(null), void setFields({ pinned: doc.pinned ? null : true }))}>📌 {doc.pinned ? t("cmd.unpin") : t("cmd.pin")}</button>
                <button onClick={() => (setMenu(null), locked ? void removeLock() : setDialog("lock"))} disabled={locked && plain === null}>
                  🔒 {locked ? t("lock.remove") : t("cmd.lock")}
                </button>
                <button onClick={() => (setMenu(null), setDialog("font"))}>Aa {t("cmd.fontPanel")}</button>
                {doc.cover && <button onClick={() => (setMenu(null), void setFields({ cover: null }))}>▭ {t("node.removeCover")}</button>}
                <button onClick={() => (setMenu(null), void setFields({ lightBg: doc.lightBg ? null : true }))}>
                  ☀ {t("cmd.lightBg")} {doc.lightBg ? "✓" : ""}
                </button>
                <button onClick={() => (setMenu(null), void setFields({ sortChecked: doc.sortChecked ? null : true }))}>
                  ☑ {t("cmd.autoSortChecked")} {doc.sortChecked ? "✓" : ""}
                </button>
                <button
                  onClick={() => {
                    setMenu(null);
                    if (speaking) {
                      speechSynthesis.cancel();
                      setSpeaking(false);
                    } else {
                      const text = document.querySelector(".page .ProseMirror")?.textContent ?? "";
                      if (text) (speak(text), setSpeaking(true));
                    }
                  }}
                >
                  🔊 {speaking ? t("node.stopSpeak") : t("node.speak")}
                </button>
                {desktop && (
                  <button onClick={() => (setMenu(null), void flush().then(() => desktop!.openWindow(id)))}>⧉ {t("cmd.openWindow")}</button>
                )}
                <hr />
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
                    ["docx", "⇩", t("cmd.exportDocx")],
                    ["rtf", "⇩", t("cmd.exportRtf")],
                    ["txt", "⇩", t("cmd.exportTxt")],
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
                <button onClick={() => (setMenu(null), void flush().then(() => (desktop ? desktop.print() : window.print())))}>⎙ {t("cmd.print")}</button>
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

      {dialog === "lock" && <LockDialog onLock={lockWith} onClose={() => setDialog(null)} />}
      {slides && <Slides title={doc.title} body={locked ? (plain ?? "") : doc.body} path={doc.path} onClose={() => setSlides(false)} />}
      {templatePick && (
        <NotePicker
          nodes={nodes.filter((n) => n.template && !n.locked)}
          placeholder={t("ob.templatePlaceholder")}
          onClose={() => setTemplatePick(false)}
          onPick={async (tpl) => {
            const e = getActiveEditor();
            if (!e) return;
            const src = await api.read(tpl.id);
            const md = toEditorMarkdown(fillTemplate(src.body, { title: title || doc.title, now: new Date() }), src.path);
            e.chain().focus().insertContent(md, { contentType: "markdown" } as never).run();
          }}
        />
      )}
      {mergeOpen && (
        <NotePicker
          nodes={nodes.filter((n) => n.id !== id && !n.locked && !n.database)}
          placeholder={t("ob.mergePlaceholder")}
          onClose={() => setMergeOpen(false)}
          onPick={async (target) => {
            if (!confirm(t("ob.mergeConfirm", { from: doc.title, to: target.title }))) return;
            await flush();
            try {
              await api.merge(id, target.id);
              propsRef.current.onChanged();
              propsRef.current.onToast(t("ob.merged", { title: target.title }));
              props.onNavigate(target.id);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
      )}
      {dialog === "font" && <FontDialog font={doc.font} size={doc.fontSize} onChange={(font, size) => void setFields({ font, fontSize: size })} onClose={() => setDialog(null)} />}
      <article className={`page ${reading ? "reading" : ""} ${doc.layoutMode === "canvas" ? "page-canvas" : ""} ${cover ? "has-cover" : ""} ${doc.lightBg ? "page-light" : ""} ${doc.font || doc.fontSize ? "page-typed" : ""}`} style={pageStyle}>
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
        {reading && (
          <button className="status-pill reading-pill" onClick={() => setReading(false)} title={t("ob.readingView")}>
            📖 {t("ob.readingOn")}
          </button>
        )}
        {(propsInDoc !== "hidden" || propTick > 0) && !(locked && plain === null) && (
          <PropertiesBlock properties={doc.properties ?? {}} onChange={(p) => void setProperties(p)} addTick={propTick} readOnly={reading} />
        )}
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
        {locked && plain === null ? (
          <LockScreen
            title={doc.title}
            hint={lockHint(doc.body)}
            onUnlock={async (pw) => {
              const fresh = await api.read(id);
              const text = await unlockNote(id, pw, fresh.body);
              if (text === null) return false;
              revision.current = fresh.revision;
              liveBody.current = text;
              setPlain(text);
              setDoc({ ...fresh, body: fresh.body });
              setVersion((v) => v + 1);
              return true;
            }}
          />
        ) : doc.layoutMode === "canvas" ? (
          <CanvasView key={`${doc.id}:${version}`} body={doc.body} nodes={nodes} onChange={(body) => schedule({ body })} onOpen={(nid) => (void flush(), props.onNavigate(nid))} />
        ) : (
        <DatabaseHostContext.Provider value={{ nodes, onChanged: props.onChanged, onNavigate: props.onNavigate, onToast: props.onToast }}>
        <Editor
          docKey={`${doc.id}:${version}`}
          markdown={locked ? (plain ?? "") : doc.body}
          sortChecked={doc.sortChecked}
          mathMode={mathMode}
          spellcheck={spellcheck}
          onStats={setStats}
          onTagClick={props.onOpenTag}
          onToast={props.onToast}
          nodePath={doc.path}
          nodes={nodes}
          currentId={id}
          onChange={(body) => {
            if (locked) liveBody.current = body;
            schedule({ body });
          }}
          onOpenPath={(p) => (void flush(), props.onOpenPath(p))}
          onCreateChild={createChild}
          onCreateDatabase={createDatabase}
          onCreateNote={props.onCreateTitle}
          onError={setError}
          onSelectionText={(sel) => !locked && props.onContext({ nodeId: id, nodeTitle: title || doc.title, selection: sel })}
        />
        </DatabaseHostContext.Provider>
        )}
        {showStats && stats && !(locked && plain === null) && (
          <div className="word-stats">
            {stats.selWords > 0 || stats.selChars > 0
              ? t("stats.selection", { words: stats.selWords.toLocaleString(), chars: stats.selChars.toLocaleString() })
              : `${t("stats.words", { n: stats.words.toLocaleString() })} · ${t("stats.chars", { n: stats.chars.toLocaleString() })} · ${t("stats.read", { n: Math.max(1, Math.round(stats.words / 200)) })}`}
          </div>
        )}
        {backlinks.length > 0 && (
          <section className="backlinks">
            <h4>{t("node.backlinks")} · {backlinks.length}</h4>
            {backlinks.map((b) => (
              <button key={b.id} data-path={b.path} onClick={() => props.onNavigate(b.id)}>
                {b.icon ?? "◇"} {b.title}
              </button>
            ))}
          </section>
        )}
      </article>
    </>
  );
}
