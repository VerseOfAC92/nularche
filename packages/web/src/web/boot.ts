// Web sürümünün açılışı (nularche.verseofac.com/app). Üç yol var:
//  1. İlk giriş: Nularche giriş penceresi → Google → (şifreliyse) parola → notlar Drive'dan belleğe iner.
//  2. Kilit: Kilitle'ye basınca notlar bellekten silinir ve sayfa yenilenir; yalnızca kısa ömürlü Google erişim izni
//     sekmenin oturum belleğine (sessionStorage, sekme kapanınca silinir) bırakılır. Kilit ekranında parolayla açılır,
//     Google'a yeniden girilmez.
//  3. Güvenilen tarayıcı: notların şifreli kopyası bu tarayıcıdadır; kilit ekranında parolayla açılır, notlar Drive
//     beklenmeden kopyadan gelir, Drive bağlanınca eşitleme arkadan sürer.
// Sağlayıcı dışarıdan verilir: üretimde Google, denetimlerde sahte Drive ve Takvim.

import "../../../web-platform/src/globals.ts";
import type { GoogleEndpoints } from "../../../core/src/calendar-providers.ts";
import { startHost } from "../../../web-platform/src/host.ts";
import { findOrigin, openOrigin, unlockKeys, type OriginRoot, type SyncStatus, type WebOrigin } from "../../../web-platform/src/session.ts";
import { createTrusted, forgetTrusted, openTrusted, readTrustMeta, type TrustedStore } from "../../../web-platform/src/trusted-store.ts";
import type { WebDriveStatus, WebSession } from "../desktop.ts";
import "../studio/fonts/nularche-font.css";
import { createWebAi } from "./ai-web.ts";
import { createWebCalendar } from "./calendar-web.ts";
import { errorText, showConnectBar, showFatal, showGestureBar, showLockScreen, showSignIn, type SignedIn, type SignInProvider } from "./signin.ts";
import "./signin.css";

declare global {
  interface Window {
    /** Açık oturum (arayüzdeki Drive durumu, takvim, kilit, güven ve çıkış kullanır). */
    nularcheWeb?: WebSession;
  }
}

/** Kilitlenirken sekmenin oturum belleğine bırakılan bilgi: hesap, kök ve Google erişim izni (not ya da parola yok). */
const HANDOVER = "nularche-lock";
interface Handover {
  v: 1;
  account: string;
  root: OriginRoot;
  google: unknown;
}
function readHandover(): Handover | null {
  try {
    const h = JSON.parse(sessionStorage.getItem(HANDOVER) ?? "null") as Handover | null;
    return h && h.v === 1 && h.root?.id ? h : null;
  } catch {
    return null;
  }
}
const clearHandover = () => {
  try {
    sessionStorage.removeItem(HANDOVER);
  } catch {
    // depolama kapalı
  }
};

