// Masaüstü uygulamasında preload'un açtığı köprü; tarayıcıda çalışırken undefined'dır.

export type ProviderId = "claude" | "chatgpt" | "gemini";
export type ConnectionId = "claude-desktop" | "claude-code" | "codex" | "antigravity";
export type LauncherId = "claude-desktop" | "claude-code" | "chatgpt-desktop" | "codex-cli" | "antigravity-cli";

export interface Provider {
  id: ProviderId;
  name: string;
  company: string;
  plans: string;
  connections: ConnectionId[];
  launchers: LauncherId[];
}

export interface ConnectionStatus {
  id: ConnectionId;
  provider: ProviderId;
  name: string;
  description: string;
  installed: boolean | null;
  plan: { configPath: string; status: "unchanged" | "add" | "update"; otherServers: string[]; legacyServers: string[] } | { error: string };
  manualCommand: string | null;
  downloadUrl: string;
  mustBeClosed?: string;
  running?: boolean;
}

export interface LauncherStatus {
  id: LauncherId;
  provider: ProviderId;
  name: string;
  installed: boolean | null;
  downloadUrl: string;
}

export interface AiClientRecord {
  name: string;
  version: string;
  provider: ProviderId | null;
  firstSeen: number;
  lastSeen: number;
}

export interface AiStatus {
  provider: ProviderId | null;
  launchers: Partial<Record<ProviderId, LauncherId>>;
  onboarded: boolean;
  providers: Provider[];
  connections: ConnectionStatus[];
  launcherStatus: LauncherStatus[];
  clients: AiClientRecord[];
  warning: string | null;
}

export type CalendarProviderId = "google" | "apple";
export type CalendarErrorCode = "auth" | "conflict" | "not_found" | "network" | "invalid" | "unknown";
export type CalendarFailure = { ok: false; code: CalendarErrorCode; error: string };

export interface CalendarLinkStatus {
  id: string;
  /** Yalnızca veritabanı bağlantısında; görüntüleme bağlantısı not oluşturmaz. */
  dbId?: string;
  provider: CalendarProviderId;
  calendarId: string;
  calendarName: string;
  dateProp?: string;
  lastSync?: number;
  lastError?: { code: CalendarErrorCode; message: string } | null;
  lastResult?: { createdLocal: number; createdRemote: number; updatedLocal: number; updatedRemote: number; trashedLocal: number; deletedRemote: number; skipped: number };
  /** Eşlenmiş satır sayısı. */
  count: number;
}

/** Etkinlik zamanı: tüm gün (bitiş günü hariç) ya da başlangıç–bitiş anı (ms). */
export type EventTime = { allDay: true; start: string; end: string } | { allDay: false; start: number; end: number };
export type AttendeeStatus = "accepted" | "declined" | "tentative" | "needs-action";
export interface CachedEvent {
  id: string;
  title: string;
  when: EventTime;
  description?: string;
  location?: string;
  url?: string;
  organizer?: { name?: string; email?: string };
  attendees?: { name?: string; email?: string; status: AttendeeStatus; organizer?: boolean }[];
  /** Başlangıçtan kaç dakika önce. */
  alarms?: number[];
  recurring?: boolean;
}
/** Takvim ekranından yazılan etkinlik: verilmeyen ayrıntı değiştirilmez; `alarm: null` hatırlatmayı kaldırır. */
export interface EventSaveInput {
  title: string;
  when: EventTime;
  description?: string;
  location?: string;
  url?: string;
  alarm?: number | null;
}
/** Takvim ekranının not dışı takvimleri: yerel Nularche takvimi ve görüntülenen hesap takvimleri. */
export interface ViewCalendar {
  id: string;
  provider: CalendarProviderId | "local";
  name: string;
  events: CachedEvent[];
}

export interface DriveStatus {
  /** Google ile tek tıkla bağlanma bu derlemede kullanılabilir mi. */
  available: boolean;
  encryption: boolean;
  account: string | null;
  /** Bu Origin Google Drive ile eşitleniyor mu. */
  linked: boolean;
  /** Drive'daki kopya uçtan uca şifreli mi. */
  encrypted: boolean;
  /** Drive'daki kopya şifreli ama bu bilgisayarda anahtarı yok: parola girilmeli. */
  needsPassphrase: boolean;
  syncing: boolean;
  lastSync: number | null;
  /** `mass_delete`: bu bilgisayardan birden çok dosya silindi; Drive'dan silinmeden önce onay bekleniyor (`count`). */
  lastError: { code: string; message: string; count?: number } | null;
  lastCounts: { uploaded: number; downloaded: number; deletedLocal: number; deletedRemote: number; conflicts: number; merged: number; cleaned: number } | null;
}

