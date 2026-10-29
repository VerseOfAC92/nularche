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

export interface DesktopBridge {
  /** Arayüz hazır; ana süreçte bekleyen gezinme varsa döndürür. */
  /** Masaüstü ayarlarında kayıtlı arayüz dili (yoksa null). */
  language: "tr" | "en" | null;
  /** Masaüstü ayarlarında kayıtlı tema seçimi (yoksa null = sistem). */
  theme: "dark" | "light" | "system" | null;
  setTheme(theme: "dark" | "light" | "system"): Promise<void>;
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
  /** AI uygulamasını yeniden başlatır (Claude Desktop: kapat + aç; diğerleri: aç). */
  aiRestart(launcher: LauncherId): Promise<{ ok: boolean; error?: string }>;
  aiOpen(launcher: LauncherId, prompt: string | null): Promise<{ opened: boolean; message?: string }>;
  aiDownload(url: string): Promise<void>;
  /** Bir AI aracı Nularche'ye ilk kez bağlandığında. */
  onAiConnected(cb: (client: AiClientRecord) => void): () => void;
  printPdf(name: string): Promise<string | null>;
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

export const desktop: DesktopBridge | undefined = (window as unknown as { nularche?: DesktopBridge }).nularche;

export async function copyText(text: string): Promise<void> {
  if (desktop) return desktop.copy(text);
  await navigator.clipboard.writeText(text);
}
