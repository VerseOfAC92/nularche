// Tarayıcı tarafı POSIX yol yardımcıları ve editör ↔ dosya bağlantı dönüşümü.
// Dosyada bağlantılar notun konumuna göre görelidir (core/src/links.ts ile aynı kural);
// editörde ise tarayıcının çözebilmesi için `/files/<vault yolu>` biçimine çevrilir.
// Dönüşüm yalnızca editörün yükleme/kaydetme sınırında yapılır.

export function normalize(p: string): string {
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0 || out[out.length - 1] === "..") out.push("..");
      else out.pop();
    } else out.push(seg);
  }
  return out.join("/");
}

export function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

export function relative(fromDir: string, to: string): string {
  const a = fromDir ? fromDir.split("/") : [];
  const b = to.split("/");
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
}

const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

function decodePath(p: string): string {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

const LINK_RE = /(!?\[(?:[^\]\\]|\\.)*\]\()(<[^>]*>|[^)\s]+)((?:\s+"[^"]*")?\))/g;
const isRelative = (url: string) => !/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith("/") && !url.startsWith("#");

/** Vault yolunu editörde kullanılan URL'ye çevirir. */
export const fileUrl = (vaultPath: string) => `/files/${encodePath(vaultPath)}`;

/** Editör URL'sinden vault yolunu çıkarır; değilse null. */
export function vaultPathFromUrl(url: string): string | null {
  if (!url.startsWith("/files/")) return null;
  return decodePath(url.slice(7).split("#")[0]);
}

/** Bir nota göre göreli bağlantıyı vault yoluna çözer (vault dışıysa null). */
export function resolveRelative(notePath: string, url: string): string | null {
  if (!isRelative(url)) return null;
  const raw = url.startsWith("<") ? url.slice(1, -1) : url;
  const target = normalize(`${dirname(notePath)}/${decodePath(raw.split("#")[0])}`);
  return target.startsWith("..") ? null : target;
}

/** Dosyadaki Markdown → editör: göreli bağlantılar `/files/...` olur. */
export function toEditorMarkdown(md: string, notePath: string): string {
  return md.replace(LINK_RE, (whole, open: string, url: string, close: string) => {
    const target = resolveRelative(notePath, url);
    if (target === null) return whole;
    const anchor = url.includes("#") ? url.slice(url.indexOf("#")).replace(/>$/, "") : "";
    return `${open}${fileUrl(target)}${anchor}${close}`;
  });
}

/** Editör → dosya: `/files/...` bağlantıları notun konumuna göre göreli olur. */
export function fromEditorMarkdown(md: string, notePath: string): string {
  return md.replace(LINK_RE, (whole, open: string, url: string, close: string) => {
    const target = vaultPathFromUrl(url);
    if (target === null) return whole;
    const anchor = url.includes("#") ? url.slice(url.indexOf("#")) : "";
    return `${open}${encodePath(relative(dirname(notePath), target))}${anchor}${close}`;
  });
}
