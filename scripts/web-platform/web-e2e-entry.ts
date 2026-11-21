// check-web-app.ts için giriş: üretimdeki web sürümünün aynısı, yalnızca Google yerine aynı sunucunun /fake altındaki
// sahte Drive'ı, /fakecal altındaki sahte Google Takvim'i ve /fakegemini altındaki sahte Gemini kullanılır (oturum açma penceresi açılmaz; Takvim izni
// verilmiş sayılır). Yayına giden pakette bu dosya yoktur.

import { GoogleDrive } from "../../packages/core/src/drive-google.ts";
import { bootWeb } from "../../packages/web/src/web/boot.ts";

const fake = `${location.origin}/fake`;
const token = async () => "web-token";
void bootWeb(
  {
    async signIn() {
      const drive = new GoogleDrive({ accessToken: token }, { api: `${fake}/drive/v3`, upload: `${fake}/upload/drive/v3` });
      return { drive, account: await drive.account(), signOut: async () => undefined, calendar: { accessToken: token, granted: () => true, request: async () => true } };
    },
  },
  { calendarEndpoints: { api: `${location.origin}/fakecal` }, geminiApi: `${location.origin}/fakegemini` },
);
