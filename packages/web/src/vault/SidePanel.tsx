// Sağ kenar paneli: ana hat (başlıklar), bağlantılar (geri, giden, bağlantısız anılışlar), yerel grafik ve dosya geçmişi.
// Obsidian'ın sağ kenar çubuğundaki Outline, Backlinks, Outgoing links, Local graph ve File recovery karşılıkları.

import { useEffect, useState } from "react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { api, type MentionHit, type NodeMeta } from "../api.ts";
import { getActiveEditor } from "../commands.ts";
import { headings } from "../editor/notes-extensions.ts";
import { t, ago } from "../i18n/index.ts";
import { GraphView } from "./GraphView.tsx";

export type PanelTab = "outline" | "links" | "graph" | "history";

export function SidePanel({
  nodeId,
  tab,
  onTab,
  onClose,
  nodes,
  changeTick,
  onOpen,
  onCreateTitle,
  onToast,
}: {
  nodeId: string | null;
  tab: PanelTab;
  onTab: (t: PanelTab) => void;
  onClose: () => void;
  nodes: NodeMeta[];
  changeTick: number;
  onOpen: (id: string) => void;
  onCreateTitle: (title: string) => void;
  onToast: (msg: string) => void;
}) {
  const tabs: [PanelTab, string][] = [
    ["outline", t("ob.outline")],
    ["links", t("ob.links")],
    ["graph", t("ob.localGraph")],
    ["history", t("ob.history")],
  ];
  return (
    <aside className="side-panel">
      <div className="side-panel-tabs">
        {tabs.map(([id, label]) => (
          <button key={id} className={tab === id ? "on" : ""} onClick={() => onTab(id)}>
            {label}
          </button>
        ))}
        <span className="grow" />
        <button className="icon-btn" onClick={onClose} title={t("common.close")}>
          ✕
        </button>
      </div>
      <div className="side-panel-body">
        {!nodeId ? (
          <p className="muted small">{t("ob.panelNoNote")}</p>
        ) : tab === "outline" ? (
          <Outline key={nodeId} />
        ) : tab === "links" ? (
          <Links key={nodeId} id={nodeId} nodes={nodes} changeTick={changeTick} onOpen={onOpen} onCreateTitle={onCreateTitle} onToast={onToast} />
        ) : tab === "graph" ? (
          <GraphView focusId={nodeId} compact changeTick={changeTick} onOpen={onOpen} />
        ) : (
          <History key={nodeId} id={nodeId} changeTick={changeTick} onToast={onToast} />
        )}
      </div>
    </aside>
  );
}

