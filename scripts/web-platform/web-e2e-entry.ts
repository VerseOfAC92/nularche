// check-web-app.ts için giriş: üretimdeki web sürümünün aynısı, yalnızca Google yerine aynı sunucunun /fake altındaki
// sahte Drive'ı kullanılır (oturum açma penceresi açılmaz). Yayına giden pakette bu dosya yoktur.

import { GoogleDrive } from "../../packages/core/src/drive-google.ts";
import { bootWeb } from "../../packages/web/src/web/boot.ts";

const fake = `${location.origin}/fake`;
void bootWeb({
  async signIn() {
    const drive = new GoogleDrive({ accessToken: async () => "web-token" }, { api: `${fake}/drive/v3`, upload: `${fake}/upload/drive/v3` });
    return { drive, account: await drive.account(), signOut: async () => undefined };
  },
});
