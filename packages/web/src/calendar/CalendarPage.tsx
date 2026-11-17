// Takvim ekranı: bağlı Google/Apple takvimleri ve tarih özelliği olan Nularche veritabanlarının etkinlikleri
// Ay, Hafta ve Ajanda görünümlerinde. Etkinliğe tıklamak satırı açar; boş güne/saate tıklamak yeni etkinlik oluşturur.
// Bağlı bir takvime eklenen etkinlik masaüstü eşitlemesiyle Google/Apple'a gider.

import { useEffect, useMemo, useRef, useState } from "react";
import { api, type NodeMeta } from "../api.ts";
import { desktop } from "../desktop.ts";
import { locale, t } from "../i18n/index.ts";
import { setPref, usePref } from "../prefs.ts";
import { runCommand } from "../commands.ts";
import { Icon } from "../ui/Icon.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { useEscape } from "../useEscape.ts";
import { useCalendarStatus, calendarDatabase } from "./CalendarSync.tsx";
import { addDays, calendarEvents, calendarSources, dayStart, eventsOn, eventValue, isoDay, layoutDay, weekStart, type CalEvent, type CalSource } from "./calendar-model.ts";

type ViewMode = "month" | "week" | "agenda";
const HOUR_PX = 44;

const time = (ms: number) => new Date(ms).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });

