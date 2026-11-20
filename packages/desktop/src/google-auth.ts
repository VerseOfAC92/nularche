// Google ile tek tıkla giriş (Google Takvim ve Google Drive): yerleşik Nularche istemcisi, sistem tarayıcısında
// açılan Google girişi ve 127.0.0.1 üzerinde PKCE ile geri dönüş. Erişim belirteci Google'dan doğrudan bu
// bilgisayara gelir; hiçbir Nularche sunucusundan geçmez. Yenileme belirteci çağıran tarafından şifreli saklanır.

import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { shell } from "electron";
import { exchangeGoogleCode, googleAuthUrl, GOOGLE_AUTH_URL } from "../../core/src/calendar-providers.ts";
import { d } from "./i18n.ts";

/** Uçtan uca testlerde gerçek tarayıcı açılmaz; giriş adresi sahte sunucudan doğrudan istenir. */
const dryRun = !!process.env.NULARCHE_E2E;
const OAUTH_TIMEOUT_MS = 5 * 60_000;

export const googleEndpoints = {
  auth: process.env.NULARCHE_GOOGLE_AUTH || GOOGLE_AUTH_URL,
  token: process.env.NULARCHE_GOOGLE_TOKEN || undefined,
};

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
}

// Derleme sırasında scripts/build-desktop.ts tarafından doldurulur (depoya yazılmayan google-client.json ya da
// NULARCHE_GOOGLE_CLIENT_ID / NULARCHE_GOOGLE_CLIENT_SECRET ortam değişkenlerinden).
declare const __NULARCHE_GOOGLE_CLIENT__: GoogleClient | null;

/** Yerleşik Nularche istemcisi; yoksa (yerel geliştirme) null: arayüz kendi istemcisini girme seçeneği gösterir. */
export function builtInGoogleClient(): GoogleClient | null {
  const env = { clientId: process.env.NULARCHE_GOOGLE_CLIENT_ID ?? "", clientSecret: process.env.NULARCHE_GOOGLE_CLIENT_SECRET ?? "" };
  if (env.clientId && env.clientSecret) return env;
  const baked = typeof __NULARCHE_GOOGLE_CLIENT__ !== "undefined" ? __NULARCHE_GOOGLE_CLIENT__ : null;
  if (baked?.clientId && baked.clientSecret) return baked;
  return null;
}

const base64url = (b: Buffer) => b.toString("base64url");

/** Google girişini açar; kullanıcı izin verince yenileme belirtecini döndürür. */
export function authorizeGoogle(client: GoogleClient, scopes: string[], fail: (message: string) => Error): Promise<string> {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));
  return new Promise<string>((resolve, reject) => {
    let redirectUri = "";
    const page = (title: string, ok: boolean) =>
      `<!doctype html><meta charset="utf-8"><title>Nularche</title><body style="font:16px -apple-system,system-ui,sans-serif;padding:64px 24px;text-align:center;color:#1f2328;background:#f6f8fa"><div style="max-width:420px;margin:auto;background:#fff;border:1px solid #d0d7de;border-radius:14px;padding:32px"><div style="font-size:15px;color:${ok ? "#1a7f37" : "#cf222e"};font-weight:600;margin-bottom:8px">Nularche</div><h2 style="margin:0 0 10px;font-size:20px">${title}</h2><p style="margin:0;color:#57606a">${d("cal.closeTab")}</p></div></body>`;
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", redirectUri);
      if (url.pathname !== "/") return res.writeHead(404).end();
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      if (url.searchParams.get("state") !== state) return res.end(page(d("cal.authFailed"), false));
      const code = url.searchParams.get("code");
      if (!code) {
        res.end(page(d("cal.authFailed"), false));
        finish(fail(url.searchParams.get("error") ?? "access_denied"));
        return;
      }
      try {
        const refreshToken = await exchangeGoogleCode({ ...client, code, redirectUri, verifier }, { token: googleEndpoints.token });
        res.end(page(d("cal.authDone"), true));
        finish(null, refreshToken);
      } catch (e) {
        res.end(page(d("cal.authFailed"), false));
        finish(e as Error);
      }
    });
    const timeout = setTimeout(() => finish(fail(d("cal.authTimeout"))), OAUTH_TIMEOUT_MS);
    function finish(err: Error | null, token?: string) {
      clearTimeout(timeout);
      server.close();
      if (err) reject(err);
      else resolve(token!);
    }
    server.on("error", (e) => finish(e));
    server.listen(0, "127.0.0.1", () => {
      redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const url = googleAuthUrl({ clientId: client.clientId, redirectUri, challenge, state, scopes }, googleEndpoints.auth);
      if (dryRun) void fetch(url).catch(() => undefined);
      else void shell.openExternal(url);
    });
  });
}
