// Web sürümünün giriş penceresi (Nularche'ye özel): Google ile oturum açma, şifreli notlar için parola ve Drive'dan
// yükleme adımları. Pencere yalnızca düz DOM'dur; uygulama arayüzü notlar açıldıktan sonra yüklenir.

import type { DriveApi } from "../../../core/src/drive-sync.ts";
import { findOrigin, OpenError, openOrigin, unlockKeys, type OriginRoot, type SyncStatus, type WebOrigin } from "../../../web-platform/src/session.ts";
import { getLang, setLang, type Lang } from "../i18n/index.ts";

/** Google oturumunun Takvim yüzü: aynı erişim belirteci; Takvim izni girişte verilmemiş olabilir. */
export interface GoogleCalendarAccess {
  accessToken(force?: boolean): Promise<string>;
  granted(): boolean;
  request(): Promise<boolean>;
}

export interface SignedIn {
  drive: DriveApi;
  account: string;
  signOut(): Promise<void>;
  calendar: GoogleCalendarAccess | null;
  /** Oturum yenilemesi bir tıklama gerektirdiğinde (Safari) çağrılacak işlevi kaydeder. */
  onGestureNeeded?(cb: (resume: () => void) => void): void;
  /** Kilitlenirken sekmenin oturum belleğine bırakılacak erişim izni (Google'a yeniden girmeden açmak için). */
  handover?(): unknown;
  /** Tıklamanın içinde: erişim izninin süresi dolmuşsa Google penceresini hemen açar. */
  refreshInGesture?(): void;
}

/** Oturum açma sağlayıcısı: üretimde Google (GIS), denetimlerde sahte Drive ve Takvim. */
export interface SignInProvider {
  /** Giriş penceresi görünürken çalışır (ör. Google betiğini yükler); bitene kadar düğme bekler. */
  prepare?(): Promise<void>;
  /** Düğme tıklamasında, beklemeden çağrılır: Google penceresi aynı anda açılmalıdır (Safari). */
  signIn(): Promise<SignedIn>;
  /** Kilit ekranından: devredilen erişim izniyle oturumu Google penceresi açmadan kurar. */
  resume?(handover: unknown): Promise<SignedIn>;
}

export interface OpenedSession {
  origin: WebOrigin;
  signed: SignedIn;
}

