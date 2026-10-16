// Markdown gövdesindeki göreli bağlantılar (sayfa bağlantıları ve ekler).
// Bağlantılar notun kendi konumuna göre göreli, URL-kodlu POSIX yollarıdır, ör. `../Projeler/Plan.md`.
// Böylece vault başka bir Markdown aracında (Obsidian, VS Code, GitHub) da çalışır.

import path from "node:path";

// [metin](hedef "başlık") ve ![alt](hedef); hedefte boşluk olmaz (URL-kodlu).
const LINK_RE = /(!?\[(?:[^\]\\]|\\.)*\]\()(<[^>]*>|[^)\s]+)((?:\s+"[^"]*")?\))/g;

export interface BodyLink {
  /** Bağlantının vault'a göre çözülmüş yolu. */
  target: string;
  image: boolean;
}

function isRelative(url: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith("/") && !url.startsWith("#");
}

function decode(url: string): string {
  const raw = url.startsWith("<") ? url.slice(1, -1) : url;
  try {
    return decodeURIComponent(raw.split("#")[0]);
  } catch {
    return raw.split("#")[0];
  }
}

/** Vault yolunu bir nottan göreli, URL-kodlu bağlantıya çevirir. */
export function relativeLink(fromNotePath: string, targetPath: string): string {
  const rel = path.posix.relative(path.posix.dirname(fromNotePath), targetPath) || path.posix.basename(targetPath);
  return rel.split("/").map(encodeURIComponent).join("/");
}

/** Nottaki bağlantıyı vault'a göre yola çözer; vault dışına çıkan ya da dış bağlantılar için null. */
export function resolveLink(fromNotePath: string, url: string): string | null {
  if (!isRelative(url)) return null;
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(fromNotePath), decode(url)));
  if (target.startsWith("../") || target === "..") return null;
  return target;
}

export function extractLinks(notePath: string, body: string): BodyLink[] {
  const out: BodyLink[] = [];
  for (const m of body.matchAll(LINK_RE)) {
    const target = resolveLink(notePath, m[2]);
    if (target) out.push({ target, image: m[1].startsWith("!") });
  }
  return out;
}

/**
 * Bir not taşındığında/yeniden adlandırıldığında gövdedeki göreli bağlantıları yeniden yazar.
 * `oldNotePath` bağlantıların çözüleceği eski konum, `newNotePath` notun yeni konumudur;
 * `moved` taşınan diğer dosyaların eski→yeni yol eşlemesidir. Değişmeyen bağlantılar olduğu gibi kalır.
 */
export function rewriteLinks(body: string, oldNotePath: string, newNotePath: string, moved: Map<string, string>): string {
  return body.replace(LINK_RE, (whole, open: string, url: string, close: string) => {
    const target = resolveLink(oldNotePath, url);
    if (!target) return whole;
    const anchor = url.includes("#") ? url.slice(url.indexOf("#")) : "";
    const newTarget = moved.get(target) ?? target;
    if (newTarget === target && oldNotePath === newNotePath) return whole;
    const next = relativeLink(newNotePath, newTarget) + (anchor.endsWith(">") ? anchor.slice(0, -1) : anchor);
    return `${open}${next}${close}`;
  });
}
