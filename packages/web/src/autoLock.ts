// Kilitli notların kendiliğinden kapanması: bir süre hareketsiz kalınca, bilgisayar uyku moduna geçince ya da ekran
// kilitlenince açık kilitli notların anahtarları bellekten silinir (bkz. lock.ts). Süre Ayarlar'dan seçilir
// (`lockTimeout` dakika; 0 = kapalı). Uyku ve ekran kilidinde süreden bağımsız olarak hemen kapanır.
// Web sürümünde ayrıca bütün oturum kilitlenir (`webLockTimeout` dakika): değişiklikler Drive'a gönderilir, notlar ve
// anahtarlar sekmenin belleğinden silinir; yeniden açmak için giriş gerekir.

import { runCommand } from "./commands.ts";
import { desktop, webSession } from "./desktop.ts";
import { getPref } from "./prefs.ts";
import { closeAllLocked, openLockedCount } from "./lock.ts";

export const LOCK_TIMEOUTS = [0, 1, 5, 15, 30, 60];
export const DEFAULT_LOCK_TIMEOUT = 5;
export const WEB_LOCK_TIMEOUTS = [5, 15, 30, 60, 240];
export const DEFAULT_WEB_LOCK_TIMEOUT = 15;

/** Açık kilitli notları kapatır: açık not görünümü varsa önce değişiklikleri kaydeder. */
export function lockNow(): void {
  if (!openLockedCount()) return;
  if (!runCommand("note.closeLocked")) closeAllLocked();
}

export function installAutoLock(): () => void {
  let last = Date.now();
  const touch = () => (last = Date.now());
  const events = ["keydown", "pointerdown", "pointermove", "wheel", "touchstart"] as const;
  for (const e of events) window.addEventListener(e, touch, { passive: true, capture: true });
  const timer = window.setInterval(() => {
    const minutes = Number(getPref("lockTimeout", DEFAULT_LOCK_TIMEOUT));
    if (minutes > 0 && openLockedCount() && Date.now() - last >= minutes * 60_000) lockNow();
    // Web oturumu her zaman bir süre sonra kilitlenir (kapatılamaz): başkasının bilgisayarında açık kalmasın.
    const web = Number(getPref("webLockTimeout", DEFAULT_WEB_LOCK_TIMEOUT)) || DEFAULT_WEB_LOCK_TIMEOUT;
    if (webSession && Date.now() - last >= web * 60_000) void webSession.lock();
  }, 10_000);
  const off = desktop?.onSystemLock?.(() => lockNow());
  return () => {
    for (const e of events) window.removeEventListener(e, touch, { capture: true });
    window.clearInterval(timer);
    off?.();
  };
}
