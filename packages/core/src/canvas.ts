// Tuval sayfalarındaki JSON Canvas verisi (```json canvas bloğu): kartların başvurduğu dosyalar (vault yolları).
// Bağlantı grafiği ve geri bağlantılar bu başvuruları bağlantı sayar; not taşınınca/yeniden adlandırılınca güncellenir.

const BLOCK_RE = /```json canvas\n([\s\S]*?)\n```/;

/** Kartların `file` başvuruları; blok yoksa ya da bozuksa boş. */
export function canvasFiles(body: string): string[] {
  const m = BLOCK_RE.exec(body);
  if (!m) return [];
  try {
    const data = JSON.parse(m[1]) as { nodes?: { type?: unknown; file?: unknown }[] };
    return (Array.isArray(data.nodes) ? data.nodes : []).flatMap((n) => (n && n.type === "file" && typeof n.file === "string" ? [n.file] : []));
  } catch {
    return [];
  }
}

/** Taşınan dosyaların (eski → yeni yol) kart başvurularını günceller; değişiklik yoksa gövde aynen döner. */
export function rewriteCanvasFiles(body: string, moved: Map<string, string>): string {
  const m = BLOCK_RE.exec(body);
  if (!m) return body;
  let data: { nodes?: { type?: unknown; file?: unknown }[] };
  try {
    data = JSON.parse(m[1]);
  } catch {
    return body;
  }
  let changed = false;
  for (const n of Array.isArray(data.nodes) ? data.nodes : []) {
    if (n && n.type === "file" && typeof n.file === "string" && moved.has(n.file)) {
      n.file = moved.get(n.file);
      changed = true;
    }
  }
  return changed ? body.replace(BLOCK_RE, () => `\`\`\`json canvas\n${JSON.stringify(data, null, 2)}\n\`\`\``) : body;
}