const TEXT = {
  tagline: ["Your notes, from anywhere.", "Notlarınız, her yerden."],
  google: ["Continue with Google", "Google ile devam et"],
  privacy: [
    "Nularche sees only its own folder in your Google Drive. Your notes are loaded into this tab's memory, never saved on this computer, and wiped when you close the tab or sign out.",
    "Nularche, Google Drive'ınızda yalnızca kendi klasörünü görür. Notlarınız bu sekmenin belleğine yüklenir, bu bilgisayara kaydedilmez; sekmeyi kapatınca ya da çıkış yapınca silinir.",
  ],
  policy: ["Privacy policy", "Gizlilik politikası"],
  finding: ["Looking for your notes in Google Drive…", "Notlarınız Google Drive'da aranıyor…"],
  locked: ["Your notes are end-to-end encrypted. Enter your passphrase to open them.", "Notlarınız uçtan uca şifreli. Açmak için parolanızı girin."],
  passphrase: ["Passphrase", "Parola"],
  unlock: ["Unlock", "Kilidi aç"],
  other: ["Use another Google account", "Başka bir Google hesabı kullan"],
  opening: ["Decrypting and loading your notes…", "Notlarınız çözülüp yükleniyor…"],
  wrong: ["That passphrase is not right.", "Parola yanlış."],
  none: [
    "There are no Nularche notes in this Google Drive yet. Turn on Google Drive sync in the Nularche desktop app first, then come back.",
    "Bu Google Drive'da henüz Nularche notu yok. Önce masaüstü uygulamasında Google Drive eşitlemesini açın, sonra buraya dönün.",
  ],
  download: ["Get the desktop app", "Masaüstü uygulamasını indirin"],
  failed: ["Something went wrong:", "Bir sorun oluştu:"],
  preparing: ["Connecting to Google…", "Google'a bağlanılıyor…"],
  e_popup_closed: ["The Google window was closed before you finished. Try again.", "Google penceresi işlem bitmeden kapatıldı. Yeniden deneyin."],
  e_popup_failed_to_open: [
    "Your browser blocked the Google window. Try again; if it is still blocked, allow pop-ups for nularche.verseofac.com.",
    "Tarayıcınız Google penceresini engelledi. Yeniden deneyin; yine engellenirse nularche.verseofac.com için açılır pencerelere izin verin.",
  ],
  e_drive_denied: [
    "Nularche needs Google Drive access to open your notes. Try again and keep the Drive permission ticked.",
    "Notlarınızı açabilmek için Google Drive izni gerekli. Yeniden deneyin ve Drive iznini işaretli bırakın.",
  ],
  e_network: ["Google could not be reached. Check your connection and try again.", "Google'a ulaşılamadı. Bağlantınızı kontrol edip yeniden deneyin."],
  e_auth: ["Google did not allow access. Sign in again.", "Google erişime izin vermedi. Yeniden giriş yapın."],
  e_quota: ["Your Google Drive is full.", "Google Drive'ınızda yer kalmadı."],
  e_invalid: ["Google Drive refused the request. Try again later.", "Google Drive isteği reddetti. Bir süre sonra yeniden deneyin."],
  e_wrong_key: ["A file in Google Drive could not be decrypted with this passphrase.", "Google Drive'daki bir dosya bu parolayla çözülemedi."],
  e_empty_remote: ["The Nularche folder in Google Drive looks empty.", "Google Drive'daki Nularche klasörü boş görünüyor."],
  e_access_denied: ["Google access was not allowed.", "Google erişimine izin verilmedi."],
  e_other_origin: [
    "That Google account holds different Nularche notes from the ones in this browser. Connect the account you used before.",
    "Bu Google hesabındaki Nularche notları bu tarayıcıdakilerden farklı. Daha önce kullandığınız hesabı bağlayın.",
  ],
  e_no_service_worker: [
    "This browser can't run the Nularche web app here (service workers are off, which some private windows do). Open it in a normal window or another browser.",
    "Bu tarayıcı Nularche web sürümünü burada çalıştıramıyor (service worker kapalı; bazı gizli pencerelerde böyledir). Normal bir pencerede ya da başka bir tarayıcıda açın.",
  ],
  reauth: ["Your Google session needs renewing to keep syncing.", "Eşitlemenin sürmesi için Google oturumunun yenilenmesi gerekiyor."],
  reauth_btn: ["Renew", "Yenile"],
  locked_notice: ["Nularche is locked. Your notes were removed from this tab's memory; sign in to open them again.", "Nularche kilitlendi. Notlarınız bu sekmenin belleğinden silindi; yeniden açmak için giriş yapın."],
  signed_out_notice: ["You are signed out. Nothing from your notes is left in this browser.", "Çıkış yaptınız. Bu tarayıcıda notlarınızdan hiçbir şey kalmadı."],
} as const;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** Giriş penceresini gösterir; notlar açılınca pencereyi kaldırıp oturumu döndürür. */
export function showSignIn(provider: SignInProvider, onStatus?: (s: SyncStatus) => void, ended: "locked" | "signed-out" | null = null): Promise<OpenedSession> {
  let lang: Lang = getLang();
  const tx = (k: keyof typeof TEXT) => TEXT[k][lang === "tr" ? 1 : 0];

  const shade = el("div", "nw-shade");
  const card = el("main", "nw-card");
  card.setAttribute("aria-live", "polite");
  shade.append(card);
  document.body.append(shade);

  let state: { step: "start" } | { step: "busy"; text: keyof typeof TEXT } | { step: "passphrase"; error?: string } | { step: "none" } | { step: "error"; error: unknown } = { step: "start" };
  /** Hazırlık (Google betiği) bitti mi; bitene kadar düğme bekler. Hata olursa gösterilir. */
  let ready = !provider.prepare;
  /** Hata kodu kullanıcının dilinde; bilinmeyen hatalarda Google'ın iletisi. */
  const describe = (err: unknown): string => {
    const code = (err as { code?: unknown })?.code;
    const key = typeof code === "string" ? (`e_${code}` as keyof typeof TEXT) : null;
    if (key && key in TEXT) return tx(key);
    return `${tx("failed")} ${err instanceof Error ? err.message : String(err)}`;
  };
  let signed: SignedIn | null = null;
  let root: OriginRoot | null = null;

  return new Promise<OpenedSession>((resolve) => {
    const render = () => {
      const langBtn = el("button", "nw-lang", lang === "tr" ? "EN" : "TR");
      langBtn.type = "button";
      langBtn.addEventListener("click", () => {
        lang = lang === "tr" ? "en" : "tr";
        setLang(lang);
        render();
      });
      const logo = el("img", "nw-logo");
      logo.src = `${import.meta.env.BASE_URL}logo.png`;
      logo.alt = "";
      const head = el("header", "nw-head");
      head.append(logo, el("h1", undefined, "Nularche"), el("p", "nw-tagline", tx("tagline")));
      const body = el("section", "nw-body");

      if (state.step === "start" || state.step === "error") {
        if (state.step === "start" && ended) body.append(el("p", "nw-notice", tx(ended === "locked" ? "locked_notice" : "signed_out_notice")));
        if (state.step === "error") body.append(el("p", "nw-error", describe(state.error)));
        const g = el("button", "nw-google");
        g.type = "button";
        g.disabled = !ready;
        const mark = el("span", "nw-g");
        mark.setAttribute("aria-hidden", "true");
        g.append(mark, el("span", undefined, tx(ready ? "google" : "preparing")));
        g.addEventListener("click", () => void begin());
        body.append(g, el("p", "nw-note", tx("privacy")));
        const policy = el("a", "nw-link", tx("policy"));
        policy.href = "/privacy";
        body.append(policy);
      } else if (state.step === "busy") {
        body.append(el("div", "nw-spinner"), el("p", "nw-note", tx(state.text)));
      } else if (state.step === "passphrase") {
        if (signed) body.append(el("p", "nw-account", signed.account));
        body.append(el("p", "nw-note", tx("locked")));
        const form = el("form", "nw-form");
        const input = el("input", "nw-input");
        input.type = "password";
        input.autocomplete = "current-password";
        input.placeholder = tx("passphrase");
        input.setAttribute("aria-label", tx("passphrase"));
        input.required = true;
        const go = el("button", "nw-primary", tx("unlock"));
        go.type = "submit";
        form.append(input, go);
        if (state.error) form.append(el("p", "nw-error", state.error));
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          const pass = input.value;
          input.value = "";
          void unlock(pass);
        });
        const other = el("button", "nw-text", tx("other"));
        other.type = "button";
        other.addEventListener("click", () => void restart());
        body.append(form, other);
        queueMicrotask(() => input.focus());
      } else if (state.step === "none") {
        if (signed) body.append(el("p", "nw-account", signed.account));
        body.append(el("p", "nw-note", tx("none")));
        const dl = el("a", "nw-primary", tx("download"));
        dl.href = "/#download";
        const other = el("button", "nw-text", tx("other"));
        other.type = "button";
        other.addEventListener("click", () => void restart());
        body.append(dl, other);
      }
      card.replaceChildren(langBtn, head, body);
    };
    const set = (next: typeof state) => {
      state = next;
      render();
    };

    async function begin() {
      try {
        // Beklemeden: Google penceresi bu tıklamayla aynı anda açılmalı.
        signed = await provider.signIn();
        set({ step: "busy", text: "finding" });
        root = await findOrigin(signed.drive);
        if (root.encrypted) return set({ step: "passphrase" });
        await open(null);
      } catch (err) {
        if (err instanceof OpenError && err.code === "no_origin") return set({ step: "none" });
        set({ step: "error", error: err });
      }
    }
    async function unlock(pass: string) {
      if (!root) return;
      set({ step: "busy", text: "opening" });
      try {
        await open(pass);
      } catch (err) {
        if (err instanceof OpenError && err.code === "wrong_passphrase") return set({ step: "passphrase", error: tx("wrong") });
        set({ step: "error", error: err });
      }
    }
    async function open(pass: string | null) {
      const keys = await unlockKeys(root!, pass);
      set({ step: "busy", text: "opening" });
      const origin = await openOrigin(signed!.drive, root!, keys, { onStatus });
      shade.remove();
      resolve({ origin, signed: signed! });
    }
    async function restart() {
      await signed?.signOut().catch(() => undefined);
      signed = null;
      root = null;
      set({ step: "start" });
    }
    render();
    provider.prepare?.().then(
      () => {
        ready = true;
        render();
      },
      (err) => {
        ready = true;
        set({ step: "error", error: err });
      },
    );
  });
}

