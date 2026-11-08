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

const PROJECT_ICON: Record<string, string> = { manuscript: "📕", outline: "🗂", cards: "🗃", wiki: "📚" };

export function Dashboard({
  nodes,
  onOpen,
  onCreate,
  onShadow,
  onToast,
  onChanged,
}: {
  nodes: NodeMeta[];
  onOpen: (id: string) => void;
  onCreate: (p: ParentTarget) => void;
  onShadow: () => void;
  onToast: (msg: string) => void;
  onChanged: () => void;
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
                    <span className="muted small">{t(`ws.kind.${p.layoutMode as "manuscript" | "outline" | "cards" | "wiki"}`)} · {ago(p.updatedAt)}</span>
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
          </div>
        </section>

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
