// Tabula (beyaz tahta) sayfalarındaki veri (```json whiteboard bloğu): görsel öğelerinin başvurduğu Origin dosyaları.
// Bağlantı grafiği bu başvuruları bağlantı sayar; dosya taşınınca/yeniden adlandırılınca yollar güncellenir.

const BLOCK_RE = /```json whiteboard\n([\s\S]*?)\n```/;

type Raw = { items?: { type?: unknown; file?: unknown }[] };

export function whiteboardFiles(body: string): string[] {
  const m = BLOCK_RE.exec(body);
  if (!m) return [];
  try {
    const data = JSON.parse(m[1]) as Raw;
    return (Array.isArray(data.items) ? data.items : []).flatMap((i) => (i && i.type === "image" && typeof i.file === "string" ? [i.file] : []));
  } catch {
    return [];
  }
}

export function rewriteWhiteboardFiles(body: string, moved: Map<string, string>): string {
  const m = BLOCK_RE.exec(body);
  if (!m) return body;
  let data: Raw;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return body;
  }
  let changed = false;
  for (const i of Array.isArray(data.items) ? data.items : []) {
    if (i && i.type === "image" && typeof i.file === "string" && moved.has(i.file)) {
      i.file = moved.get(i.file);
      changed = true;
    }
  }
  return changed ? body.replace(BLOCK_RE, () => `\`\`\`json whiteboard\n${JSON.stringify(data)}\n\`\`\``) : body;
}