/** Hata, kullanıcının dilinde (kodu bilinen hatalar çevrilir; diğerlerinde ayrıntı). */
export function errorText(err: unknown): string {
  const i = getLang() === "tr" ? 1 : 0;
  const code = (err as { code?: unknown })?.code;
  const key = typeof code === "string" ? (`e_${code}` as keyof typeof TEXT) : null;
  if (key && key in TEXT) return TEXT[key][i];
  return `${TEXT.failed[i]} ${err instanceof Error ? err.message : String(err)}`;
}

const LOCK_TEXT = {
  title: ["Nularche is locked", "Nularche kilitli"],
  encrypted: ["Enter your passphrase to open your notes.", "Notlarınızı açmak için parolanızı girin."],
  plain: ["Your notes were removed from this tab's memory. Unlock to open them again.", "Notlarınız bu sekmenin belleğinden silindi. Yeniden açmak için kilidi açın."],
  trusted: ["This browser is trusted: your notes are kept here encrypted and open without waiting for Google Drive.", "Bu tarayıcı güvenilir: notlarınız burada şifreli saklanır ve Google Drive beklenmeden açılır."],
  other: ["Sign in with Google instead", "Bunun yerine Google ile giriş yap"],
} as const;

export type LockResult = { kind: "unlocked"; passphrase: string | null } | { kind: "switch" };

