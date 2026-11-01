// Takvim eşitleme arayüzü: Ayarlar'da Google / Apple hesap bağlantısı, veritabanı araç çubuğunda
// veritabanını bir takvime bağlama. İşin kendisi masaüstü sürecindedir (desktop/src/calendar.ts);
// tarayıcıda (köprü yokken) bu bileşenler görünmez.

import { useCallback, useEffect, useState } from "react";
import { desktop, type CalendarErrorCode, type CalendarLinkStatus, type CalendarProviderId, type CalendarStatus } from "../desktop.ts";
import { locale, t, type StringKey } from "../i18n/index.ts";
import type { Database, View } from "../database/model.ts";

const PROVIDERS: CalendarProviderId[] = ["google", "apple"];
const providerName = (p: CalendarProviderId) => t(`cal.provider.${p}` as StringKey);
const errorText = (code: CalendarErrorCode, detail?: string) => {
  const known = ["auth", "network", "conflict", "not_found", "invalid"].includes(code);
  return known ? t(`cal.err.${code}` as StringKey) : (detail ?? t("cal.err.unknown"));
};

export function useCalendarStatus(): [CalendarStatus | null, () => Promise<void>] {
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const refresh = useCallback(async () => {
    if (desktop) setStatus(await desktop.calendarStatus());
  }, []);
  useEffect(() => {
    void refresh();
    return desktop?.onCalendarSynced(() => void refresh());
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
        const res = await desktop!.calendarSync();
        setBusy(false);
        await refresh();
        onToast(res.ok ? t("cal.synced") : t("cal.syncedWithErrors", { count: res.errors.length }));
      }}
    >
      ⟳ {busy || status.syncing ? t("cal.syncing") : t("cal.syncNow")}
    </button>
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
        <button className="secondary" onClick={() => desktop!.calendarHelp("google")}>
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
            const res = await desktop!.calendarConnectGoogle(clientId, secret);
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
        <button className="secondary" onClick={() => desktop!.calendarHelp("apple")}>
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
            const res = await desktop!.calendarConnectApple(appleId, password);
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

/** Ayarlar bölümü: hesaplar, bağlı veritabanları, şimdi eşitle. */
export function CalendarAccounts({ onToast, titleOf }: { onToast: (msg: string) => void; titleOf: (nodeId: string) => string | undefined }) {
  const [status, refresh] = useCalendarStatus();
  const [open, setOpen] = useState<CalendarProviderId | null>(null);
  if (!desktop) return <p className="muted">{t("cal.browserOnly")}</p>;
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
                {account ? "✓ " : ""}
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
                    await desktop!.calendarDisconnect(p);
                    await refresh();
                  }}
                >
                  {t("cal.disconnect")}
                </button>
              </div>
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
      {status.links.length > 0 && (
        <>
          <p className="muted small">{t("cal.linkedDatabases")}</p>
          <ul className="cal-links">
            {status.links.map((l) => (
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
    void desktop!.calendarCalendars(chosen).then((res) => {
      if (res.ok) {
        setCalendars(res.calendars);
        setCalendarId(res.calendars[0]?.id ?? "");
      } else setError(errorText(res.code, res.error));
    });
  }, [chosen]);

  if (!desktop || !status) return null;
  const links = status.links.filter((l) => l.dbId === dbId);
  const propName = (id: string) => dateProps.find((p) => p.id === id)?.name ?? id;

  return (
    <div className="prop-menu cal-panel">
      <div className="muted small pad">{t("cal.dbTitle")}</div>
      {links.map((l) => (
        <div key={l.id} className="cal-link pad">
          <div>
            {providerName(l.provider)} · <b>{l.calendarName}</b> · {propName(l.dateProp)}
          </div>
          <div className={`small ${l.lastError ? "warn" : "muted"}`}>{lastSyncText(l)}</div>
          <button
            className="secondary small"
            onClick={async () => {
              if (!confirm(t("cal.unlinkConfirm", { calendar: l.calendarName }))) return;
              await desktop!.calendarUnlink(l.id);
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
              const res = await desktop!.calendarLink({
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