export interface CalendarStatus {
  /** Google Takvim tek tıkla (yerleşik Nularche istemcisiyle) bağlanabilir mi. */
  googleOneClick?: boolean;
  encryption: boolean;
  /** Bağlı hesapların görünen adı (e-posta / Apple Kimliği). */
  accounts: Partial<Record<CalendarProviderId, string>>;
  syncing: boolean;
  links: CalendarLinkStatus[];
}

export interface DesktopBridge {
  /** Arayüz hazır; ana süreçte bekleyen gezinme varsa döndürür. */
  /** Masaüstü ayarlarında kayıtlı arayüz dili (yoksa null). */
  language: "tr" | "en" | null;
  /** Masaüstü ayarlarında kayıtlı tema seçimi (yoksa null = sistem). */
  theme: "dark" | "light" | "system" | null;
  setTheme(theme: "dark" | "light" | "system"): Promise<void>;
  /** İşletim sistemi (preload'dan; eski sürümlerde yok). */
  platform?: string;
  /** Yerel çerçevenin koyu/açık görünümü seçilen arka plana uysun; null kullanıcının temasına döner. */
  setChrome?(mode: "dark" | "light" | null): Promise<void>;
  onFullScreen?(cb: (on: boolean) => void): () => void;
  contextItems?(items: unknown): unknown;
  onContextRun?(cb: (id: string) => void): () => void;
  setLanguage(lang: "tr" | "en"): Promise<void>;
  rendererReady(): Promise<string | null>;
  info(): Promise<{ version: string; platform: string; originDir: string; warning: string | null }>;
  changeOrigin(): Promise<string | null>;
  revealOrigin(): Promise<void>;
  copy(text: string): Promise<void>;
  revealPath(rel: string): Promise<boolean>;
  originPath(): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  aiStatus(): Promise<AiStatus>;
  aiSet(patch: { provider?: ProviderId | null; launcher?: LauncherId; onboarded?: boolean }): Promise<void>;
  aiConnect(
    id: ConnectionId,
    options?: { restartApp?: boolean },
  ): Promise<{ ok: boolean; backup?: string | null; error?: string; needsRestart?: boolean; restarted?: boolean }>;
  autoStatus(): Promise<{ enabled: boolean; hasKey: boolean; model: string | null; encryption: boolean }>;
  autoSetKey(key: string): Promise<{ ok: boolean; model?: string; error?: string }>;
  autoClear(): Promise<void>;
  autoEnable(enabled: boolean): Promise<void>;
  /** İsteği Gemini ile arka planda işler. */
  autoRun(requestId: string): Promise<{ ok: boolean; status?: string; error?: string }>;
  /** Başarısız ya da takılı isteği yeniden işler. */
  autoRetry(requestId: string): Promise<{ ok: boolean; status?: string; error?: string }>;
  autoCancel?(requestId: string, reply: string): Promise<{ ok: boolean; error?: string }>;
  /** AI uygulamasını yeniden başlatır (Claude Desktop: kapat + aç; diğerleri: aç). */
  aiRestart(launcher: LauncherId): Promise<{ ok: boolean; error?: string }>;
  aiOpen(launcher: LauncherId, prompt: string | null): Promise<{ opened: boolean; message?: string }>;
  aiDownload(url: string): Promise<void>;
  /** Bir AI aracı Nularche'ye ilk kez bağlandığında. */
  onAiConnected(cb: (client: AiClientRecord) => void): () => void;
  calendarStatus(): Promise<CalendarStatus>;
  /** Tarayıcıda Google girişini açar; kullanıcı izin verince hesabı kaydeder. */
  calendarConnectGoogle(clientId?: string, clientSecret?: string): Promise<{ ok: true; account: string } | CalendarFailure>;
  calendarConnectApple(appleId: string, password: string): Promise<{ ok: true; account: string } | CalendarFailure>;
  calendarDisconnect(provider: CalendarProviderId): Promise<void>;
  calendarCalendars(provider: CalendarProviderId): Promise<{ ok: true; calendars: { id: string; name: string; color?: string }[] } | CalendarFailure>;
  /** Takvimi bağlar (veritabanı verilmezse yalnızca Takvim ekranında görüntülenir) ve ilk eşitlemeyi yapar. */
  calendarLink(input: {
    dbId?: string;
    provider: CalendarProviderId;
    calendarId: string;
    calendarName: string;
    dateProp?: string;
  }): Promise<{ ok: true; linkId: string; errors: string[] } | CalendarFailure>;
  calendarEvents(): Promise<{ calendars: ViewCalendar[] }>;
  calendarEventSave(linkId: string, eventId: string | null, input: EventSaveInput): Promise<{ ok: true; event: CachedEvent } | CalendarFailure>;
  calendarEventDelete(linkId: string, eventId: string): Promise<{ ok: true } | CalendarFailure>;
  calendarUnlink(linkId: string): Promise<void>;
  calendarSync(): Promise<{ ok: boolean; errors: string[] }>;
  /** Google Cloud kimlik bilgileri ya da Apple uygulamaya özel parola sayfasını açar. */
  calendarHelp(which: CalendarProviderId): Promise<void>;
  /** Bir eşitleme bittiğinde. */
  onCalendarSynced(cb: () => void): () => void;
  /** Depolama: Origin klasörü ve ilk açılışta depolama seçimi yapıldı mı. */
  storageStatus(): Promise<{ originDir: string | null; chosen: boolean; resume: boolean }>;
  /** `resume`: sihirbazda klasör değiştirildi, pencere yeniden yüklenince sihirbaz kaldığı yerden sürsün. */
  storageChosen(resume?: boolean): Promise<void>;
  driveStatus(): Promise<DriveStatus>;
  /** Google ile tek tıkla giriş yapar ve bu Origin'i Google Drive ile eşitlemeye başlar. */
  driveConnect(): Promise<{ ok: true; account: string; existing: boolean; needsPassphrase: boolean; error: string | null } | { ok: false; code: string; error: string }>;
  /** Şifreli Drive klasörünü bu bilgisayarda açar. */
  driveUnlock(passphrase: string): Promise<{ ok: true; error: string | null } | { ok: false; code: string; error: string }>;
  /** Uçtan uca şifrelemeyi açar (Drive'daki kopya parolayla şifrelenir). */
  driveEncrypt(passphrase: string): Promise<{ ok: boolean; code?: string; error?: string }>;
  /** Uçtan uca şifrelemeyi kapatır. */
  driveDecrypt(): Promise<{ ok: boolean; code?: string; error?: string }>;
  /** Eşitlemeyi kapatır; dosyalar bu bilgisayarda ve Drive'da kalır. */
  driveDisconnect(): Promise<void>;
  driveSync(): Promise<{ ok: boolean; error?: string }>;
  /** Drive'dan geri getir: eksik ya da farklı dosyalar Drive'daki hâline döner; Drive'dan hiçbir şey silinmez. */
  driveRestore(): Promise<{ ok: boolean; error?: string }>;
  /** Toplu silmeyi onaylar: bu bilgisayardan silinenler Drive'dan da silinir. */
  driveConfirmDeletes(): Promise<{ ok: boolean; error?: string }>;
  onDriveSynced(cb: (info: { syncing?: boolean; downloaded?: boolean }) => void): () => void;
  /** Bilgisayar uyku moduna geçti ya da ekran kilitlendi (açık kilitli notlar kapanır). */
  onSystemLock?(cb: () => void): () => void;
  printPdf(name: string): Promise<string | null>;
  /** Otomatik yedekleme (2.0). */
  backupStatus(): Promise<BackupStatus>;
  backupChooseDir(): Promise<string | null>;
  backupSet(patch: { interval?: BackupStatus["interval"]; keep?: number }): Promise<void>;
  backupNow(): Promise<{ ok: boolean; name?: string; error?: string }>;
  backupReveal(): Promise<void>;
  exportArchive(nodeId: string | null, kind: "nlc" | "nla"): Promise<string | null>;
  /** Markdown (.zip), tek dosya HTML ya da statik site (klasöre) dışa aktarır. */
  exportAs(kind: "md" | "html" | "site" | "rtf" | "docx" | "txt", nodeId: string | null): Promise<{ ok: boolean; path?: string | null; error?: string }>;
  /** Panodaki düz metin. */
  readClipboard(): Promise<string>;
  /** Sistem yazdırma penceresi. */
  print(): Promise<void>;
  /** Notu ayrı bir pencerede açar. */
  openWindow(nodeId: string): Promise<void>;
  /** Pencereyi diğerlerinin üstünde tutar; yeni durumu döndürür. */
  setAlwaysOnTop(on: boolean): Promise<boolean>;
  setFullScreen(on: boolean): Promise<void>;
  /** Yazım denetimini açar/kapatır. */
  setSpellcheck(on: boolean): Promise<void>;
  /** Uygulama menüsünü (Dosya/Düzen/Biçim/Görüntü) arayüzün komut listesiyle kurar. */
  setMenu(spec: unknown, state: Record<string, boolean>): Promise<void>;
  /** Menüden seçilen komut. */
  onCommand(cb: (id: string) => void): () => void;
  /** Dosya ya da klasör seçtirip Markdown/HTML/RTF/metin notlarını Shadow'a aktarır. */
  importNotes(kind: "files" | "folder"): Promise<{ created: { id: string; title: string }[]; skipped: string[]; attachments: number } | null>;
  /** Ses ekini (Attachments yolu) Gemini (Otomatik mod) ile yazıya döker ya da özetler. */
  transcribe(path: string, mode: "transcript" | "summary", language: "tr" | "en"): Promise<{ ok: boolean; text?: string; error?: string; needsAuto?: boolean }>;
  importArchive(): Promise<{ imported: number; rootIds: string[] } | null>;
  checkUpdate(): Promise<{ version: string; url: string } | null>;
  skipUpdate(version: string): Promise<void>;
  /** `nularche://open?node=…` ve içe aktarma sonrası gezinme isteği. */
  onNavigate(cb: (nodeId: string) => void): () => void;
}