/**
 * Nularche'ye özel kilit ekranı: Google'a yeniden girmeden parolayla (açık Origin'de tek tıkla) açılır. `unlock` başarılı
 * olunca ekran kalkar; hata (ör. yanlış parola) ekranda gösterilir. "Google ile giriş" seçilirse `switch` döner.
 */
export function showLockScreen(options: {
  account: string;
  encrypted: boolean;
  trusted: boolean;
  /** Tıklamanın içinde, beklemeden çalışır (ör. süresi dolan Google iznini yenilemek için). */
  inGesture?(): void;
  unlock(passphrase: string | null): Promise<void>;
}): Promise<LockResult> {
  let lang: Lang = getLang();
  const t2 = (k: keyof typeof LOCK_TEXT) => LOCK_TEXT[k][lang === "tr" ? 1 : 0];
  const tx = (k: keyof typeof TEXT) => TEXT[k][lang === "tr" ? 1 : 0];
  const shade = el("div", "nw-shade");
  const card = el("main", "nw-card nw-lockscreen");
  card.setAttribute("aria-live", "polite");
  shade.append(card);
  document.body.append(shade);
  let error: string | null = null;
  let busy = false;
  return new Promise<LockResult>((resolve) => {
    const render = () => {
      const langBtn = el("button", "nw-lang", lang === "tr" ? "EN" : "TR");
      langBtn.type = "button";
      langBtn.addEventListener("click", () => {
        lang = lang === "tr" ? "en" : "tr";
        setLang(lang);
        render();
      });
      const logo = el("img", "nw-logo");
      logo.src = `${import.meta.env.BASE_URL}logo.png`;
      logo.alt = "";
      const lockMark = el("span", "nw-lockmark");
      lockMark.setAttribute("aria-hidden", "true");
      const head = el("header", "nw-head");
      head.append(logo, lockMark, el("h1", undefined, t2("title")), el("p", "nw-account", options.account));
      const body = el("section", "nw-body");
      if (busy) body.append(el("div", "nw-spinner"), el("p", "nw-note", tx("opening")));
      else {
        body.append(el("p", "nw-note", t2(options.encrypted ? "encrypted" : "plain")));
        const form = el("form", "nw-form");
        let input: HTMLInputElement | null = null;
        if (options.encrypted) {
          input = el("input", "nw-input");
          input.type = "password";
          input.autocomplete = "current-password";
          input.placeholder = tx("passphrase");
          input.setAttribute("aria-label", tx("passphrase"));
          input.required = true;
          form.append(input);
        }
        const go = el("button", "nw-primary", tx("unlock"));
        go.type = "submit";
        form.append(go);
        if (error) form.append(el("p", "nw-error", error));
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          options.inGesture?.();
          const pass = input ? input.value : null;
          if (input) input.value = "";
          busy = true;
          error = null;
          render();
          options.unlock(pass).then(
            () => {
              shade.remove();
              resolve({ kind: "unlocked", passphrase: pass });
            },
            (err) => {
              busy = false;
              error = (err as { code?: string })?.code === "wrong_passphrase" ? tx("wrong") : errorText(err);
              render();
            },
          );
        });
        body.append(form);
        if (options.trusted) body.append(el("p", "nw-note nw-small", t2("trusted")));
        const other = el("button", "nw-text", t2("other"));
        other.type = "button";
        other.addEventListener("click", () => {
          shade.remove();
          resolve({ kind: "switch" });
        });
        body.append(other);
        if (input) queueMicrotask(() => input!.focus());
      }
      card.replaceChildren(langBtn, head, body);
    };
    render();
  });
}

