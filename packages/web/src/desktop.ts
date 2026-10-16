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
  rendererReady(): Promise<string | null>;
  info(): Promise<{ version: string; platform: string; originDir: string; warning: string | null }>;
  changeOrigin(): Promise<string | null>;
  revealOrigin(): Promise<void>;
  copy(text: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  aiStatus(): Promise<AiStatus>;
  aiSet(patch: { provider?: ProviderId | null; launcher?: LauncherId; onboarded?: boolean }): Promise<void>;
  aiConnect(
    id: ConnectionId,
    options?: { restartApp?: boolean },
  ): Promise<{ ok: boolean; backup?: string | null; error?: string; needsRestart?: boolean; restarted?: boolean }>;
  /** AI uygulamasını yeniden başlatır (Claude Desktop: kapat + aç; diğerleri: aç). */
  aiRestart(launcher: LauncherId): Promise<{ ok: boolean; error?: string }>;
  aiOpen(launcher: LauncherId, prompt: string | null): Promise<{ opened: boolean; message?: string }>;
  aiDownload(url: string): Promise<void>;
  /** Bir AI aracı Nularche'ye ilk kez bağlandığında. */
  onAiConnected(cb: (client: AiClientRecord) => void): () => void;
  printPdf(name: string): Promise<string | null>;
  exportArchive(nodeId: string | null, kind: "nlc" | "nla"): Promise<string | null>;
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
