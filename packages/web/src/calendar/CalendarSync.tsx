// Takvim eşitleme arayüzü: Ayarlar'da Google / Apple hesap bağlantısı, veritabanı araç çubuğunda
// veritabanını bir takvime bağlama. İşin kendisi ortak takvim servisindedir (server/src/calendar-service.ts):
// masaüstünde ana süreçte, web sürümünde tarayıcıda (web/calendar-web.ts);
// köprü yokken (ör. geliştirme sunucusunda) bu bileşenler görünmez.

import { useCallback, useEffect, useState } from "react";
import { calendarBridge, type CalendarErrorCode, type CalendarLinkStatus, type CalendarProviderId, type CalendarStatus } from "../desktop.ts";
import { locale, t, type StringKey } from "../i18n/index.ts";
import type { Database, View } from "../database/model.ts";
import { api, type NodeMeta } from "../api.ts";
import { Icon } from "../ui/Icon.tsx";

const PROVIDERS: CalendarProviderId[] = ["google", "apple"];
const providerName = (p: CalendarProviderId) => t(`cal.provider.${p}` as StringKey);
export const errorText = (code: CalendarErrorCode, detail?: string) => {
  const known = ["auth", "network", "conflict", "not_found", "invalid"].includes(code);
  return known ? t(`cal.err.${code}` as StringKey) : (detail ?? t("cal.err.unknown"));
};

export function useCalendarStatus(): [CalendarStatus | null, () => Promise<void>] {
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const refresh = useCallback(async () => {
    if (calendarBridge) setStatus(await calendarBridge.calendarStatus());
  }, []);
  useEffect(() => {
    void refresh();
    return calendarBridge?.onCalendarSynced(() => void refresh());
  }, [refresh]);
  return [status, refresh];
}

function lastSyncText(l: CalendarLinkStatus): string {
  if (l.lastError) return errorText(l.lastError.code, l.lastError.message);
  if (!l.lastSync) return t("cal.neverSynced");
  return t("cal.lastSync", { time: new Date(l.lastSync).toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" }), count: l.count });
}

function SyncNow({ status, refresh, onToast }: { status: CalendarStatus; refresh: () => Promise<void>; onToast: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="secondary"
      disabled={busy || status.syncing || !status.links.length}
      onClick={async () => {
        setBusy(true);
        const res = await calendarBridge!.calendarSync();
        setBusy(false);
        await refresh();
        onToast(res.ok ? t("cal.synced") : t("cal.syncedWithErrors", { count: res.errors.length }));
      }}
    >
      <Icon name="refresh" size={15} /> {busy || status.syncing ? t("cal.syncing") : t("cal.syncNow")}
    </button>
  );
}

/** Tek tıkla Google girişi (yerleşik Nularche istemcisi): tarayıcıda Google açılır, izin verince hesap bağlanır. */
export function GoogleSignIn({ label, onDone, run }: { label: string; onDone: (account: string) => void; run: () => Promise<{ ok: true; account: string } | { ok: false; code: string; error: string }> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <div className="row">
        <button
          className="google-btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const res = await run();
            setBusy(false);
            if (res.ok) onDone(res.account);
            else setError(res.code === "auth" ? t("cal.err.signIn") : res.code === "invalid" ? res.error : errorText(res.code as CalendarErrorCode, res.error));
          }}
        >
          <GoogleMark /> {busy ? t("cal.waitingBrowser") : label}
        </button>
      </div>
      {busy && <p className="muted small">{t("google.browserHint")}</p>}
      {error && <p className="warn small">{error}</p>}
    </>
  );
}

/** Google'ın çok renkli "G" işareti (giriş düğmeleri için). */
export function GoogleMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.3-.4-3.5z" />
    </svg>
  );
}

function GoogleConnect({ onDone }: { onDone: (account: string) => void }) {
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <p className="muted small">{t("cal.googleIntro")}</p>
      <div className="ai-row">
        <span className="ai-step-no">a</span>
        <span className="ai-row-name">{t("cal.googleStepA")}</span>
        <button className="secondary" onClick={() => calendarBridge!.calendarHelp("google")}>
          {t("cal.googleConsole")}
        </button>
      </div>
      <div className="ai-row">
        <span className="ai-step-no">b</span>
        <input className="key-input" placeholder={t("cal.clientId")} value={clientId} onChange={(e) => setClientId(e.target.value)} />
        <input className="key-input" type="password" placeholder={t("cal.clientSecret")} value={secret} onChange={(e) => setSecret(e.target.value)} />
        <button
          className="primary"
          disabled={!clientId.trim() || !secret.trim() || busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const res = await calendarBridge!.calendarConnectGoogle(clientId, secret);
            setBusy(false);
            if (res.ok) onDone(res.account);
            else setError(res.code === "invalid" ? res.error : res.code === "auth" ? t("cal.err.signIn") : errorText(res.code, res.error));
          }}
        >
          {busy ? t("cal.waitingBrowser") : t("cal.signIn")}
        </button>
      </div>
      {error && <p className="warn small">{error}</p>}
    </>
  );
}

