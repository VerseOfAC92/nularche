// Web sürümünde Google ile oturum açma: Google Identity Services (GIS) belirteç istemcisi tek bir oturumda Drive
// (yalnızca Nularche'nin kendi klasörü: drive.file) ve Google Takvim (etkinlikler ve takvim listesi) izinleri için kısa
// ömürlü bir erişim belirteci verir. Kullanıcı Google'ın izin ekranında Takvim'i işaretlemezse yalnızca Drive bağlanır.
// Yenileme belirteci ya da istemci sırrı yoktur; belirteç yalnızca bellekte tutulur ve sayfa kapanınca kaybolur. İstemci kimliği herkese açıktır (Google Cloud'daki "Nularche Web" istemcisi).

import { DRIVE_SCOPES } from "../../../core/src/drive-google.ts";
import { GOOGLE_SCOPES as CALENDAR_SCOPES } from "../../../core/src/calendar-providers.ts";

export const WEB_CLIENT_ID = "1080822852873-tq68aivig0kc2qab93bgiaeqgibsrb3d.apps.googleusercontent.com";
const GIS_SRC = "https://accounts.google.com/gsi/client";
const SCOPES = [...DRIVE_SCOPES, ...CALENDAR_SCOPES];

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  /** Verilen izinler (boşlukla ayrılmış). */
  scope?: string;
  error?: string;
  error_description?: string;
}
interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string; scope?: string; include_granted_scopes?: boolean }): void;
}
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            include_granted_scopes?: boolean;
            callback: (r: TokenResponse) => void;
            error_callback?: (e: { type: string; message?: string }) => void;
          }): TokenClient;
          revoke(token: string, done?: () => void): void;
        };
      };
    };
  }
}

/**
 * Oturum açma hatası. Kodlar giriş penceresinde kullanıcının dilinde gösterilir: "popup_closed" (pencere kapatıldı),
 * "popup_failed_to_open" (tarayıcı pencereyi engelledi), "drive_denied" (Drive izni verilmedi), "network" (Google'a
 * ulaşılamadı), "denied" ve diğerleri (Google'ın bildirdiği hata).
 */
export class AuthError extends Error {
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
      reject(new AuthError("network", "Google sign-in could not be loaded."));
    };
    document.head.append(s);
  });
  return loading;
}

/** Erişim belirteci kaynağı: GoogleDrive'ın `accessToken` kimlik bilgisi olarak verilir. */
export interface GoogleSession {
  accessToken(force?: boolean): Promise<string>;
  /** Google Takvim izni verildi mi (izin ekranında kaldırılabilir). */
  calendarGranted(): boolean;
  /** Takvim iznini sonradan ister (Takvim ayarlarındaki düğme; kullanıcı tıklamasının içinde çağrılmalıdır). */
  requestCalendar(): Promise<boolean>;
  /**
   * Belirteç yenilenirken tarayıcı Google penceresini engellerse (Safari, tıklama olmadan pencere açtırmaz) çağrılır:
   * `resume` bir düğme tıklamasının içinde çağrılınca yenileme sürer, bekleyen Drive ve Takvim istekleri devam eder.
   */
  onGestureNeeded(cb: (resume: () => void) => void): void;
  /** Kilitlenirken devredilecek erişim izni. */
  exportToken(): TokenHandover | null;
  /** Bir tıklamanın içinde çağrılır: erişim izninin süresi dolmuşsa Google penceresini hemen açar (bekletmez). */
  refreshInGesture(): void;
  /** Belirteci Google'da geri alır ve bellekten siler (çıkış). */
  signOut(): Promise<void>;
}

/** Hazırlanmış Google oturum açma: `start` bir düğme tıklamasının içinde, beklemeden çağrılmalıdır. */
export interface GoogleSignIn {
  start(): Promise<GoogleSession>;
  /** Kilit ekranından sonra: devredilen erişim izniyle oturumu yeniden kurar (Google penceresi açılmaz). */
  resume(handover: TokenHandover): GoogleSession;
}