export interface BackupStatus {
  dir: string | null;
  interval: "off" | "hourly" | "daily" | "weekly";
  keep: number;
  lastAt: number | null;
  lastError: string | null;
  count: number;
}

export const desktop: DesktopBridge | undefined = (window as unknown as { nularche?: DesktopBridge }).nularche;

/** Takvim ekranlarının kullandığı köprü yüzü: masaüstünde preload, web sürümünde tarayıcıdaki takvim (web/calendar-web.ts). */
export type CalendarBridge = Pick<
  DesktopBridge,
  | "calendarStatus"
  | "calendarConnectGoogle"
  | "calendarConnectApple"
  | "calendarDisconnect"
  | "calendarCalendars"
  | "calendarLink"
  | "calendarEvents"
  | "calendarEventSave"
  | "calendarEventDelete"
  | "calendarUnlink"
  | "calendarSync"
  | "calendarHelp"
  | "onCalendarSynced"
>;

/** Nularche AI otomatik modunun (Gemini) köprü yüzü: masaüstünde preload, web sürümünde tarayıcı (web/ai-web.ts). */
export type AutoBridge = Required<Pick<DesktopBridge, "autoStatus" | "autoSetKey" | "autoClear" | "autoEnable" | "autoRun" | "autoRetry" | "autoCancel" | "transcribe">>;