function AppleConnect({ onDone }: { onDone: (account: string) => void }) {
  const [appleId, setAppleId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <p className="muted small">{t("cal.appleIntro")}</p>
      <div className="ai-row">
        <span className="ai-step-no">a</span>
        <span className="ai-row-name">{t("cal.appleStepA")}</span>
        <button className="secondary" onClick={() => calendarBridge!.calendarHelp("apple")}>
          {t("cal.appleAccount")}
        </button>
      </div>
      <div className="ai-row">
        <span className="ai-step-no">b</span>
        <input className="key-input" placeholder={t("cal.appleId")} value={appleId} onChange={(e) => setAppleId(e.target.value)} />
        <input className="key-input" type="password" placeholder={t("cal.applePassword")} value={password} onChange={(e) => setPassword(e.target.value)} />
        <button
          className="primary"
          disabled={!appleId.trim() || !password.trim() || busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const res = await calendarBridge!.calendarConnectApple(appleId, password);
            setBusy(false);
            if (res.ok) onDone(res.account);
            else setError(res.code === "invalid" ? res.error : res.code === "auth" ? t("cal.err.signIn") : errorText(res.code, res.error));
          }}
        >
          {busy ? t("auto.verifying") : t("cal.connect")}
        </button>
      </div>
      {error && <p className="warn small">{error}</p>}
    </>
  );
}

/** Hesaptaki takvimler: her biri tek anahtarla Nularche Takvim ekranında gösterilir; ekranda yapılan değişiklikler
 *  takvime yazılır. Notlarla ilişkilendirilmez (veritabanı eşitlemesi isteğe bağlı olarak veritabanı araç çubuğundadır). */
function AccountCalendars({ provider, status, refresh, onToast }: { provider: CalendarProviderId; status: CalendarStatus; refresh: () => Promise<void>; onToast: (m: string) => void }) {
  const [calendars, setCalendars] = useState<{ id: string; name: string; color?: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    void calendarBridge!.calendarCalendars(provider).then((res) => (res.ok ? setCalendars(res.calendars) : setError(errorText(res.code, res.error))));
  }, [provider]);
  const linkOf = (id: string) => status.links.find((l) => !l.dbId && l.provider === provider && l.calendarId === id);
  const toggle = async (c: { id: string; name: string }) => {
    setBusy(c.id);
    const link = linkOf(c.id);
    if (link) {
      await calendarBridge!.calendarUnlink(link.id);
    } else {
      // Görüntüleme bağlantısı: etkinlikler Takvim ekranında gösterilir, not ya da veritabanı oluşturulmaz.
      const res = await calendarBridge!.calendarLink({ provider, calendarId: c.id, calendarName: c.name });
      if (!res.ok) setError(errorText(res.code, res.error));
      else onToast(res.errors.length ? t("cal.syncedWithErrors", { count: res.errors.length }) : t("cal.calendarOn", { calendar: c.name }));
    }
    setBusy(null);
    await refresh();
  };
  if (error) return <p className="warn small">{error}</p>;
  if (!calendars) return <p className="muted small">{t("cal.loading")}</p>;
  return (
    <div className="cal-list">
      <p className="muted small">{t("cal.showInApp")}</p>
      {calendars.map((c) => {
        const link = linkOf(c.id);
        return (
          <label key={c.id} className="cal-list-row">
            <input type="checkbox" checked={!!link} disabled={busy === c.id} onChange={() => void toggle(c)} />
            <span className="cal-dot" style={{ background: c.color ?? "var(--nlc-accent-primary)" }} />
            <span className="grow">{c.name}</span>
            {link && <span className={`small ${link.lastError ? "warn" : "muted"}`}>{busy === c.id ? t("cal.syncing") : lastSyncText(link)}</span>}
          </label>
        );
      })}
    </div>
  );
}

