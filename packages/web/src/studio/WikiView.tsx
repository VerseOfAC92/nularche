// Lore / hikâye kitaplığı (2.0): bir wiki sayfasının alt sayfaları girdilerdir (karakter, mekân, kavram…); alt sayfası
// olan girdiler kategoridir. Her girdinin "hızlı bilgileri" notun özellikleridir (YAML frontmatter).
// Girdinin adı ve takma adları diğer notlarda geçtiğinde altı çizilir ve "Geçtiği yerler" listesinde sayılır.

import { useEffect, useMemo, useState } from "react";
import { api, type NodeMeta, type WikiEntry, type WikiMention } from "../api.ts";
import { askText } from "../ask.tsx";
import { t } from "../i18n/index.ts";

export function WikiView({
  id,
  nodes,
  changeTick,
  onOpen,
  onChanged,
  onToast,
}: {
  id: string;
  nodes: NodeMeta[];
  changeTick: number;
  onOpen: (id: string) => void;
  onChanged: () => void;
  onToast: (msg: string) => void;
}) {
  const [entries, setEntries] = useState<WikiEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [mentions, setMentions] = useState<WikiMention[] | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    api.wiki(id).then(setEntries, () => setEntries([]));
  }, [id, changeTick, tick, nodes.length]);
  const entry = entries?.find((e) => e.id === selected) ?? null;
  useEffect(() => {
    setMentions(null);
    if (selected) api.wikiMentions(selected).then(setMentions, () => setMentions([]));
  }, [selected, changeTick]);

  const q = query.trim().toLocaleLowerCase("tr");
  const visible = useMemo(() => {
    if (!entries) return [];
    if (q) return entries.filter((e) => [e.title, ...e.aliases].some((x) => x.toLocaleLowerCase("tr").includes(q)));
    const hidden = new Set<string>();
    for (const e of entries) if (e.parentNodeId && (collapsed.has(e.parentNodeId) || hidden.has(e.parentNodeId))) hidden.add(e.id);
    return entries.filter((e) => !hidden.has(e.id));
  }, [entries, q, collapsed]);

  const create = async (parent: string, category: boolean) => {
    const title = (await askText(category ? t("ws.newCategoryTitle") : t("ws.newEntryTitle")))?.trim();
    if (!title) return;
    try {
      const n = await api.create(title, parent, "", category ? { icon: "🗂" } : undefined);
      const parentEntry = entries?.find((e) => e.id === parent);
      if (!category && parentEntry?.wikiFields?.length) await api.update(n.id, { properties: Object.fromEntries(parentEntry.wikiFields.map((f) => [f, ""])) });
      onChanged();
      setTick((x) => x + 1);
      setSelected(n.id);
    } catch (e) {
      onToast((e as Error).message);
    }
  };

  const setProps = async (eid: string, properties: Record<string, unknown>) => {
    try {
      await api.update(eid, { properties });
      setTick((x) => x + 1);
      onChanged();
    } catch (e) {
      onToast((e as Error).message);
    }
  };

  const setFieldTemplate = async (e: WikiEntry, fields: string[]) => {
    await api.update(e.id, { fields: { wikiFields: fields.length ? fields : null } });
    setTick((x) => x + 1);
  };

  return (
    <div className="ws-view ws-wiki">
      <div className="wiki-layout">
        <nav className="wiki-index">
          <input className="ws-search" placeholder={t("ws.searchWiki")} value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="row">
            <button className="secondary small-btn" onClick={() => void create(entry?.category ? entry.id : id, false)}>
              ＋ {t("ws.newEntry")}
            </button>
            <button className="secondary small-btn" onClick={() => void create(id, true)}>
              🗂 {t("ws.newCategory")}
            </button>
          </div>
          {entries && !entries.length && <p className="muted small">{t("ws.wikiEmpty")}</p>}
          {visible.map((e) => (
            <button key={e.id} className={`wiki-entry ${selected === e.id ? "on" : ""}`} style={{ paddingLeft: 8 + (q ? 0 : e.depth * 14) }} onClick={() => setSelected(e.id)} onDoubleClick={() => onOpen(e.id)} data-path={e.path}>
              {e.category ? (
                <span
                  className="fold"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setCollapsed((s) => (s.has(e.id) ? new Set([...s].filter((x) => x !== e.id)) : new Set([...s, e.id])));
                  }}
                >
                  {collapsed.has(e.id) ? "▸" : "▾"}
                </span>
              ) : (
                <span className="fold" />
              )}
              <span>{e.icon ?? (e.category ? "🗂" : "◇")}</span> {e.title}
              {e.noMentions && <span className="muted small" title={t("ws.mentionsOff")}> ⊘</span>}
            </button>
          ))}
        </nav>
        <div className="wiki-detail">
          {!entry ? (
            <p className="muted small">{t("ws.wikiPick")}</p>
          ) : (
            <EntryCard
              key={entry.id}
              entry={entry}
              mentions={mentions}
              onOpen={onOpen}
              onProps={(p) => void setProps(entry.id, p)}
              onFields={(f) => void setFieldTemplate(entry, f)}
              onToggleMentions={async () => {
                await api.update(entry.id, { fields: { noMentions: entry.noMentions ? null : true } });
                setTick((x) => x + 1);
                onChanged();
              }}
              onNewChild={() => void create(entry.id, false)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function EntryCard({
  entry,
  mentions,
  onOpen,
  onProps,
  onFields,
  onToggleMentions,
  onNewChild,
}: {
  entry: WikiEntry;
  mentions: WikiMention[] | null;
  onOpen: (id: string) => void;
  onProps: (p: Record<string, unknown>) => void;
  onFields: (fields: string[]) => void;
  onToggleMentions: () => void;
  onNewChild: () => void;
}) {
  const facts = Object.entries(entry.properties).filter(([k]) => k !== "aliases" && k !== "tags");
  const [newFact, setNewFact] = useState("");
  const [newAlias, setNewAlias] = useState("");
  const [newField, setNewField] = useState("");
  const fields = entry.wikiFields ?? [];
  return (
    <article className="wiki-card">
      <header>
        <h3>
          {entry.icon ?? (entry.category ? "🗂" : "◇")} {entry.title}
        </h3>
        <button className="primary small-btn" onClick={() => onOpen(entry.id)}>
          {t("ws.openPage")}
        </button>
      </header>
      <div className="wiki-aliases">
        <span className="muted small">{t("ws.aliases")}</span>
        {entry.aliases.map((a) => (
          <span key={a} className="ws-chip">
            {a}
            <button onClick={() => onProps({ aliases: entry.aliases.filter((x) => x !== a).length ? entry.aliases.filter((x) => x !== a) : null })} aria-label={t("common.remove")}>
              ×
            </button>
          </span>
        ))}
        <input
          className="ws-chip-input"
          value={newAlias}
          placeholder={t("ws.addAlias")}
          onChange={(e) => setNewAlias(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newAlias.trim()) {
              onProps({ aliases: [...new Set([...entry.aliases, newAlias.trim()])] });
              setNewAlias("");
            }
          }}
        />
      </div>
      <table className="wiki-facts" aria-label={t("ws.quickFacts")}>
        <caption>{t("ws.quickFacts")}</caption>
        <tbody>
          {facts.map(([k, v]) => (
            <tr key={k}>
              <th>{k}</th>
              <td>
                <input defaultValue={Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v)} onBlur={(e) => e.target.value !== String(v ?? "") && onProps({ [k]: e.target.value })} />
              </td>
              <td>
                <button className="icon-btn" title={t("common.remove")} onClick={() => onProps({ [k]: null })}>
                  ×
                </button>
              </td>
            </tr>
          ))}
          <tr>
            <td colSpan={3}>
              <input
                value={newFact}
                placeholder={t("ws.addFact")}
                onChange={(e) => setNewFact(e.target.value)}
                onKeyDown={(e) => {
                  const k = newFact.trim();
                  if (e.key === "Enter" && k && !/[:#\n]/.test(k)) (onProps({ [k]: "" }), setNewFact(""));
                }}
              />
            </td>
          </tr>
        </tbody>
      </table>
      {entry.excerpt && <p className="wiki-excerpt">{entry.excerpt}</p>}
      {entry.category && (
        <div className="wiki-fields">
          <span className="muted small">{t("ws.fieldTemplate")}</span>
          {fields.map((f) => (
            <span key={f} className="ws-chip">
              {f}
              <button onClick={() => onFields(fields.filter((x) => x !== f))} aria-label={t("common.remove")}>
                ×
              </button>
            </span>
          ))}
          <input
            className="ws-chip-input"
            value={newField}
            placeholder={t("ws.addField")}
            onChange={(e) => setNewField(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newField.trim()) (onFields([...new Set([...fields, newField.trim()])]), setNewField(""));
            }}
          />
          <button className="secondary small-btn" onClick={onNewChild}>
            ＋ {t("ws.newEntryHere")}
          </button>
        </div>
      )}
      <label className="check small">
        <input type="checkbox" checked={!entry.noMentions} onChange={onToggleMentions} /> {t("ws.detectMentions")}
      </label>
      <h4>
        {t("ws.mentionedIn")} <span className="muted">{mentions ? mentions.reduce((n, m) => n + m.count, 0) : ""}</span>
      </h4>
      {mentions === null ? null : mentions.length ? (
        mentions.map((m) => (
          <div key={m.id} className="mention-row">
            <button className="link-row" onClick={() => onOpen(m.id)}>
              ◇ {m.title} <span className="muted small">× {m.count}</span>
            </button>
            <p className="muted small">{m.snippet}</p>
          </div>
        ))
      ) : (
        <p className="muted small">{t("ws.noMentions")}</p>
      )}
    </article>
  );
}