export async function bootWeb(provider: SignInProvider, options: { calendarEndpoints?: GoogleEndpoints; geminiApi?: string } = {}): Promise<WebSession> {
  try {
    await startHost("/app/sw.js", "/app/");
  } catch (err) {
    showFatal(err);
    throw err;
  }
  let drive: WebDriveStatus = { state: "starting" };
  const listeners = new Set<() => void>();
  const onStatus = (s: SyncStatus) => {
    drive = s.state === "idle" ? { state: "idle", at: s.at } : s;
    listeners.forEach((cb) => cb());
  };
  // Çıkıştan sonra giriş penceresi bunu bildirir; adres temizlenir.
  const after = new URLSearchParams(location.search).get("ended");
  if (after) history.replaceState(null, "", "/app/");

  let handover = readHandover();
  let trust = await readTrustMeta().catch(() => null);
  let origin: WebOrigin | null = null;
  let signed: SignedIn | null = null;
  let store: TrustedStore | null = null;
  let account = "";

  /** Kilit açılırken başlatılan Google bağlantısı (güvenilen tarayıcı). */
  let quick: Promise<SignedIn> | null = null;
  while (!origin) {
    if (handover || trust) {
      const root = handover?.root ?? trust!.root;
      const useTrust = trust && trust.root.id === root.id ? trust : null;
      account = handover?.account ?? trust!.account;
      // Google betiği kilit ekranından önce yüklenir: kilit açma ve Bağlan tıklamaları Google penceresini hemen
      // açabilsin (Safari). Devredilen izin varsa oturum pencere açmadan kurulur.
      await provider.prepare?.().catch(() => undefined);
      if (handover && provider.resume) signed = await provider.resume(handover.google).catch(() => null);
      const result = await showLockScreen({
        account,
        encrypted: root.encrypted,
        trusted: !!useTrust,
        inGesture: () => {
          signed?.refreshInGesture?.();
          // Güvenilen tarayıcı: Drive bağlantısı aynı tıklamada, hesap seçtirmeden başlar (Safari tıklama ister).
          if (!signed && useTrust && provider.quickSignIn) quick = provider.quickSignIn(account);
        },
        async unlock(pass) {
          const keys = await unlockKeys(root, pass);
          if (useTrust) {
            const local = await openTrusted(useTrust, keys);
            const preloaded = await local.load();
            origin = await openOrigin(signed?.drive ?? null, root, keys, { onStatus, preloaded });
            store = local;
            if (signed) void origin.sync().catch(() => undefined);
          } else {
            if (!signed) throw Object.assign(new Error("auth"), { code: "auth" });
            origin = await openOrigin(signed.drive, root, keys, { onStatus });
          }
        },
      });
      clearHandover();
      if (result.kind === "switch") {
        handover = null;
        trust = null;
        signed = null;
        continue;
      }
    } else {
      const opened = await showSignIn(provider, onStatus, after === "signed-out" ? "signed-out" : null);
      origin = opened.origin;
      signed = opened.signed;
      account = signed.account;
    }
  }
  // (origin ve store kilit ekranının geri çağrısında atanır; TypeScript bunu izleyemediği için açıkça belirtilir.)
  const o = origin as unknown as WebOrigin;
  const opened = store as TrustedStore | null;
  if (opened) await o.setMirror((c) => opened.write(c));

  // Google Takvim aynı Google oturumunu kullanır; oturum sonradan bağlanabilir (güvenilen tarayıcı).
  const google = {
    accessToken: (force?: boolean) => (signed?.calendar ? signed.calendar.accessToken(force) : Promise.reject(Object.assign(new Error("auth"), { code: "auth" }))),
    granted: () => !!signed?.calendar?.granted(),
    request: () => signed?.calendar?.request() ?? Promise.resolve(false),
  };
  const calendar = createWebCalendar({ originRoot: () => o.store.root, google, endpoints: options.calendarEndpoints });
  const ai = createWebAi({ originRoot: () => o.store.root, api: options.geminiApi });
  const afterGoogle = async () => {
    // Safari: süresi dolan Google oturumu tıklamayla yenilenir; o zamana kadar Drive ve Takvim istekleri bekler.
    signed?.onGestureNeeded?.((resume) => showGestureBar(resume));
    // Takvim bağlanamazsa (ör. izin verilmedi ya da ağ hatası) notlar yine açılır; Ayarlar'dan yeniden denenebilir.
    await calendar.autoConnect().catch((err) => console.warn("Google Takvim bağlanamadı:", err));
  };
  if (signed) await afterGoogle();

  /** Güvenilen tarayıcıda Drive'ı bağlar: bir tıklamanın içinde çağrılır (Google penceresi hemen açılır). */
  /** Google oturumunu bağlar: aynı Nularche klasörü olmalı (başka hesapla girilirse notlar karışmasın). */
  const attach = async (pending: Promise<SignedIn>) => {
    const s = await pending;
    const root = await findOrigin(s.drive);
    if (root.id !== o.root.id) throw Object.assign(new Error("other_origin"), { code: "other_origin" });
    signed = s;
    account = s.account;
    o.attachDrive(s.drive);
    listeners.forEach((cb) => cb());
    await afterGoogle();
  };
  const connectDrive = () => {
    // Beklemeden: Google penceresi bu tıklamayla aynı anda açılmalı.
    void attach(provider.signIn()).catch((err) => {
      onStatus({ state: "error", code: (err as { code?: string })?.code === "other_origin" ? "unknown" : "auth", message: errorText(err) });
      showConnectBar(connectDrive);
    });
  };
  const started = quick as Promise<SignedIn> | null;
  if (!signed && started) {
    // Kilit açılırken başlayan bağlantı: tamamlanınca Drive eşitlemesi kendiliğinden başlar; olmazsa Bağlan çubuğu.
    started.catch(() => undefined);
    void attach(started).catch((err) => {
      onStatus({ state: "error", code: (err as { code?: string })?.code === "other_origin" ? "unknown" : "auth", message: errorText(err) });
      showConnectBar(connectDrive);
    });
  } else if (!signed) showConnectBar(connectDrive);

  const session: WebSession = {
    get account() {
      return account;
    },
    encrypted: o.root.encrypted,
    calendar: calendar.bridge,
    ai: ai.bridge,
    driveStatus: () => drive,
    onDriveStatus(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    async syncNow() {
      await o.sync().catch(() => undefined);
    },
    driveConnected: () => !!signed,
    connectDrive,
    trusted: () => !!store,
    async setTrusted(on) {
      if (on) {
        store = await createTrusted(account, o.root, o.keys);
        await o.setMirror((c) => store!.write(c));
      } else {
        await o.setMirror(null);
        store = null;
        await forgetTrusted();
      }
    },
    lock: () => end("locked"),
    signOut: () => end("signed-out"),
  };
  /** Oturumu bitirir: bekleyen değişiklikler gönderilir, bellek silinir, sayfa yeniden yüklenir (React durumu da gider). */
  async function end(how: "locked" | "signed-out") {
    removeEventListener("beforeunload", warn);
    calendar.close();
    ai.close();
    await o.close({ flush: true });
    if (how === "locked") {
      // Kilit ekranı Google'a yeniden girmeden açabilsin: yalnızca hesap, kök ve erişim izni bırakılır.
      const h: Handover = { v: 1, account, root: o.root, google: signed?.handover?.() ?? null };
      try {
        if (signed?.handover) sessionStorage.setItem(HANDOVER, JSON.stringify(h));
      } catch {
        // depolama kapalıysa kilit ekranı yerine giriş penceresi gelir
      }
      location.replace("/app/");
    } else {
      clearHandover();
      await forgetTrusted();
      await signed?.signOut().catch(() => undefined);
      location.replace("/app/?ended=signed-out");
    }
  }
  // Drive'a gönderilmemiş değişiklik varken sekme kapatılırsa tarayıcı uyarır.
  const warn = (e: BeforeUnloadEvent) => {
    if (!o.pending()) return;
    e.preventDefault();
    void o.sync().catch(() => undefined);
  };
  addEventListener("beforeunload", warn);
  window.nularcheWeb = session;
  await import("../main.tsx");
  return session;
}