/** Web sürümünün açık oturumu (web/boot.ts kurar; masaüstünde yoktur). */
export interface WebSession {
  account: string;
  encrypted: boolean;
  calendar: CalendarBridge;
  ai: AutoBridge;
  /** Notların Drive ile eşitlenme durumu. */
  driveStatus(): WebDriveStatus;
  onDriveStatus(cb: () => void): () => void;
  syncNow(): Promise<void>;
  /** Değişiklikleri gönderir, notları ve anahtarları bellekten siler; yeniden açmak için giriş gerekir. */
  lock(): Promise<void>;
  /** Kilitler ve Google oturumunu da kapatır (izin geri alınır). */
  signOut(): Promise<void>;
}
export type WebDriveStatus = { state: "syncing" } | { state: "idle"; at: number } | { state: "error"; code: string; message: string; count?: number } | { state: "starting" };

export const webSession: WebSession | undefined = (window as unknown as { nularcheWeb?: WebSession }).nularcheWeb;
export const calendarBridge: CalendarBridge | undefined = desktop ?? webSession?.calendar;
export const autoBridge: AutoBridge | undefined = (desktop as AutoBridge | undefined) ?? webSession?.ai;

/** Dış bağlantıyı açar: masaüstünde sistem tarayıcısında, web'de yeni sekmede. */
export function openExternal(url: string): void {
  if (desktop) void desktop.aiDownload(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

export async function copyText(text: string): Promise<void> {
  if (desktop) return desktop.copy(text);
  await navigator.clipboard.writeText(text);
}
