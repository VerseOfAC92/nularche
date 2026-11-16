// Ana sayfa / proje panosu (2.0): selamlama, kaldığın yerden devam, bugünkü yazma hedefi ve seri, yazma projeleri
// (manuskriptlerin kelime hedefleri), son düzenlenenler, sabitlenenler ve hızlı yakalama.

import { useEffect, useMemo, useState } from "react";
import { api, SHADOW, type NodeMeta, type ParentTarget } from "../api.ts";
import { locale, t, ago } from "../i18n/index.ts";
import { setPref, usePref } from "../prefs.ts";
import { keys } from "../shortcuts.tsx";
import { runCommand } from "../commands.ts";
import { useSessionWords, writingStats } from "./goals.ts";
import { Progress } from "./ui.tsx";
import { smartMatches, type SmartFolder } from "../notes/smart.ts";

const PROJECT_ICON: Record<string, string> = { manuscript: "📕", outline: "🗂", cards: "🗃", wiki: "📚" };

export function Dashboard({
  nodes,
  onOpen,
  onCreate,
  onShadow,
  onToast,
  onChanged,
  onTag,
  smartFolders = [],
  onSmart,
  onNewSmart,
}: {
  nodes: NodeMeta[];
  onOpen: (id: string) => void;
  onCreate: (p: ParentTarget) => void;
  onShadow: () => void;
  onToast: (msg: string) => void;
  onChanged: () => void;
  onTag?: (tag: string) => void;
  smartFolders?: SmartFolder[];
  onSmart?: (id: string) => void;
  onNewSmart?: () => void;
}) {
  const [recent] = usePref<string[]>("recent", []);
  const [log] = usePref<Record<string, number>>("writingLog", {});
  const [dailyGoal] = usePref<number>("dailyGoal", 0);
  const session = useSessionWords();
  const [capture, setCapture] = useState("");
  const [msWords, setMsWords] = useState<Record<string, number>>({});
  const stats = writingStats(log);
  const hour = new Date().getHours();
  const greeting = hour < 5 ? t("ws.goodNight") : hour < 12 ? t("ws.goodMorning") : hour < 18 ? t("ws.goodAfternoon") : t("ws.goodEvening");

  const usable = useMemo(() => nodes.filter((n) => !n.template && !n.database && !(n.parentNodeId && nodes.find((p) => p.id === n.parentNodeId)?.database)), [nodes]);
  const last = recent.map((id) => usable.find((n) => n.id === id)).find(Boolean);
  const edited = [...usable].sort((a, b) => b.updatedAt - a.updatedAt).filter((n) => n.id !== last?.id).slice(0, 8);
  const projects = usable.filter((n) => n.layoutMode in PROJECT_ICON).sort((a, b) => b.updatedAt - a.updatedAt);
  const pinned = usable.filter((n) => n.pinned).slice(0, 8);
  const boards = usable.filter((n) => n.layoutMode === "whiteboard").sort((a, b) => b.updatedAt - a.updatedAt);
  const openTasks = usable.filter((n) => n.todos > n.done).sort((a, b) => b.updatedAt - a.updatedAt);
  const shadow = usable.filter((n) => n.archeId === null).sort((a, b) => b.updatedAt - a.updatedAt);
  const arches = usable.filter((n) => n.parentNodeId === null && n.archeId === n.id);
  const totalWords = usable.reduce((s, n) => s + (n.words || 0), 0);
  const tagCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of usable) for (const tg of n.tags) m.set(tg, (m.get(tg) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 14);
  }, [usable]);
  // Yeniden keşfet: 30 günden uzun süredir açılmamış notlardan, her gün bir başkası.
  const rediscover = useMemo(() => {
    const old = usable.filter((n) => Date.now() - n.updatedAt > 30 * 86_400_000 && n.excerpt);
    if (!old.length) return null;
    const day = Math.floor(Date.now() / 86_400_000);
    return old[day % old.length];
  }, [usable]);
  const smart = useMemo(() => smartFolders.map((f) => ({ f, count: smartMatches(f, usable).length })), [smartFolders, usable]);
  const manuscripts = projects.filter((p) => p.layoutMode === "manuscript");
  const msKey = manuscripts.map((m) => `${m.id}:${m.revision}`).join(",");

  useEffect(() => {
    let alive = true;
    void Promise.all(manuscripts.map((m) => api.manuscript(m.id).then((c) => [m.id, c.words] as const, () => [m.id, 0] as const))).then((pairs) => alive && setMsWords(Object.fromEntries(pairs)));
    return () => {
      alive = false;
    };
  }, [msKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    const text = capture.trim();
    if (!text) return;
    try {
      const res = await api.capture(text);
      setCapture("");
      onChanged();
      onToast("routed" in res ? t("ws.routedTo", { title: res.routed.targetTitle }) : t("shadow.captured"));
    } catch (e) {
      onToast((e as Error).message);
    }
  };

  const max = Math.max(1, ...stats.week);
  return (
    <div className="dashboard">
      <header className="dash-head">
        <div>
          <h1>{greeting}</h1>
          <p className="muted">{new Date().toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
        </div>
        <div className="row">
          <button className="secondary" onClick={() => runCommand("help.glossary")} title={t("gloss.title")}>
            ⓘ {t("gloss.title")}
          </button>
          <button className="secondary" onClick={() => runCommand("daily.today")}>
            📔 {t("ob.dailyToday")}
          </button>
          <button className="secondary" onClick={() => onCreate(SHADOW)}>
            ＋ {t("common.quickNote")}
          </button>
          <button className="secondary" onClick={() => onCreate(null)}>
            ◈ {t("common.newArche")}
          </button>
        </div>
      </header>

      <div className="dash-grid">
        {last && (
          <section className="dash-card continue" onClick={() => onOpen(last.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpen(last.id)}>
            <h3>{t("ws.continueWriting")}</h3>
            <div className="dash-title">
              {last.icon ?? "◇"} {last.title}
            </div>
            {last.excerpt && <p className="muted">{last.excerpt.slice(0, 180)}</p>}
            <span className="muted small">{t("ws.lastEdited", { when: ago(last.updatedAt) })}</span>
          </section>
        )}

        <section className="dash-card">
          <h3>{t("ws.todayWriting")}</h3>
          <div className="dash-big">{stats.today.toLocaleString()}</div>
          <Progress value={stats.today} goal={dailyGoal || undefined} label={dailyGoal ? undefined : t("ws.wordsToday")} />
          <p className="muted small">
            {t("ws.streak", { n: stats.streak })} · {t("ws.sessionWords", { n: session.toLocaleString() })}
          </p>
          <div className="dash-week" aria-label={t("ws.lastSevenDays")}>
            {stats.week.map((w, i) => (
              <span key={i} style={{ height: `${Math.max(4, (w / max) * 100)}%` }} title={w.toLocaleString()} className={i === 6 ? "today" : ""} />
            ))}
          </div>
          {!dailyGoal && (
            <button className="secondary small-btn" onClick={() => (setPref("settingsTab", "writing"), runCommand("app.settings"))}>
              🎯 {t("ws.setDailyGoal")}
            </button>
          )}
        </section>

        <section className="dash-card dash-capture">
          <h3>{t("ws.quickCapture")}</h3>
          <textarea
            value={capture}
            rows={3}
            placeholder={t("ws.capturePlaceholder")}
            onChange={(e) => setCapture(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && (e.preventDefault(), void send())}
          />
          <div className="row">
            <button className="primary small-btn" disabled={!capture.trim()} onClick={() => void send()}>
              {t("ws.capture")} <span className="muted small">{keys("Mod+Enter")}</span>
            </button>
            <button className="secondary small-btn" onClick={onShadow}>
              ◐ Shadow
            </button>
          </div>
          <p className="muted small">{t("ws.captureSyntax")}</p>
        </section>

        <section className="dash-card wide">
          <h3>{t("ws.projects")}</h3>
          {projects.length ? (
            <div className="dash-projects">
              {projects.map((p) => (
                <button key={p.id} className="dash-project" onClick={() => onOpen(p.id)} data-path={p.path}>
                  <span className="dash-project-icon">{p.icon ?? PROJECT_ICON[p.layoutMode]}</span>
                  <span className="grow">
                    <b>{p.title}</b>
                    <span className="muted small">{t(`ws.kind.${p.layoutMode as "manuscript" | "outline" | "cards" | "wiki" | "whiteboard"}`)} · {ago(p.updatedAt)}</span>
                    {p.layoutMode === "manuscript" && <Progress value={msWords[p.id] ?? 0} goal={p.wordGoal} label={t("ws.words", { n: (msWords[p.id] ?? 0).toLocaleString() })} />}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted small">{t("ws.noProjects")}</p>
          )}
          <div className="row">
            <button className="secondary small-btn" onClick={() => runCommand("manuscript.new")}>
              📕 {t("ws.newManuscript")}
            </button>
            <button className="secondary small-btn" onClick={() => runCommand("outline.new")}>
              🗂 {t("ws.newOutline")}
            </button>
            <button className="secondary small-btn" onClick={() => runCommand("cards.new")}>
              🗃 {t("ws.newCards")}
            </button>
            <button className="secondary small-btn" onClick={() => runCommand("wiki.new")}>
              📚 {t("ws.newWiki")}
            </button>
            <button className="secondary small-btn" onClick={() => runCommand("whiteboard.new")} title={`Tabula — ${t("gloss.tabula")}`}>
              🎨 {t("ws.newWhiteboard")}
            </button>
          </div>
        </section>

        <section className="dash-card">
          <h3 title={`Tabula — ${t("gloss.tabula")}`}>🎨 Tabula</h3>
          {boards.length ? (
            <div className="dash-boards">
              {boards.slice(0, 4).map((b) => (
                <button key={b.id} className="dash-board" onClick={() => onOpen(b.id)}>
                  <span className="dash-board-icon">{b.icon ?? "🎨"}</span>
                  <b>{b.title}</b>
                  <span className="muted small">{ago(b.updatedAt)}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted small">{t("gloss.tabula")}</p>
          )}
          <div className="row">
            <button className="secondary small-btn" onClick={() => runCommand("whiteboard.new")}>
              🎨 {t("ws.newWhiteboard")}
            </button>
          </div>
        </section>

        <section className="dash-card dash-smart">
          <h3>⚙︎ {t("smart.title")}</h3>
          {smart.length ? (
            smart.slice(0, 8).map(({ f, count }) => (
              <button key={f.id} className="link-row" onClick={() => onSmart?.(f.id)} title={t("ws.smartNotes", { n: count })}>
                <span>{f.icon ?? "⚙︎"}</span>
                <span className="grow">{f.name}</span>
                <span className="dash-count">{count}</span>
              </button>
            ))
          ) : (
            <p className="muted small">{t("ws.smartEmpty")}</p>
          )}
          <div className="row">
            <button className="secondary small-btn" onClick={() => onNewSmart?.()}>
              ＋ {t("smart.new")}
            </button>
          </div>
        </section>

        <section className="dash-card">
          <h3>☑ {t("ws.openTasks")}</h3>
          {openTasks.slice(0, 6).map((n) => (
            <button key={n.id} className="link-row dash-task" onClick={() => onOpen(n.id)}>
              <span>{n.icon ?? "◇"}</span>
              <span className="grow">{n.title}</span>
              <span className="dash-task-bar" title={`${n.done}/${n.todos}`}>
                <span style={{ width: `${(n.done / n.todos) * 100}%` }} />
              </span>
              <span className="muted small">
                {n.done}/{n.todos}
              </span>
            </button>
          ))}
          {!openTasks.length && <p className="muted small">{t("ws.noOpenTasks")}</p>}
        </section>

        <section className="dash-card">
          <h3 title={t("term.shadow")}>◐ Shadow</h3>
          <div className="dash-big">{shadow.length}</div>
          <p className="muted small">{t(shadow.length ? "ws.shadowWaiting" : "ws.shadowEmpty")}</p>
          {shadow.slice(0, 4).map((n) => (
            <button key={n.id} className="link-row" onClick={() => onOpen(n.id)}>
              <span>{n.icon ?? "◇"}</span> {n.title} <span className="muted small">· {ago(n.updatedAt)}</span>
            </button>
          ))}
          {shadow.length > 0 && (
            <div className="row">
              <button className="secondary small-btn" onClick={onShadow}>
                ◐ {t("ws.openShadow")}
              </button>
            </div>
          )}
        </section>

        <section className="dash-card">
          <h3>⊙ Origin</h3>
          <div className="dash-stats">
            <span>
              <b>{usable.length.toLocaleString()}</b>
              <small>Node</small>
            </span>
            <span>
              <b>{arches.length.toLocaleString()}</b>
              <small>Arche</small>
            </span>
            <span>
              <b>{totalWords.toLocaleString()}</b>
              <small>{t("ws.wordsLabel")}</small>
            </span>
            <span>
              <b>{tagCounts.length ? new Set(usable.flatMap((n) => n.tags)).size : 0}</b>
              <small>{t("ws.tagsLabel")}</small>
            </span>
          </div>
          {tagCounts.length > 0 && (
            <div className="dash-tags">
              {tagCounts.map(([tg, c]) => (
                <button key={tg} className="tag-chip" onClick={() => onTag?.(tg)} title={`${c}`}>
                  #{tg}
                </button>
              ))}
            </div>
          )}
        </section>

        {rediscover && (
          <section className="dash-card continue" onClick={() => onOpen(rediscover.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpen(rediscover.id)}>
            <h3>✧ {t("ws.rediscover")}</h3>
            <div className="dash-title">
              {rediscover.icon ?? "◇"} {rediscover.title}
            </div>
            <p className="muted">{rediscover.excerpt.slice(0, 160)}</p>
            <span className="muted small">{t("ws.lastEdited", { when: ago(rediscover.updatedAt) })}</span>
          </section>
        )}

        <section className="dash-card">
          <h3>{t("ws.recentlyEdited")}</h3>
          {edited.map((n) => (
            <button key={n.id} className="link-row" onClick={() => onOpen(n.id)} data-path={n.path}>
              <span>{n.icon ?? "◇"}</span> {n.title} <span className="muted small">· {ago(n.updatedAt)}</span>
            </button>
          ))}
          {!edited.length && <p className="muted small">{t("list.empty")}</p>}
        </section>

        {pinned.length > 0 && (
          <section className="dash-card">
            <h3>📌 {t("ws.pinned")}</h3>
            {pinned.map((n) => (
              <button key={n.id} className="link-row" onClick={() => onOpen(n.id)} data-path={n.path}>
                <span>{n.icon ?? "◇"}</span> {n.title}
              </button>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