export function CalendarPage({ nodes, onOpen, onChanged, onToast }: { nodes: NodeMeta[]; onOpen: (id: string) => void; onChanged: () => void | Promise<void>; onToast: (m: string) => void }) {
  const [status, refreshStatus] = useCalendarStatus();
  const [view, setView] = usePref<ViewMode>("calendarView", "month");
  const [hidden, setHidden] = usePref<string[]>("calendarHidden", []);
  const [cursor, setCursor] = useState(() => dayStart(Date.now()));
  const [draft, setDraft] = useState<{ date: string; allDay: boolean; start?: string; end?: string } | null>(null);
  const [syncing, setSyncing] = useState(false);

  const sources = useMemo(() => calendarSources(nodes, status?.links ?? []), [nodes, status]);
  const visible = useMemo(() => sources.filter((s) => !hidden.includes(s.key)), [sources, hidden]);
  const events = useMemo(() => calendarEvents(nodes, visible), [nodes, visible]);
  const today = dayStart(Date.now());

  const step = (dir: number) => {
    const d = new Date(cursor);
    if (view === "month") d.setMonth(d.getMonth() + dir, 1);
    else d.setDate(d.getDate() + dir * 7);
    setCursor(d.getTime());
  };
  const title =
    view === "week"
      ? `${new Date(weekStart(cursor)).toLocaleDateString(locale(), { day: "numeric", month: "short" })} – ${new Date(addDays(weekStart(cursor), 6)).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" })}`
      : new Date(cursor).toLocaleDateString(locale(), { month: "long", year: "numeric" });

  const sync = async () => {
    if (!desktop) return;
    setSyncing(true);
    const res = await desktop.calendarSync();
    setSyncing(false);
    await refreshStatus();
    onToast(res.ok ? t("cal.synced") : t("cal.syncedWithErrors", { count: res.errors.length }));
  };
  const openSettings = () => (setPref("settingsTab", "calendar"), runCommand("app.settings"));

  return (
    <div className="cal-page">
      <header className="cal-head">
        <h1>
          <Icon name="calendar" size={26} /> {t("cal.page")}
        </h1>
        <div className="cal-tools">
          <div className="cal-nav">
            <button className="icon-btn" onClick={() => step(-1)} aria-label={t("cal.prev")}>
              <Icon name="chevron-right" className="flip" />
            </button>
            <button className="secondary small-btn" onClick={() => setCursor(today)}>
              {t("cal.today")}
            </button>
            <button className="icon-btn" onClick={() => step(1)} aria-label={t("cal.next")}>
              <Icon name="chevron-right" />
            </button>
            <span className={`cal-title ${view === "agenda" ? "" : "cap"}`}>{view === "agenda" ? t("cal.upcoming") : title}</span>
          </div>
          <div className="segmented small">
            {(["month", "week", "agenda"] as ViewMode[]).map((v) => (
              <button key={v} className={view === v ? "on" : ""} onClick={() => setView(v)}>
                {t(`cal.${v}`)}
              </button>
            ))}
          </div>
          <button className="primary small-btn" onClick={() => setDraft({ date: isoDay(Math.max(cursor, today)), allDay: true })}>
            <Icon name="plus" size={15} /> {t("cal.newEvent")}
          </button>
          {desktop && !!status?.links.length && (
            <button className="icon-btn" onClick={() => void sync()} disabled={syncing || status.syncing} title={t("cal.syncNow")}>
              <Icon name="refresh" className={syncing || status.syncing ? "spin" : ""} />
            </button>
          )}
          <button className="icon-btn" onClick={openSettings} title={t("cal.settings")}>
            <Icon name="settings" />
          </button>
        </div>
      </header>

      {sources.length > 0 && (
        <div className="cal-sources">
          {sources.map((s) => (
            <button key={s.key} className={`cal-source ${hidden.includes(s.key) ? "off" : ""}`} onClick={() => setHidden(hidden.includes(s.key) ? hidden.filter((k) => k !== s.key) : [...hidden, s.key])} title={s.kind === "local" ? "Nularche" : t(`cal.provider.${s.kind}`)}>
              <span className="cal-dot" style={{ background: s.color }} />
              {s.name}
              {s.kind !== "local" && <Icon name={s.kind === "google" ? "world" : "calendar"} size={12} />}
            </button>
          ))}
        </div>
      )}

      {!sources.length && <EmptyState icon="calendar" text={t("cal.noSources")} action={<button className="secondary" onClick={openSettings}>{t("cal.settings")}</button>} />}

      {sources.length > 0 && view === "month" && <MonthView cursor={cursor} today={today} events={events} onOpen={onOpen} onNew={(day) => setDraft({ date: isoDay(day), allDay: true })} onMore={(day) => (setCursor(day), setView("week"))} />}
      {sources.length > 0 && view === "week" && <WeekView cursor={cursor} today={today} events={events} onOpen={onOpen} onNew={(day, hour) => setDraft({ date: isoDay(day), allDay: hour === null, start: hour === null ? undefined : `${String(hour).padStart(2, "0")}:00`, end: hour === null ? undefined : `${String(Math.min(23, hour + 1)).padStart(2, "0")}:00` })} />}
      {sources.length > 0 && view === "agenda" && <AgendaView from={today} events={events} onOpen={onOpen} />}

      {draft && (
        <EventDialog
          initial={draft}
          sources={sources}
          onClose={() => setDraft(null)}
          onCreate={async (title, value, source) => {
            let target = source;
            if (!target) {
              // Hiç kaynak yoksa yerel bir takvim veritabanı oluşturulur.
              const db = await api.create(t("cal.localName"), null, "", { database: calendarDatabase() });
              target = { key: `db:${db.id}`, name: db.title, kind: "local", dbId: db.id, dateProp: "date", color: "" };
            }
            await api.create(title || t("cal.untitledEvent"), target.dbId, "", { props: { [target.dateProp]: value } });
            await onChanged();
            setDraft(null);
            if (desktop && target.kind !== "local") void desktop.calendarSync().then(() => refreshStatus());
            onToast(t("cal.created", { calendar: target.name }));
          }}
        />
      )}
    </div>
  );
}

