// Depolama seçimi: notlar, ekler ve ayarlar bu bilgisayarda mı dursun, yoksa Google Drive ile mi eşitlensin.
// İlk açılış penceresinde ve Ayarlar → Notlar ve Origin'de aynı bileşen kullanılır. Origin klasörü her iki
// durumda da çalışma kopyasıdır; Google Drive seçilince Drive'daki Nularche klasörüyle iki yönlü eşitlenir.

import { useCallback, useEffect, useState } from "react";
import { desktop, type DriveStatus } from "./desktop.ts";
import { locale, t } from "./i18n/index.ts";
import { GoogleSignIn } from "./calendar/CalendarSync.tsx";
import { Icon } from "./ui/Icon.tsx";

export function useDriveStatus(): [DriveStatus | null, () => Promise<void>] {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const refresh = useCallback(async () => {
    if (desktop) setStatus(await desktop.driveStatus());
  }, []);
  useEffect(() => {
    void refresh();
    return desktop?.onDriveSynced(() => void refresh());
  }, [refresh]);
  return [status, refresh];
}

function syncLine(s: DriveStatus): string {
  if (s.syncing) return t("storage.syncing");
  if (s.lastError) return t("storage.syncError", { error: s.lastError.message.split("\n")[0].slice(0, 160) });
  if (!s.lastSync) return t("storage.neverSynced");
  return t("storage.lastSync", { time: new Date(s.lastSync).toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" }) });
}

export function StorageSetup({ onToast, onBeforeFolderChange }: { onToast: (msg: string) => void; onBeforeFolderChange?: () => Promise<void> }) {
  const [drive, refresh] = useDriveStatus();
  const [originDir, setOriginDir] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void desktop?.storageStatus().then((s) => setOriginDir(s.originDir));
  }, []);
  if (!desktop) return <p className="muted">{t("storage.browserOnly")}</p>;
  if (!drive) return null;
  const onDrive = drive.linked;

  const useLocal = async () => {
    if (!onDrive || !confirm(t("storage.stopConfirm"))) return;
    setBusy(true);
    await desktop!.driveDisconnect();
    setBusy(false);
    await refresh();
    onToast(t("storage.stopped"));
  };

  return (
    <div className="storage-choice" role="radiogroup" aria-label={t("storage.title")}>
      <div className={`storage-option ${onDrive ? "" : "on"}`} role="radio" aria-checked={!onDrive} data-testid="storage-local">
        <div className="storage-head">
          <span className="storage-icon">
            <Icon name="device-laptop" size={22} />
          </span>
          <div className="grow">
            <b>{t("storage.local")}</b>
            <p className="muted small">{t("storage.localText")}</p>
          </div>
          {!onDrive && (
            <span className="pill on">
              <Icon name="check" size={13} /> {t("storage.selected")}
            </span>
          )}
        </div>
        {originDir && (
          <div className="storage-body">
            <code className="path" title={originDir}>
              {originDir}
            </code>
            <div className="row">
              <button className="secondary" onClick={() => desktop!.revealOrigin()}>
                <Icon name="folder-open" size={15} /> {t("storage.reveal")}
              </button>
              <button
                className="secondary"
                onClick={async () => {
                  await onBeforeFolderChange?.();
                  // Klasör seçilmezse sihirbazın "kaldığı yerden sür" işareti geri alınır.
                  if (!(await desktop!.changeOrigin()) && onBeforeFolderChange) await desktop!.storageChosen(false);
                }}
              >
                {t("storage.changeFolder")}
              </button>
              {onDrive && (
                <button className="secondary" disabled={busy} onClick={() => void useLocal()}>
                  {t("storage.useLocal")}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className={`storage-option ${onDrive ? "on" : ""}`} role="radio" aria-checked={onDrive} data-testid="storage-drive">
        <div className="storage-head">
          <span className="storage-icon drive">
            <DriveMark />
          </span>
          <div className="grow">
            <b>{t("storage.drive")}</b>
            <p className="muted small">{t("storage.driveText")}</p>
          </div>
          {onDrive && (
            <span className="pill on">
              <Icon name="check" size={13} /> {t("storage.selected")}
            </span>
          )}
        </div>
        <div className="storage-body">
          {onDrive ? (
            <>
              <div className="storage-status">
                <Icon name={drive.lastError ? "alert-triangle" : drive.syncing ? "refresh" : "cloud-check"} size={16} className={drive.syncing ? "spin" : ""} />
                <span className="grow">
                  <b>{drive.account}</b>
                  <span className={`small ${drive.lastError ? "warn" : "muted"}`}> · {syncLine(drive)}</span>
                </span>
              </div>
              <div className="row">
                <button
                  className="secondary"
                  disabled={drive.syncing}
                  onClick={async () => {
                    const res = await desktop!.driveSync();
                    await refresh();
                    onToast(res.ok ? t("storage.synced") : t("storage.syncError", { error: res.error ?? "" }));
                  }}
                >
                  <Icon name="refresh" size={15} /> {t("storage.syncNow")}
                </button>
                <button className="secondary" disabled={busy} onClick={() => void useLocal()}>
                  {t("storage.stopDrive")}
                </button>
              </div>
            </>
          ) : drive.available ? (
            <GoogleSignIn
              label={t("storage.connectDrive")}
              run={async () => {
                const res = await desktop!.driveConnect();
                await refresh();
                if (res.ok) onToast(res.existing ? t("storage.linkedExisting") : t("storage.linkedNew"));
                return res;
              }}
              onDone={() => undefined}
            />
          ) : (
            <p className="muted small">{t("storage.unavailable")}</p>
          )}
          {!onDrive && drive.available && <p className="muted small">{t("storage.driveOnly")}</p>}
          {!!drive.lastCounts?.conflicts && <p className="warn small">{t("storage.conflicts", { n: drive.lastCounts.conflicts })}</p>}
        </div>
      </div>
    </div>
  );
}

/** Google Drive'ın çok renkli işareti (depolama seçeneğinde). */
function DriveMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.893} viewBox="0 0 87.3 78" aria-hidden="true">
      <path fill="#0066da" d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" />
      <path fill="#00ac47" d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z" />
      <path fill="#ea4335" d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" />
      <path fill="#00832d" d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" />
      <path fill="#2684fc" d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" />
      <path fill="#ffba00" d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" />
    </svg>
  );
}
