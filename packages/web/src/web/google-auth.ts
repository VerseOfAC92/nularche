// Web sürümünde Google ile oturum açma: Google Identity Services (GIS) belirteç istemcisi yalnızca drive.file izniyle
// kısa ömürlü bir erişim belirteci verir. Yenileme belirteci ya da istemci sırrı yoktur; belirteç yalnızca bellekte
// tutulur ve sayfa kapanınca kaybolur. İstemci kimliği herkese açıktır (Google Cloud'daki "Nularche Web" istemcisi).

export const WEB_CLIENT_ID = "1080822852873-tq68aivig0kc2qab93bgiaeqgibsrb3d.apps.googleusercontent.com";
const GIS_SRC = "https://accounts.google.com/gsi/client";
const SCOPE = "https://www.googleapis.com/auth/drive.file";

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
}
interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (r: TokenResponse) => void;
            error_callback?: (e: { type: string; message?: string }) => void;
          }): TokenClient;
          revoke(token: string, done?: () => void): void;
        };
      };
    };
  }
}

export class AuthError extends Error {
  /** "popup_closed": kullanıcı pencereyi kapattı; "popup_blocked": tarayıcı açılır pencereyi engelledi. */
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

let loading: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new AuthError("network", "Google oturum açma hizmetine ulaşılamadı."));
    };
    document.head.append(s);
  });
  return loading;
}

/** Erişim belirteci kaynağı: GoogleDrive'ın `accessToken` kimlik bilgisi olarak verilir. */
export interface GoogleSession {
  accessToken(force?: boolean): Promise<string>;
  /** Belirteci Google'da geri alır ve bellekten siler (çıkış). */
  signOut(): Promise<void>;
}

/**
 * İlk belirteci ister: Google'ın hesap seçme / izin penceresi açılır. Bir düğme tıklamasının içinde çağrılmalıdır
 * (tarayıcılar kullanıcı hareketi olmadan açılır pencereyi engeller). Sonraki yenilemeler sessizce denenir.
 */
export async function signInWithGoogle(): Promise<GoogleSession> {
  await loadGis();
  let current: { token: string; until: number } | null = null;
  let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;
  const client = window.google!.accounts.oauth2.initTokenClient({
    client_id: WEB_CLIENT_ID,
    scope: SCOPE,
    callback: (r) => {
      const p = pending;
      pending = null;
      if (!p) return;
      if (!r.access_token) return p.reject(new AuthError(r.error ?? "denied", r.error_description ?? "Google erişim izni vermedi."));
      current = { token: r.access_token, until: Date.now() + (Number(r.expires_in) || 3600) * 1000 - 60_000 };
      p.resolve(r.access_token);
    },
    error_callback: (e) => {
      const p = pending;
      pending = null;
      p?.reject(new AuthError(e.type, e.type === "popup_closed" ? "Google penceresi kapatıldı." : e.type === "popup_failed_to_open" ? "Tarayıcı Google penceresini engelledi." : (e.message ?? e.type)));
    },
  });
  const request = (prompt: string) =>
    new Promise<string>((resolve, reject) => {
      pending?.reject(new AuthError("superseded", "Yeni bir istek başladı."));
      pending = { resolve, reject };
      client.requestAccessToken({ prompt });
    });
  await request("select_account");
  return {
    async accessToken(force = false) {
      if (!force && current && current.until > Date.now()) return current.token;
      return request("");
    },
    async signOut() {
      const token = current?.token;
      current = null;
      if (token) await new Promise<void>((resolve) => window.google!.accounts.oauth2.revoke(token, () => resolve()));
    },
  };
}