/** Ayarlar bölümü: hesaplar, takvimler, bağlı veritabanları, şimdi eşitle. */
export function CalendarAccounts({ onToast, titleOf }: { onToast: (msg: string) => void; titleOf: (nodeId: string) => string | undefined }) {
  const [status, refresh] = useCalendarStatus();
  const [open, setOpen] = useState<CalendarProviderId | null>(null);
  if (!calendarBridge) return <p className="muted">{t("cal.browserOnly")}</p>;
  if (!status) return null;
  if (!status.encryption) return <p className="warn small">{t("cal.noEncryption")}</p>;

  return (
    <div className="cal-settings">
      <p className="muted">{t("cal.intro")}</p>
      {PROVIDERS.map((p) => {
        const account = status.accounts[p];
        return (
          <div key={p} className={`auto-box ${account ? "on" : ""}`} data-testid={`cal-${p}`}>
            <div className="auto-head">
              <span className={account ? "ok" : ""}>
                {account ? <Icon name="check" size={14} /> : null}
                {providerName(p)}
              </span>
              {account && <span className="pill">{account}</span>}
            </div>
            {account ? (
              <div className="row">
                <button
                  className="secondary"
                  onClick={async () => {
                    if (!confirm(t("cal.disconnectConfirm", { provider: providerName(p) }))) return;
                    await calendarBridge!.calendarDisconnect(p);
                    await refresh();
                  }}
                >
                  {t("cal.disconnect")}
                </button>
              </div>
            ) : null}
            {account ? (
              <AccountCalendars provider={p} status={status} refresh={refresh} onToast={onToast} />
            ) : p === "google" && status.googleOneClick ? (
              <GoogleSignIn label={t("cal.googleOneClick")} run={() => calendarBridge!.calendarConnectGoogle()} onDone={(a) => (onToast(t("cal.connected", { account: a })), void refresh())} />
            ) : open === p ? (
              p === "google" ? (
                <GoogleConnect onDone={(a) => (setOpen(null), onToast(t("cal.connected", { account: a })), void refresh())} />
              ) : (
                <AppleConnect onDone={(a) => (setOpen(null), onToast(t("cal.connected", { account: a })), void refresh())} />
              )
            ) : (
              <div className="row">
                <button className="secondary" onClick={() => setOpen(p)}>
                  {t("cal.connectProvider", { provider: providerName(p) })}
                </button>
              </div>
            )}
          </div>
        );
      })}
      {status.links.some((l) => l.dbId) && (
        <>
          <p className="muted small">{t("cal.linkedDatabases")}</p>
          <ul className="cal-links">
            {status.links.filter((l): l is CalendarLinkStatus & { dbId: string } => !!l.dbId).map((l) => (
              <li key={l.id}>
                <b>{titleOf(l.dbId) ?? t("cal.missingDatabase")}</b> → {providerName(l.provider)} · {l.calendarName}
                <div className={`small ${l.lastError ? "warn" : "muted"}`}>{lastSyncText(l)}</div>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="row">
        <SyncNow status={status} refresh={refresh} onToast={onToast} />
      </div>
      <p className="muted small">{t("cal.privacy")}</p>
    </div>
  );
}

/** Veritabanı araç çubuğundaki açılır pencere: bu veritabanının takvim bağlantıları. */
export function DatabaseCalendarSync({ dbId, db, view, onToast }: { dbId: string; db: Database; view: View; onToast: (msg: string) => void }) {
  const [status, refresh] = useCalendarStatus();
  const dateProps = db.properties.filter((p) => p.type === "date");
  const connected = PROVIDERS.filter((p) => status?.accounts[p]);
  const [provider, setProvider] = useState<CalendarProviderId | null>(null);
  const [calendars, setCalendars] = useState<{ id: string; name: string }[] | null>(null);
  const [calendarId, setCalendarId] = useState("");
  const [dateProp, setDateProp] = useState(view.dateProp && dateProps.some((p) => p.id === view.dateProp) ? view.dateProp : (dateProps[0]?.id ?? ""));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = provider ?? connected[0] ?? null;

  useEffect(() => {
    if (!chosen) return;
    setCalendars(null);
    setError(null);
    void calendarBridge!.calendarCalendars(chosen).then((res) => {
      if (res.ok) {
        setCalendars(res.calendars);
        setCalendarId(res.calendars[0]?.id ?? "");
      } else setError(errorText(res.code, res.error));
    });
  }, [chosen]);

  if (!calendarBridge || !status) return null;
  const links = status.links.filter((l) => l.dbId === dbId);
  const propName = (id: string) => dateProps.find((p) => p.id === id)?.name ?? id;

  return (
    <div className="prop-menu cal-panel">
      <div className="muted small pad">{t("cal.dbTitle")}</div>
      {links.map((l) => (
        <div key={l.id} className="cal-link pad">
          <div>
            {providerName(l.provider)} · <b>{l.calendarName}</b> · {propName(l.dateProp ?? "")}
          </div>
          <div className={`small ${l.lastError ? "warn" : "muted"}`}>{lastSyncText(l)}</div>
          <button
            className="secondary small"
            onClick={async () => {
              if (!confirm(t("cal.unlinkConfirm", { calendar: l.calendarName }))) return;
              await calendarBridge!.calendarUnlink(l.id);
              await refresh();
            }}
          >
            {t("cal.unlink")}
          </button>
        </div>
      ))}
      {links.length > 0 && <hr />}
      {!connected.length ? (
        <p className="muted small pad">{t("cal.connectFirst")}</p>
      ) : !dateProps.length ? (
        <p className="muted small pad">{t("cal.needDateProp")}</p>
      ) : (
        <div className="cal-form pad">
          {connected.length > 1 && (
            <div className="segmented">
              {connected.map((p) => (
                <button key={p} className={chosen === p ? "on" : ""} onClick={() => setProvider(p)}>
                  {providerName(p)}
                </button>
              ))}
            </div>
          )}
          <label>
            <span>{t("cal.calendar")}</span>
            <select value={calendarId} onChange={(e) => setCalendarId(e.target.value)} disabled={!calendars}>
              {!calendars && <option>{t("cal.loading")}</option>}
              {calendars?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {dateProps.length > 1 && (
            <label>
              <span>{t("db.dateProp")}</span>
              <select value={dateProp} onChange={(e) => setDateProp(e.target.value)}>
                {dateProps.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            className="primary small"
            disabled={!calendarId || !dateProp || busy || !chosen}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const res = await calendarBridge!.calendarLink({
                dbId,
                provider: chosen!,
                calendarId,
                calendarName: calendars?.find((c) => c.id === calendarId)?.name ?? calendarId,
                dateProp,
              });
              setBusy(false);
              await refresh();
              if (!res.ok) setError(errorText(res.code, res.error));
              else onToast(res.errors.length ? t("cal.syncedWithErrors", { count: res.errors.length }) : t("cal.linked"));
            }}
          >
            {busy ? t("cal.syncing") : t("cal.link")}
          </button>
          <p className="muted small">{t("cal.dbHint")}</p>
        </div>
      )}
      {error && <p className="warn small pad">{error}</p>}
    </div>
  );
}

/**
 * Önceki sürüm, Ayarlar'da açılan her takvim için otomatik bir "Takvimler"/"Calendars" Arche'si altında bir veritabanı
 * oluşturuyordu. Bu bağlantıları not dışı görüntüleme bağlantılarına çevirir ve o Arche yalnızca bu takvim
 * veritabanlarını içeriyorsa çöpe taşır (Çöp'ten geri getirilebilir). Kullanıcının kendi veritabanı bağlantılarına dokunmaz.
 */
export async function migrateCalendarArche(nodes: NodeMeta[]): Promise<boolean> {
  if (!calendarBridge) return false;
  const status = await calendarBridge.calendarStatus();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const names = new Set(["Takvimler", "Calendars"]);
  const folders = new Map<string, Set<string>>();
  for (const l of status.links) {
    const db = l.dbId ? byId.get(l.dbId) : undefined;
    const parent = db?.parentNodeId ? byId.get(db.parentNodeId) : undefined;
    if (!db || !parent || parent.parentNodeId !== null || !names.has(parent.title)) continue;
    const res = await calendarBridge.calendarLink({ provider: l.provider, calendarId: l.calendarId, calendarName: l.calendarName });
    if (!res.ok) continue;
    await calendarBridge.calendarUnlink(l.id);
    folders.set(parent.id, (folders.get(parent.id) ?? new Set()).add(db.id));
  }
  for (const [id, dbs] of folders) {
    const children = nodes.filter((n) => n.parentNodeId === id);
    if (children.every((c) => dbs.has(c.id)) && !(await api.read(id)).body.trim()) await api.trash(id);
  }
  return folders.size > 0;
}
