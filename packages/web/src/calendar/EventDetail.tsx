// Takvim etkinliğinin ayrıntıları: zaman, hatırlatma, konum, toplantı bağlantısı, düzenleyen ve katılımcılar (yanıtlarıyla),
// takvim ve notlar. Bağlantılar sistem tarayıcısında açılır. Yinelenen etkinlikler yalnızca görüntülenir.

import { locale, t } from "../i18n/index.ts";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { useEscape } from "../useEscape.ts";
import { linkify, plainDescription, type CalEvent } from "./calendar-model.ts";
import type { AttendeeStatus } from "../desktop.ts";

const STATUS_ICON: Record<AttendeeStatus, IconName> = { accepted: "circle-check", declined: "circle-x", tentative: "help-circle", "needs-action": "help-circle" };

/** Hatırlatmanın görünen adı (başlangıçtan kaç dakika önce). */
export function alarmLabel(m: number): string {
  if (m === 0) return t("cal.alarmAtStart");
  if (m % 1440 === 0) return t("cal.alarmDays", { n: m / 1440 });
  if (m % 60 === 0) return t("cal.alarmHours", { n: m / 60 });
  return t("cal.alarmMinutes", { n: m });
}

const open = (href: string) => window.open(href, "_blank", "noopener");

function Linked({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((p, i) =>
        p.href ? (
          <a key={i} href={p.href} onClick={(e) => (e.preventDefault(), open(p.href!))}>
            {p.text}
          </a>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

function whenText(e: CalEvent): string {
  const day = (ms: number) => new Date(ms).toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const hm = (ms: number) => new Date(ms).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  if (e.allDay) {
    const last = e.end;
    return new Date(e.start).toDateString() === new Date(last).toDateString() ? `${day(e.start)} · ${t("cal.allDay")}` : `${day(e.start)} – ${day(last)}`;
  }
  return new Date(e.start).toDateString() === new Date(e.end).toDateString() ? `${day(e.start)} · ${hm(e.start)} – ${hm(e.end)}` : `${day(e.start)} ${hm(e.start)} – ${day(e.end)} ${hm(e.end)}`;
}

/** Bağlantının görünen adı: tanınan toplantı hizmeti ya da alan adı. */
function urlLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (/teams\.(microsoft|live)\.com$/.test(host)) return "Microsoft Teams";
    if (/(^|\.)zoom\.us$/.test(host)) return "Zoom";
    if (host === "meet.google.com") return "Google Meet";
    if (/(^|\.)webex\.com$/.test(host)) return "Webex";
    return host;
  } catch {
    return url;
  }
}

export function EventDetail({ event, onClose, onEdit, onDelete }: { event: CalEvent; onClose: () => void; onEdit: () => void; onDelete: () => void }) {
  useEscape(onClose);
  const ev = event.view!;
  const description = ev.description ? plainDescription(ev.description) : "";
  const people = [...(ev.attendees ?? [])].sort((a, b) => Number(!!b.organizer) - Number(!!a.organizer));
  const organizerListed = people.some((p) => p.organizer);
  const name = (p: { name?: string; email?: string }) => p.name || p.email || "";
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog cal-detail" role="dialog" aria-label={ev.title} onMouseDown={(e) => e.stopPropagation()} style={{ "--c": event.source.color } as React.CSSProperties}>
        <header className="cal-detail-head">
          <h2>{ev.title || t("cal.untitledEvent")}</h2>
          <p>{whenText(event)}</p>
          {!!ev.alarms?.length && (
            <p className="muted small">
              <Icon name="bell" size={13} /> {ev.alarms.map((m) => alarmLabel(m)).join(", ")}
            </p>
          )}
          {ev.recurring && (
            <p className="muted small">
              <Icon name="repeat" size={13} /> {t("cal.recurring")}
            </p>
          )}
        </header>
        <div className="cal-detail-body">
          {ev.location && (
            <div className="cal-detail-row">
              <Icon name="map-pin" size={16} />
              <span className="grow">
                <Linked text={ev.location} />
              </span>
            </div>
          )}
          {ev.url && (
            <div className="cal-detail-row">
              <Icon name="video" size={16} />
              <span className="grow ellipsis" title={ev.url}>
                {urlLabel(ev.url)}
              </span>
              <button className="secondary small-btn" onClick={() => open(ev.url!)}>
                {t("cal.join")}
              </button>
            </div>
          )}
          {(people.length > 0 || ev.organizer) && (
            <div className="cal-detail-people">
              {ev.organizer && !organizerListed && (
                <div className="cal-person">
                  <Icon name="circle-check" size={15} className="ok" />
                  <span>
                    {name(ev.organizer)} <span className="muted">({t("cal.organizer")})</span>
                  </span>
                </div>
              )}
              {people.map((p, i) => (
                <div key={i} className="cal-person" title={p.email}>
                  <Icon name={STATUS_ICON[p.status]} size={15} className={p.status === "accepted" ? "ok" : p.status === "declined" ? "no" : "muted"} />
                  <span>
                    {name(p)}
                    {p.organizer && <span className="muted"> ({t("cal.organizer")})</span>}
                  </span>
                  <span className="muted small">{t(`cal.status.${p.status}`)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="cal-detail-row">
            <span className="cal-dot" style={{ background: event.source.color }} />
            <span className="grow">{event.source.name}</span>
            {event.source.kind !== "local" && <span className="muted small">{t(`cal.provider.${event.source.kind}`)}</span>}
          </div>
          {description && (
            <div className="cal-detail-notes">
              <Linked text={description} />
            </div>
          )}
        </div>
        <div className="dialog-actions">
          <button className="danger" onClick={onDelete}>
            <Icon name="trash" size={15} /> {t("cal.delete")}
          </button>
          <span className="grow" />
          <button className="secondary" onClick={onClose}>
            {t("common.close")}
          </button>
          {!ev.recurring && (
            <button className="primary" onClick={onEdit}>
              <Icon name="pencil" size={15} /> {t("cal.edit")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
