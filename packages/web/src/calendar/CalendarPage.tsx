// Takvim ekranı: yerel Nularche takvimi, Ayarlar'da açılan Google/Apple takvimleri ve tarih özelliği olan Nularche
// veritabanlarının etkinlikleri Ay, Hafta ve Ajanda görünümlerinde. Takvim etkinlikleri not oluşturmaz: tıklayınca
// tüm ayrıntılarıyla (konum, toplantı bağlantısı, katılımcılar, hatırlatma, notlar) açılır; düzenleme doğrudan takvime
// yazılır. Veritabanı satırına tıklamak satırı açar.

import { cleanVigils, upcomingRuns, type Vigil } from "../../../core/src/vigil-schedule.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type NodeMeta } from "../api.ts";
import { desktop, type ViewCalendar } from "../desktop.ts";
import { locale, t } from "../i18n/index.ts";
import { setPref, usePref } from "../prefs.ts";
import { runCommand } from "../commands.ts";
import { Icon } from "../ui/Icon.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { useEscape } from "../useEscape.ts";
import { errorText, useCalendarStatus } from "./CalendarSync.tsx";
import { alarmLabel, EventDetail } from "./EventDetail.tsx";
import { addDays, calendarEvents, calendarSources, dayStart, eventsOn, eventTime, eventValue, isoDay, layoutDay, weekStart, type CalEvent, type CalSource } from "./calendar-model.ts";

type ViewMode = "month" | "week" | "agenda";
const HOUR_PX = 44;

const time = (ms: number) => new Date(ms).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });

export function CalendarPage({ nodes, onOpen, onChanged, onToast }: { nodes: NodeMeta[]; onOpen: (id: string) => void; onChanged: () => void | Promise<void>; onToast: (m: string) => void }) {
  const [status, refreshStatus] = useCalendarStatus();
  const [view, setView] = usePref<ViewMode>("calendarView", "month");
  const [hidden, setHidden] = usePref<string[]>("calendarHidden", []);
  const [cursor, setCursor] = useState(() => dayStart(Date.now()));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [detail, setDetail] = useState<CalEvent | null>(null);
  const [syncing, setSyncing] = useState(false);
  // Not dışı takvimler (yerel Nularche takvimi ve görüntülenen hesap takvimleri); masaüstü uygulamasında.
  const [views, setViews] = useState<ViewCalendar[]>([]);
  useEffect(() => {
    if (!desktop) return;
    const load = () => void desktop!.calendarEvents().then((r) => setViews(r.calendars), () => undefined);
    load();
    return desktop.onCalendarSynced(load);
  }, []);

  const sources = useMemo(() => calendarSources(nodes, status?.links ?? [], views), [nodes, status, views]);
  const visible = useMemo(() => sources.filter((s) => !hidden.includes(s.key)), [sources, hidden]);
  // Vigil otomasyonlarının önümüzdeki çalışmaları da (salt okunur) takvimde görünür.
  const [vigilsRaw] = usePref<unknown>("vigils", []);
  const events = useMemo(() => [...calendarEvents(nodes, visible, views), ...vigilEvents(cleanVigils(vigilsRaw))], [nodes, visible, views, vigilsRaw]);
  // Takvim etkinliği ayrıntılarıyla açılır; veritabanı satırı not olarak açılır.
  const pick = (e: CalEvent) => (e.source.key === VIGIL_SOURCE.key ? (setPref("settingsTab", "automation"), void runCommand("app.settings")) : e.view ? setDetail(e) : onOpen(e.id));
  const edit = (e: CalEvent) => {
    const hm = (ms: number) => new Date(ms).toTimeString().slice(0, 5);
    setDetail(null);
    setDraft({ date: isoDay(e.start), allDay: e.allDay, start: e.allDay ? undefined : hm(e.start), end: e.allDay ? undefined : hm(e.end), edit: e });
  };
  const remove = async (e: CalEvent) => {
    const view = e.source.type === "view" ? e.source.viewId : null;
    if (!desktop || !view || !e.view) return;
    const res = await desktop.calendarEventDelete(view, e.view.id);
    if (!res.ok) return onToast(errorText(res.code, res.error));
    setDraft(null);
    setDetail(null);
    onToast(t("cal.deleted"));
  };
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

      {sources.length > 0 && view === "month" && <MonthView cursor={cursor} today={today} events={events} onOpen={pick} onNew={(day) => setDraft({ date: isoDay(day), allDay: true })} onMore={(day) => (setCursor(day), setView("week"))} />}
      {sources.length > 0 && view === "week" && <WeekView cursor={cursor} today={today} events={events} onOpen={pick} onNew={(day, hour) => setDraft({ date: isoDay(day), allDay: hour === null, start: hour === null ? undefined : `${String(hour).padStart(2, "0")}:00`, end: hour === null ? undefined : `${String(Math.min(23, hour + 1)).padStart(2, "0")}:00` })} />}
      {sources.length > 0 && view === "agenda" && <AgendaView from={today} events={events} onOpen={pick} />}

      {detail && <EventDetail event={detail} onClose={() => setDetail(null)} onEdit={() => edit(detail)} onDelete={() => remove(detail)} />}

      {draft && (
        <EventDialog
          initial={draft}
          sources={sources}
          onClose={() => setDraft(null)}
          onDelete={remove}
          onSave={async (form, source, existing) => {
            if (source?.type === "view" && desktop) {
              // Düzenlemede yalnızca değişen ayrıntılar gönderilir (Google'ın HTML açıklaması gibi alanlar korunur).
              const before = existing?.view;
              const changed = <T,>(next: T, prev: T) => (existing && next === prev ? undefined : next);
              const alarm = form.alarm === "" ? null : Number(form.alarm);
              const res = await desktop.calendarEventSave(source.viewId, before?.id ?? null, {
                title: form.title || t("cal.untitledEvent"),
                when: eventTime(form),
                description: changed(form.description, before?.description ?? ""),
                location: changed(form.location, before?.location ?? ""),
                url: changed(form.url, before?.url ?? ""),
                alarm: existing && alarm === (before?.alarms?.[0] ?? null) ? undefined : alarm,
              });
              if (!res.ok) return onToast(errorText(res.code, res.error));
            } else if (source?.type === "db") {
              await api.create(form.title || t("cal.untitledEvent"), source.dbId, "", { props: { [source.dateProp]: eventValue(form) } });
              await onChanged();
              if (desktop && source.kind !== "local") void desktop.calendarSync().then(() => refreshStatus());
            } else return;
            setDraft(null);
            onToast(existing ? t("cal.saved") : t("cal.created", { calendar: source.name }));
          }}
        />
      )}
    </div>
  );
}