/** Güvenilen tarayıcı Drive'ı beklemeden açıldığında: Google Drive'ı bağlama çubuğu (tıklama Google penceresini açar). */
export function showConnectBar(connect: () => void): void {
  if (document.querySelector(".nw-reauth")) return;
  const i = getLang() === "tr" ? 1 : 0;
  const bar = el("div", "nw-reauth");
  bar.setAttribute("role", "status");
  const btn = el("button", "nw-primary", ["Connect", "Bağlan"][i]);
  btn.type = "button";
  btn.addEventListener("click", () => {
    bar.remove();
    connect();
  });
  bar.append(el("span", undefined, ["Opened from this browser. Connect Google to sync with Drive.", "Bu tarayıcıdan açıldı. Drive ile eşitlemek için Google'ı bağlayın."][i]), btn);
  document.body.append(bar);
}

/** Uygulama hiç açılamadığında (ör. service worker yok) giriş penceresinde nedenini kullanıcının dilinde gösterir. */
export function showFatal(err: unknown): void {
  const lang: Lang = getLang();
  const code = (err as { code?: unknown })?.code;
  const key = typeof code === "string" ? (`e_${code}` as keyof typeof TEXT) : null;
  const text = key && key in TEXT ? TEXT[key][lang === "tr" ? 1 : 0] : `${TEXT.failed[lang === "tr" ? 1 : 0]} ${err instanceof Error ? err.message : String(err)}`;
  const shade = el("div", "nw-shade");
  const card = el("main", "nw-card");
  const logo = el("img", "nw-logo");
  logo.src = `${import.meta.env.BASE_URL}logo.png`;
  logo.alt = "";
  card.append(logo, el("h1", undefined, "Nularche"), el("p", "nw-error", text));
  shade.append(card);
  document.body.append(shade);
}

/**
 * Google oturumu yenilenirken tarayıcı pencereyi engellediğinde (Safari) sayfanın altında küçük bir çubuk gösterir;
 * "Yenile" tıklaması pencereyi açar ve bekleyen eşitleme sürer.
 */
export function showGestureBar(resume: () => void): void {
  if (document.querySelector(".nw-reauth")) return;
  const lang: Lang = getLang();
  const tx = (k: "reauth" | "reauth_btn") => TEXT[k][lang === "tr" ? 1 : 0];
  const bar = el("div", "nw-reauth");
  bar.setAttribute("role", "alert");
  const btn = el("button", "nw-primary", tx("reauth_btn"));
  btn.type = "button";
  btn.addEventListener("click", () => {
    bar.remove();
    resume();
  });
  bar.append(el("span", undefined, tx("reauth")), btn);
  document.body.append(bar);
}