function Chip({ e, onOpen, showTime = true }: { e: CalEvent; onOpen: (id: string) => void; showTime?: boolean }) {
  return (
    <button className={`cal-chip ${e.allDay ? "all-day" : ""}`} style={{ "--c": e.source.color } as React.CSSProperties} onClick={(ev) => (ev.stopPropagation(), onOpen(e.id))} title={`${e.title} · ${e.source.name}`}>
      {!e.allDay && showTime && <span className="cal-time">{time(e.start)}</span>}
      <span className="cal-chip-title">{e.title}</span>
    </button>
  );
}

function MonthView({ cursor, today, events, onOpen, onNew, onMore }: { cursor: number; today: number; events: CalEvent[]; onOpen: (id: string) => void; onNew: (day: number) => void; onMore: (day: number) => void }) {
  const first = new Date(cursor);
  first.setDate(1);
  const start = weekStart(first.getTime());
  const month = first.getMonth();
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const names = Array.from({ length: 7 }, (_, i) => new Date(addDays(start, i)).toLocaleDateString(locale(), { weekday: "short" }));
  return (
    <div className="cal-month">
      {names.map((n) => (
        <div key={n} className="cal-dow">
          {n}
        </div>
      ))}
      {days.map((d) => {
        const list = eventsOn(events, d);
        const out = new Date(d).getMonth() !== month;
        return (
          <div key={d} className={`cal-day ${out ? "out" : ""} ${d === today ? "today" : ""}`} onDoubleClick={() => onNew(d)}>
            <div className="cal-day-head">
              <span className="cal-num">{new Date(d).getDate()}</span>
              <button className="cal-add" onClick={() => onNew(d)} title={t("cal.newEvent")}>
                <Icon name="plus" size={13} />
              </button>
            </div>
            {list.slice(0, 3).map((e) => (
              <Chip key={e.id} e={e} onOpen={onOpen} />
            ))}
            {list.length > 3 && (
              <button className="cal-more" onClick={() => onMore(d)}>
                {t("cal.more", { n: list.length - 3 })}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function WeekView({ cursor, today, events, onOpen, onNew }: { cursor: number; today: number; events: CalEvent[]; onOpen: (id: string) => void; onNew: (day: number, hour: number | null) => void }) {
  const start = weekStart(cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const scroller = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    scroller.current?.scrollTo({ top: HOUR_PX * 7.5 });
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="cal-week">
      <div className="cal-week-head">
        <span />
        {days.map((d) => (
          <div key={d} className={`cal-week-day ${d === today ? "today" : ""}`}>
            <span>{new Date(d).toLocaleDateString(locale(), { weekday: "short" })}</span>
            <b>{new Date(d).getDate()}</b>
          </div>
        ))}
      </div>
      <div className="cal-allday">
        <span className="cal-gutter">{t("cal.allDay")}</span>
        {days.map((d) => (
          <div key={d} className="cal-allday-cell" onDoubleClick={() => onNew(d, null)}>
            {eventsOn(events, d)
              .filter((e) => e.allDay)
              .map((e) => (
                <Chip key={e.id} e={e} onOpen={onOpen} />
              ))}
          </div>
        ))}
      </div>
      <div className="cal-grid" ref={scroller}>
        <div className="cal-hours">
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="cal-hour" style={{ height: HOUR_PX }}>
              {h ? `${String(h).padStart(2, "0")}:00` : ""}
            </div>
          ))}
        </div>
        {days.map((d) => (
          <div key={d} className={`cal-col ${d === today ? "today" : ""}`} style={{ height: HOUR_PX * 24 }} onClick={(e) => {
            if (e.target !== e.currentTarget) return;
            const y = e.nativeEvent.offsetY;
            onNew(d, Math.min(23, Math.floor(y / HOUR_PX)));
          }}>
            {layoutDay(eventsOn(events, d)).map(({ event, lane, lanes }) => {
              const s = Math.max(event.start, d);
              const en = Math.min(event.end, addDays(d, 1));
              const top = ((s - d) / 3_600_000) * HOUR_PX;
              const height = Math.max(20, ((en - s) / 3_600_000) * HOUR_PX - 2);
              return (
                <button key={event.id} className="cal-block" style={{ top, height, left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)`, "--c": event.source.color } as React.CSSProperties} onClick={() => onOpen(event.id)} title={`${event.title} · ${event.source.name}`}>
                  <b>{event.title}</b>
                  <span>
                    {time(event.start)} – {time(event.end)}
                  </span>
                </button>
              );
            })}
            {d === dayStart(now) && <div className="cal-now" style={{ top: ((now - d) / 3_600_000) * HOUR_PX }} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function AgendaView({ from, events, onOpen }: { from: number; events: CalEvent[]; onOpen: (id: string) => void }) {
  const days = Array.from({ length: 60 }, (_, i) => addDays(from, i))
    .map((d) => ({ d, list: eventsOn(events, d) }))
    .filter((x) => x.list.length);
  if (!days.length) return <EmptyState icon="calendar" text={t("cal.agendaEmpty")} />;
  return (
    <div className="cal-agenda">
      {days.map(({ d, list }) => (
        <section key={d}>
          <h3>{new Date(d).toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" })}</h3>
          {list.map((e) => (
            <button key={e.id} className="cal-agenda-row" onClick={() => onOpen(e.id)}>
              <span className="cal-dot" style={{ background: e.source.color }} />
              <span className="cal-agenda-time">{e.allDay ? t("cal.allDay") : `${time(e.start)} – ${time(e.end)}`}</span>
              <span className="grow">{e.title}</span>
              <span className="muted small">{e.source.name}</span>
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}

function EventDialog({ initial, sources, onClose, onCreate }: { initial: { date: string; allDay: boolean; start?: string; end?: string }; sources: CalSource[]; onClose: () => void; onCreate: (title: string, value: { start: string; end?: string }, source: CalSource | null) => Promise<void> }) {
  useEscape(onClose);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(initial.date);
  const [allDay, setAllDay] = useState(initial.allDay);
  const [start, setStart] = useState(initial.start ?? "09:00");
  const [end, setEnd] = useState(initial.end ?? "10:00");
  const [lastSource, setLastSource] = usePref<string>("calendarDefault", "");
  const [sourceKey, setSourceKey] = useState(() => (sources.some((s) => s.key === lastSource) ? lastSource : (sources.find((s) => s.kind !== "local")?.key ?? sources[0]?.key ?? "")));
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setLastSource(sourceKey);
    await onCreate(title.trim(), eventValue({ date, allDay, start, end }), sources.find((s) => s.key === sourceKey) ?? null);
    setBusy(false);
  };
  return (
    <div className="overlay" onMouseDown={onClose}>
      <form className="dialog small-dialog cal-dialog" onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => (e.preventDefault(), void submit())}>
        <h2 className="dialog-title">
          <Icon name="calendar-event" size={20} /> {t("cal.newEvent")}
        </h2>
        <label className="field">
          <span>{t("cal.eventTitle")}</span>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("cal.untitledEvent")} />
        </label>
        <div className="cal-dialog-row">
          <label className="field">
            <span>{t("cal.date")}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          {!allDay && (
            <>
              <label className="field">
                <span>{t("cal.start")}</span>
                <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
              </label>
              <label className="field">
                <span>{t("cal.end")}</span>
                <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
              </label>
            </>
          )}
        </div>
        <label className="check">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> {t("cal.allDay")}
        </label>
        {sources.length > 0 && (
          <label className="field">
            <span>{t("cal.saveTo")}</span>
            <select value={sourceKey} onChange={(e) => setSourceKey(e.target.value)}>
              {sources.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name}
                  {s.kind !== "local" ? ` · ${t(`cal.provider.${s.kind}`)}` : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="dialog-actions">
          <span className="grow" />
          <button type="button" className="secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="primary" disabled={busy || !date}>
            {t("cal.create")}
          </button>
        </div>
      </form>
    </div>
  );
}