function Chip({ e, onOpen, showTime = true }: { e: CalEvent; onOpen: (e: CalEvent) => void; showTime?: boolean }) {
  return (
    <button className={`cal-chip ${e.allDay ? "all-day" : ""}`} style={{ "--c": e.source.color } as React.CSSProperties} onClick={(ev) => (ev.stopPropagation(), onOpen(e))} title={`${e.title} · ${e.source.name}`}>
      {!e.allDay && showTime && <span className="cal-time">{time(e.start)}</span>}
      <span className="cal-chip-title">{e.title}</span>
    </button>
  );
}

function MonthView({ cursor, today, events, onOpen, onNew, onMore }: { cursor: number; today: number; events: CalEvent[]; onOpen: (e: CalEvent) => void; onNew: (day: number) => void; onMore: (day: number) => void }) {
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

function WeekView({ cursor, today, events, onOpen, onNew }: { cursor: number; today: number; events: CalEvent[]; onOpen: (e: CalEvent) => void; onNew: (day: number, hour: number | null) => void }) {
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
                <button key={event.id} className="cal-block" style={{ top, height, left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)`, "--c": event.source.color } as React.CSSProperties} onClick={() => onOpen(event)} title={`${event.title} · ${event.source.name}`}>
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

function AgendaView({ from, events, onOpen }: { from: number; events: CalEvent[]; onOpen: (e: CalEvent) => void }) {
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
            <button key={e.id} className="cal-agenda-row" onClick={() => onOpen(e)}>
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

type Draft = { date: string; allDay: boolean; start?: string; end?: string; edit?: CalEvent };
type Form = { title: string; date: string; allDay: boolean; start?: string; end?: string; description: string; location: string; url: string; alarm: string };

/** Hatırlatma seçenekleri (başlangıçtan kaç dakika önce). */
const ALARMS = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080];

/** Yeni etkinlik ya da takvim etkinliğini düzenleme. Yinelenen etkinlikler yalnızca görüntülenir (takvim uygulamasında
 *  düzenlenir); veritabanı satırları not olarak açılır, burada düzenlenmez. Katılımcı davet etmek takvim uygulamasının
 *  işidir; burada gösterilir ama değiştirilmez. */
function EventDialog({
  initial,
  sources,
  onClose,
  onSave,
  onDelete,
}: {
  initial: Draft;
  sources: CalSource[];
  onClose: () => void;
  onSave: (form: Form, source: CalSource | null, existing: CalEvent | undefined) => Promise<void>;
  onDelete: (e: CalEvent) => Promise<void>;
}) {
  useEscape(onClose);
  const existing = initial.edit;
  const ev = existing?.view;
  const [title, setTitle] = useState(existing?.title ?? "");
  const [date, setDate] = useState(initial.date);
  const [allDay, setAllDay] = useState(initial.allDay);
  const [start, setStart] = useState(initial.start ?? "09:00");
  const [end, setEnd] = useState(initial.end ?? "10:00");
  const [location, setLocation] = useState(ev?.location ?? "");
  const [url, setUrl] = useState(ev?.url ?? "");
  const [description, setDescription] = useState(ev?.description ?? "");
  const [lastAlarm, setLastAlarm] = usePref<string>("calendarAlarm", "");
  const [alarm, setAlarm] = useState(existing ? String(ev?.alarms?.[0] ?? "") : lastAlarm);
  const [lastSource, setLastSource] = usePref<string>("calendarDefault", "");
  // Yeni etkinlik: önce son kullanılan, sonra bir hesap takvimi, sonra yerel Nularche takvimi.
  const targets = existing ? sources.filter((s) => s.key === existing.source.key) : sources;
  const [sourceKey, setSourceKey] = useState(() =>
    existing ? existing.source.key : targets.some((s) => s.key === lastSource) ? lastSource : (targets.find((s) => s.type === "view" && s.kind !== "local")?.key ?? targets[0]?.key ?? ""),
  );
  const target = sources.find((s) => s.key === sourceKey);
  // Ayrıntılar yalnızca takvimlere yazılır; veritabanı satırının ayrıntıları notun kendisidir.
  const details = target?.type === "view";
  const alarmOptions = [...new Set([...ALARMS, ...(alarm ? [Number(alarm)] : [])])].sort((a, b) => a - b);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    if (!existing) {
      setLastSource(sourceKey);
      setLastAlarm(alarm);
    }
    await onSave({ title: title.trim(), date, allDay, start, end, description, location: location.trim(), url: url.trim(), alarm }, target ?? null, existing);
    setBusy(false);
  };
  return (
    <div className="overlay" onMouseDown={onClose}>
      <form className="dialog small-dialog cal-dialog" onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => (e.preventDefault(), void submit())}>
        <h2 className="dialog-title">
          <Icon name="calendar-event" size={20} /> {existing ? t("cal.editEvent") : t("cal.newEvent")}
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
        {targets.length > 0 && (
          <label className="field">
            <span>{t("cal.saveTo")}</span>
            <select value={sourceKey} disabled={!!existing} onChange={(e) => setSourceKey(e.target.value)}>
              {targets.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name}
                  {s.kind !== "local" ? ` · ${t(`cal.provider.${s.kind}`)}` : s.type === "db" ? ` · ${t("cal.table")}` : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        {details && (
          <>
            <label className="field">
              <span>{t("cal.location")}</span>
              <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t("cal.locationHint")} />
            </label>
            <div className="cal-dialog-row">
              <label className="field grow">
                <span>{t("cal.url")}</span>
                <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
              </label>
              <label className="field">
                <span>{t("cal.alarm")}</span>
                <select value={alarm} onChange={(e) => setAlarm(e.target.value)}>
                  <option value="">{t("cal.alarmNone")}</option>
                  {alarmOptions.map((m) => (
                    <option key={m} value={String(m)}>
                      {alarmLabel(m)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field">
              <span>{t("cal.notes")}</span>
              <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("cal.notesHint")} />
            </label>
          </>
        )}
        <div className="dialog-actions">
          {existing && (
            <button type="button" className="danger" disabled={busy} onClick={() => (setBusy(true), void onDelete(existing).finally(() => setBusy(false)))}>
              <Icon name="trash" size={15} /> {t("cal.delete")}
            </button>
          )}
          <span className="grow" />
          <button type="button" className="secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="primary" disabled={busy || !date}>
            {existing ? t("cal.save") : t("cal.create")}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Vigil'in takvimdeki kaynağı (renkli, salt okunur). */
const VIGIL_SOURCE: CalSource = { key: "vigil", name: "Vigil", kind: "local", type: "view", viewId: "vigil", color: "#a371f7" };

function vigilEvents(vigils: Vigil[]): CalEvent[] {
  const from = Date.now() - 31 * 86_400_000;
  const until = Date.now() + 120 * 86_400_000;
  return vigils
    .filter((v) => v.enabled)
    .flatMap((v) => upcomingRuns(v, from, until).map((at) => ({ id: `vigil:${v.id}:${at}`, title: `🕯️ ${v.name}`, allDay: false, start: at, end: at + 30 * 60_000, source: VIGIL_SOURCE })));
}
