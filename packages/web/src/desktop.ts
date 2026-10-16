// Masaüstü uygulamasında preload'un açtığı köprü; tarayıcıda çalışırken undefined'dır.

export interface ClaudeStatus {
  plan:
    | { configPath: string; status: "unchanged" | "add" | "update"; entry: unknown; otherServers: string[]; legacyServers: string[] }
    | { error: string };
  running: boolean;
  claudeCode: string;
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
  claudeStatus(): Promise<ClaudeStatus>;
  claudeApply(): Promise<{ ok: boolean; backup?: string | null; error?: string }>;
  openClaude(prompt: string): Promise<{ opened: boolean }>;
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
