// Üretim girişi: Google ile oturum açan web sürümü. Tek Google oturumu hem Drive'ı hem Google Takvim'i bağlar.
// Google betiği giriş penceresi görünürken yüklenir; düğmeye basılınca Google penceresi hemen açılır (Safari bunu ister).

// Node genel değerleri (Buffer) her modülden önce: çekirdek modülleri yüklenirken bunlara ihtiyaç duyar.
import "../../../web-platform/src/globals.ts";
import { GoogleDrive } from "../../../core/src/drive-google.ts";
import { bootWeb } from "./boot.ts";
import { prepareGoogle, type GoogleSignIn, type TokenHandover } from "./google-auth.ts";

let google: GoogleSignIn | null = null;
void bootWeb({
  async prepare() {
    google = await prepareGoogle();
  },
  async signIn() {
    const session = await google!.start();
    const drive = new GoogleDrive({ accessToken: (force) => session.accessToken(force) });
    return {
      drive,
      account: await drive.account(),
      signOut: () => session.signOut(),
      calendar: { accessToken: (force) => session.accessToken(force), granted: () => session.calendarGranted(), request: () => session.requestCalendar() },
      onGestureNeeded: (cb) => session.onGestureNeeded(cb),
      handover: () => session.exportToken(),
      refreshInGesture: () => session.refreshInGesture(),
    };
  },
  // Kilit ekranından: devredilen erişim izniyle (Google penceresi açılmadan).
  async resume(handover) {
    if (!google || !handover) throw Object.assign(new Error("auth"), { code: "auth" });
    const session = google.resume(handover as TokenHandover);
    const drive = new GoogleDrive({ accessToken: (force) => session.accessToken(force) });
    return {
      drive,
      account: (handover as { account?: string }).account ?? "",
      signOut: () => session.signOut(),
      calendar: { accessToken: (force) => session.accessToken(force), granted: () => session.calendarGranted(), request: () => session.requestCalendar() },
      onGestureNeeded: (cb) => session.onGestureNeeded(cb),
      handover: () => session.exportToken(),
      refreshInGesture: () => session.refreshInGesture(),
    };
  },
});
