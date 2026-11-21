// Üretim girişi: Google ile oturum açan web sürümü. Tek Google oturumu hem Drive'ı hem Google Takvim'i bağlar.

import { GoogleDrive } from "../../../core/src/drive-google.ts";
import { bootWeb } from "./boot.ts";
import { signInWithGoogle } from "./google-auth.ts";

void bootWeb({
  async signIn() {
    const google = await signInWithGoogle();
    const drive = new GoogleDrive({ accessToken: (force) => google.accessToken(force) });
    return {
      drive,
      account: await drive.account(),
      signOut: () => google.signOut(),
      calendar: { accessToken: (force) => google.accessToken(force), granted: () => google.calendarGranted(), request: () => google.requestCalendar() },
    };
  },
});
