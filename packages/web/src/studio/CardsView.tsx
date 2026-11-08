// Kart destesi (2.0): sahneler ve fikirler için gruplar halinde dizin kartları (mantar pano). Kartlar sürüklenerek
// sıralanır ya da başka gruba taşınır; renk etiketi alır, bir nota bağlanabilir ya da nota dönüştürülebilir.

import { useMemo, useState } from "react";
import { api, type NodeMeta } from "../api.ts";
import { t } from "../i18n/index.ts";
import { NotePicker } from "../vault/Palettes.tsx";
import { newWritingId, type IndexCard } from "../../../core/src/writing.ts";
import { colorOf, moveItem, useWriting } from "./useWriting.ts";
import { ColorDots } from "./ui.tsx";

type Drag = { group: number; index: number } | null;

export function CardsView({
  id,
  body,
  nodes,
  onChange,
  onOpen,
  onChanged,
  onToast,
  onFlush,
}: {
  id: string;
  body: string;
  nodes: NodeMeta[];
  onChange: (body: string) => void;
  onOpen: (id: string) => void;
  onChanged: () => void;
  onToast: (msg: string) => void;
  onFlush: () => Promise<void>;
}) {
  const { data, update, broken } = useWriting("cards", body, onChange);
  const [drag, setDrag] = useState<Drag>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [titlesOnly, setTitlesOnly] = useState(false);
  const [linkFor, setLinkFor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [colorFor, setColorFor] = useState<string | null>(null);
  const byPath = useMemo(() => new Map(nodes.map((n) => [n.path, n])), [nodes]);

  if (broken) return <p className="banner error">{t("ws.broken")}</p>;

  const q = query.trim().toLocaleLowerCase("tr");
  const matches = (c: IndexCard) => !q || `${c.title} ${c.text}`.toLocaleLowerCase("tr").includes(q);
  const patchCard = (cid: string, p: Partial<IndexCard>) =>
    update((d) => {
      for (const g of d.groups) g.cards = g.cards.map((c) => (c.id === cid ? { ...c, ...p } : c));
      return d;
    });
  const addCard = (gi: number) => {
    const card: IndexCard = { id: newWritingId(), title: "", text: "" };
    update((d) => (d.groups[gi].cards.push(card), d));
    setEditing(card.id);
  };
  const drop = (gi: number, index: number) => {
    if (!drag) return;
    update((d) => {
      const [card] = d.groups[drag.group].cards.splice(drag.index, 1);
      const at = drag.group === gi && drag.index < index ? index - 1 : index;
      d.groups[gi].cards.splice(at, 0, card);
      return d;
    });
    setDrag(null);
  };
  const toNote = async (c: IndexCard) => {
    await onFlush();
    const n = await api.create(c.title.trim() || t("ws.untitledCard"), id, c.text ? `${c.text}\n` : "");
    const fresh = await api.read(n.id);
    patchCard(c.id, { file: fresh.path });
    onChanged();
    onToast(t("ws.noteCreated", { title: n.title }));
  };
  const bulk = (fn: (c: IndexCard) => IndexCard | null) =>
    update((d) => {
      for (const g of d.groups) g.cards = g.cards.flatMap((c) => (selected.has(c.id) ? (fn(c) ?? []) : [c]));
      return d;
    });

  return (
    <div className={`ws-view ws-cards size-${data.size ?? "m"} ${titlesOnly ? "titles-only" : ""}`}>
      <div className="ws-toolbar">
        <input className="ws-search" placeholder={t("ws.searchCards")} value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="muted small">{t("ws.cardCount", { n: data.groups.reduce((n, g) => n + g.cards.length, 0) })}</span>
        <span className="grow" />
        <label className="check small">
          <input type="checkbox" checked={titlesOnly} onChange={(e) => setTitlesOnly(e.target.checked)} /> {t("ws.titlesOnly")}
        </label>
        <div className="segmented small">
          {(["s", "m", "l"] as const).map((s) => (
            <button key={s} className={(data.size ?? "m") === s ? "on" : ""} onClick={() => update((d) => ({ ...d, size: s === "m" ? undefined : s }))}>
              {s.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      {selected.size > 0 && (
        <div className="ws-bulk">
          <span>{t("ws.selected", { n: selected.size })}</span>
          <ColorDots onChange={(c) => bulk((x) => ({ ...x, color: c }))} />
          <button className="secondary small-btn" onClick={() => confirm(t("ws.deleteCardsConfirm", { n: selected.size })) && (bulk(() => null), setSelected(new Set()))}>
            🗑 {t("common.remove")}
          </button>
          <button className="secondary small-btn" onClick={() => setSelected(new Set())}>
            {t("ws.deselect")}
          </button>
        </div>
      )}
      {data.groups.map((g, gi) => (
        <section key={g.id} className="card-group" onDragOver={(e) => drag && e.preventDefault()} onDrop={() => drop(gi, g.cards.length)} style={{ borderTopColor: colorOf(g.color) ?? undefined }}>
          <header>
            <input className="card-group-title" value={g.title} placeholder={t("ws.untitledGroup")} onChange={(e) => update((d) => ((d.groups[gi].title = e.target.value), d))} />
            <span className="muted small">{g.cards.length}</span>
            <div className="rel">
              <button className="icon-btn" title={t("ws.color")} style={{ color: colorOf(g.color) }} onClick={() => setColorFor(colorFor === g.id ? null : g.id)}>
                ●
              </button>
              {colorFor === g.id && (
                <div className="pop anchored right" onMouseLeave={() => setColorFor(null)}>
                  <ColorDots value={g.color} onChange={(c) => (update((d) => ((d.groups[gi].color = c), d)), setColorFor(null))} />
                </div>
              )}
            </div>
            <button className="icon-btn" disabled={gi === 0} onClick={() => update((d) => ({ ...d, groups: moveItem(d.groups, gi, gi - 1) }))} title={t("ws.moveUp")}>
              ↑
            </button>
            <button className="icon-btn" disabled={gi === data.groups.length - 1} onClick={() => update((d) => ({ ...d, groups: moveItem(d.groups, gi, gi + 1) }))} title={t("ws.moveDown")}>
              ↓
            </button>
            {data.groups.length > 1 && (
              <button
                className="icon-btn"
                title={t("ws.deleteGroup")}
                onClick={() => {
                  if (g.cards.length && !confirm(t("ws.deleteGroupConfirm", { n: g.cards.length }))) return;
                  update((d) => {
                    const [gone] = d.groups.splice(gi, 1);
                    d.groups[Math.max(0, gi - 1)].cards.push(...gone.cards);
                    return d;
                  });
                }}
              >
                ✕
              </button>
            )}
          </header>
          <div className="card-grid">
            {g.cards.map((c, ci) => {
              if (!matches(c)) return null;
              const linked = c.file ? byPath.get(c.file) : undefined;
              const isEditing = editing === c.id;
              return (
                <article
                  key={c.id}
                  className={`index-card ${selected.has(c.id) ? "selected" : ""} ${drag?.group === gi && drag.index === ci ? "dragging" : ""}`}
                  style={{ borderTopColor: colorOf(c.color) ?? undefined }}
                  draggable={!isEditing}
                  onDragStart={(e) => (e.dataTransfer.setData("text/plain", c.title), setDrag({ group: gi, index: ci }))}
                  onDragEnd={() => setDrag(null)}
                  onDragOver={(e) => drag && e.preventDefault()}
                  onDrop={(e) => (e.stopPropagation(), drop(gi, ci))}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey) setSelected((s) => (s.has(c.id) ? new Set([...s].filter((x) => x !== c.id)) : new Set([...s, c.id])));
                  }}
                  onDoubleClick={() => setEditing(c.id)}
                >
                  {isEditing ? (
                    <div className="card-edit">
                      <input autoFocus value={c.title} placeholder={t("ws.cardTitle")} onChange={(e) => patchCard(c.id, { title: e.target.value })} onKeyDown={(e) => (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) && setEditing(null)} />
                      <textarea value={c.text} rows={5} placeholder={t("ws.cardText")} onChange={(e) => patchCard(c.id, { text: e.target.value })} onKeyDown={(e) => (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) && setEditing(null)} />
                      <ColorDots value={c.color} onChange={(col) => patchCard(c.id, { color: col })} />
                      <div className="row">
                        <button className="primary small-btn" onClick={() => setEditing(null)}>
                          {t("ws.done")}
                        </button>
                        <button
                          className="secondary small-btn"
                          onClick={() => {
                            const copy = { ...c, id: newWritingId() };
                            update((d) => (d.groups[gi].cards.splice(ci + 1, 0, copy), d));
                          }}
                        >
                          ⧉ {t("ws.duplicate")}
                        </button>
                        <button className="secondary small-btn" onClick={() => (update((d) => (d.groups[gi].cards.splice(ci, 1), d)), setEditing(null))}>
                          🗑
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <h5>{c.title || <span className="muted">{t("ws.untitledCard")}</span>}</h5>
                      {!titlesOnly && c.text && <p>{c.text}</p>}
                      <footer>
                        {linked ? (
                          <a onClick={(e) => (e.stopPropagation(), onOpen(linked.id))} data-path={linked.path}>
                            {linked.icon ?? "📄"} {linked.title}
                          </a>
                        ) : (
                          <span className="card-tools">
                            <button className="icon-btn" title={t("ws.linkNote")} onClick={(e) => (e.stopPropagation(), setLinkFor(c.id))}>
                              🔗
                            </button>
                            <button className="icon-btn" title={t("ws.cardToNote")} onClick={(e) => (e.stopPropagation(), void toNote(c))}>
                              ✎
                            </button>
                          </span>
                        )}
                        <button className="icon-btn" title={t("ws.editCard")} onClick={(e) => (e.stopPropagation(), setEditing(c.id))}>
                          ⋯
                        </button>
                      </footer>
                    </>
                  )}
                </article>
              );
            })}
            <button className="index-card add" onClick={() => addCard(gi)}>
              ＋ {t("ws.newCard")}
            </button>
          </div>
        </section>
      ))}
      <button className="secondary" onClick={() => update((d) => (d.groups.push({ id: newWritingId(), title: "", cards: [] }), d))}>
        ＋ {t("ws.addGroup")}
      </button>
      <p className="muted small ws-hint">{t("ws.cardsHint")}</p>
      {linkFor && (
        <NotePicker nodes={nodes.filter((n) => n.id !== id && !n.database && !n.template)} placeholder={t("ws.pickNote")} onClose={() => setLinkFor(null)} onPick={(n) => patchCard(linkFor, { file: n.path })} />
      )}
    </div>
  );
}