/** Kilitlenirken sekmenin oturum belleğine bırakılan erişim izni (yalnızca belirteç; not ya da parola değil). */
export interface TokenHandover {
  token: string;
  until: number;
  scopes: string[];
}

/**
 * Google oturum açma hizmetini önceden yükler ve hazırlar. Safari açılır pencereyi yalnızca tıklamayla aynı anda
 * açılırsa izin verir; bu yüzden betik giriş penceresi görünürken yüklenir ve tıklamada pencere hemen açılır.
 */
export async function prepareGoogle(): Promise<GoogleSignIn> {
  await loadGis();
  let current: { token: string; until: number } | null = null;
  const granted = new Set<string>();
  let pending: { resolve: (t: string) => void; reject: (e: Error) => void; prompt: string; silent: boolean } | null = null;
  let gesture: ((resume: () => void) => void) | null = null;
  const client = window.google!.accounts.oauth2.initTokenClient({
    client_id: WEB_CLIENT_ID,
    scope: SCOPES.join(" "),
    include_granted_scopes: true,
    callback: (r) => {
      const p = pending;
      pending = null;
      if (!p) return;
      if (!r.access_token) return p.reject(new AuthError(r.error ?? "denied", r.error_description ?? r.error ?? "denied"));
      current = { token: r.access_token, until: Date.now() + (Number(r.expires_in) || 3600) * 1000 - 60_000 };
      granted.clear();
      for (const sc of (r.scope ?? "").split(/\s+/)) if (sc) granted.add(sc);
      p.resolve(r.access_token);
    },
    error_callback: (e) => {
      const p = pending;
      if (!p) return;
      // Kendiliğinden yenileme engellendi: kullanıcıdan bir tıklama istenir, istek o zamana kadar bekler.
      if (e.type === "popup_failed_to_open" && p.silent && gesture) {
        gesture(() => client.requestAccessToken({ prompt: p.prompt }));
        return;
      }
      pending = null;
      p.reject(new AuthError(e.type, e.message ?? e.type));
    },
  });
  /** Pencereyi hemen (aynı çağrıda) açar; `silent` kullanıcı tıklaması olmadan yapılan yenileme. */
  const request = (prompt: string, silent: boolean) =>
    new Promise<string>((resolve, reject) => {
      pending?.reject(new AuthError("superseded", "superseded"));
      pending = { resolve, reject, prompt, silent };
      client.requestAccessToken({ prompt });
    });
  const session: GoogleSession = {
    async accessToken(force = false) {
      if (!force && current && current.until > Date.now()) return current.token;
      return request("", true);
    },
    calendarGranted: () => CALENDAR_SCOPES.every((sc) => granted.has(sc)),
    async requestCalendar() {
      await request("consent", false);
      return CALENDAR_SCOPES.every((sc) => granted.has(sc));
    },
    onGestureNeeded(cb) {
      gesture = cb;
    },
    exportToken: () => (current ? { token: current.token, until: current.until, scopes: [...granted] } : null),
    refreshInGesture() {
      if (!current || current.until <= Date.now() + 30_000) void request("", false).catch(() => undefined);
    },
    async signOut() {
      const token = current?.token;
      current = null;
      if (token) await new Promise<void>((resolve) => window.google!.accounts.oauth2.revoke(token, () => resolve()));
    },
  };
  return {
    resume(h) {
      current = { token: h.token, until: h.until };
      granted.clear();
      for (const sc of h.scopes) granted.add(sc);
      return session;
    },
    start() {
      // Pencere bu satırda, tıklamayla aynı anda açılır (await yok).
      const first = request("select_account", false);
      return first.then(() => {
        // Drive izni olmadan notlar açılamaz (izin ekranında kaldırılmış olabilir).
        if (!DRIVE_SCOPES.every((sc) => granted.has(sc))) throw new AuthError("drive_denied", "drive_denied");
        return session;
      });
    },
  };
}