/** Etkin editörün başlıkları; tıklayınca o başlığa gider. */
function Outline() {
  const [items, setItems] = useState<{ pos: number; level: number; text: string }[]>([]);
  useEffect(() => {
    let editor: TiptapEditor | null = null;
    const read = () => {
      const e = getActiveEditor();
      if (e !== editor) {
        editor?.off("update", read);
        editor = e;
        editor?.on("update", read);
      }
      setItems(e ? headings(e.state.doc) : []);
    };
    read();
    // Editör sayfa açıldıktan sonra hazır olur; kısa aralıkla yeniden bağlan.
    const timer = setInterval(read, 1000);
    return () => {
      clearInterval(timer);
      editor?.off("update", read);
    };
  }, []);
  if (!items.length) return <p className="muted small">{t("ob.noHeadings")}</p>;
  const go = (pos: number) => {
    const e = getActiveEditor();
    if (!e) return;
    e.chain().focus().setTextSelection(pos + 1).run();
    (e.view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const min = Math.min(...items.map((i) => i.level));
  return (
    <nav className="outline">
      {items.map((h) => (
        <button key={h.pos} style={{ paddingLeft: 8 + (h.level - min) * 14 }} onClick={() => go(h.pos)}>
          {h.text || "…"}
        </button>
      ))}
    </nav>
  );
}

function Links({
  id,
  nodes,
  changeTick,
  onOpen,
  onCreateTitle,
  onToast,
}: {
  id: string;
  nodes: NodeMeta[];
  changeTick: number;
  onOpen: (id: string) => void;
  onCreateTitle: (title: string) => void;
  onToast: (msg: string) => void;
}) {
  const [back, setBack] = useState<NodeMeta[] | null>(null);
  const [out, setOut] = useState<{ linked: NodeMeta[]; unresolved: string[] } | null>(null);
  const [mentions, setMentions] = useState<MentionHit[] | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    api.backlinks(id).then(setBack, () => setBack([]));
    api.outgoing(id).then(setOut, () => setOut({ linked: [], unresolved: [] }));
    api.mentions(id).then(setMentions, () => setMentions([]));
  }, [id, changeTick, tick]);
  const icon = (n: { id: string }) => nodes.find((x) => x.id === n.id)?.icon ?? "◇";
  const row = (n: NodeMeta) => (
    <button key={n.id} className="link-row" data-path={n.path} onClick={() => onOpen(n.id)}>
      <span>{icon(n)}</span> {n.title}
    </button>
  );
  return (
    <div className="links-panel">
      <h4>
        {t("ob.backlinks")} <span className="muted">{back?.length ?? ""}</span>
      </h4>
      {back?.length ? back.map(row) : <p className="muted small">{t("ob.none")}</p>}
      <h4>
        {t("ob.outgoing")} <span className="muted">{out ? out.linked.length + out.unresolved.length : ""}</span>
      </h4>
      {out?.linked.map(row)}
      {out?.unresolved.map((name) => (
        <button key={`u:${name}`} className="link-row unresolved" onClick={() => onCreateTitle(name)} title={t("ob.createNote", { title: name })}>
          <span>＋</span> {name}
        </button>
      ))}
      {out && !out.linked.length && !out.unresolved.length && <p className="muted small">{t("ob.none")}</p>}
      <h4>
        {t("ob.mentions")} <span className="muted">{mentions?.length ?? ""}</span>
      </h4>
      {mentions?.length ? (
        mentions.map((m) => (
          <div key={m.id} className="mention-row">
            <button className="link-row" data-path={nodes.find((x) => x.id === m.id)?.path} onClick={() => onOpen(m.id)}>
              <span>{icon(m)}</span> {m.title}
            </button>
            <p className="muted small">{m.snippet}</p>
            <button
              className="secondary small-btn"
              onClick={async () => {
                try {
                  await api.linkMention(id, m.id);
                  onToast(t("ob.linked"));
                  setTick((x) => x + 1);
                } catch (e) {
                  onToast((e as Error).message);
                }
              }}
            >
              {t("ob.linkIt")}
            </button>
          </div>
        ))
      ) : (
        <p className="muted small">{t("ob.none")}</p>
      )}
    </div>
  );
}

/** Dosya geçmişi: anlık görüntüler, önizleme ve geri yükleme. */
function History({ id, changeTick, onToast }: { id: string; changeTick: number; onToast: (msg: string) => void }) {
  const [entries, setEntries] = useState<{ at: number; size: number }[] | null>(null);
  const [preview, setPreview] = useState<{ at: number; body: string } | null>(null);
  useEffect(() => {
    api.history(id).then(setEntries, () => setEntries([]));
  }, [id, changeTick]);
  if (!entries) return null;
  if (!entries.length) return <p className="muted small">{t("ob.historyEmpty")}</p>;
  return (
    <div className="history-panel">
      <p className="muted small">{t("ob.historyHint")}</p>
      {entries.map((e) => (
        <button key={e.at} className={`link-row ${preview?.at === e.at ? "on" : ""}`} onClick={async () => setPreview({ at: e.at, body: await api.historyBody(id, e.at) })}>
          🕘 {new Date(e.at).toLocaleString()} <span className="muted small">· {ago(e.at)}</span>
        </button>
      ))}
      {preview && (
        <div className="history-preview">
          <pre>{preview.body}</pre>
          <button
            className="primary"
            onClick={async () => {
              if (!confirm(t("ob.restoreConfirm"))) return;
              await api.restoreHistory(id, preview.at);
              onToast(t("ob.restored"));
              setPreview(null);
            }}
          >
            {t("ob.restore")}
          </button>
        </div>
      )}
    </div>
  );
}
