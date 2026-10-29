// Dışa aktarma: masaüstünde kaydetme penceresiyle (ana süreç), tarayıcıda indirme olarak.

import { desktop } from "./desktop.ts";
import { getLang } from "./i18n/index.ts";

export type ExportKind = "md" | "html" | "site" | "rtf" | "docx" | "txt";

/** Sonuç: kaydedilen yol (masaüstü), "downloaded" (tarayıcı) ya da vazgeçildiyse null. Hata fırlatabilir. */
export async function exportNode(kind: ExportKind, nodeId: string | null): Promise<string | null> {
  if (desktop) {
    const res = await desktop.exportAs(kind, nodeId);
    if (!res.ok) throw new Error(res.error ?? "export failed");
    return res.path ?? null;
  }
  const lang = getLang();
  const url = nodeId ? `/api/nodes/${encodeURIComponent(nodeId)}/export?format=${kind}&lang=${lang}` : `/api/site?lang=${lang}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { message?: string } | null)?.message ?? r.statusText);
  const name = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? "export");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(await r.blob());
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return "downloaded";
}
