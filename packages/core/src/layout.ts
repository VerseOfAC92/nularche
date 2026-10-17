// Origin dosya düzeni kuralları (tek sahip). Node'lar düz Markdown dosyalarıdır:
//   Alt Node'u olmayan Node   →  `Klasör/Not.md`
//   Alt Node'u olan Node      →  `Klasör/Not/Not.md` (klasör notu); alt Node'ları `Klasör/Not/` içindedir.
// Eski sürümlerin düzeni (`Not.md` + yanında `Not/` klasörü) okunmaya devam eder ve açılışta klasör notuna çevrilir.

import path from "node:path";

const { posix } = path;

/** `D/D.md` biçiminde mi: dosya adı içinde bulunduğu klasörün adıyla aynı. */
export function isFolderNote(notePath: string): boolean {
  const dir = posix.dirname(notePath);
  return dir !== "." && posix.basename(dir) === posix.basename(notePath, posix.extname(notePath));
}

/** Node'un alt Node'larının bulunduğu klasör. */
export function childDirOf(notePath: string): string {
  return isFolderNote(notePath) ? posix.dirname(notePath) : notePath.slice(0, -3);
}

/** Node'un (klasörüyle birlikte) içinde durduğu klasör; kök için "". */
export function containerDirOf(notePath: string): string {
  const dir = isFolderNote(notePath) ? posix.dirname(posix.dirname(notePath)) : posix.dirname(notePath);
  return dir === "." ? "" : dir;
}

/** Node'un adı: klasör notunda klasör adı, değilse dosya adı (uzantısız). */
export function unitNameOf(notePath: string): string {
  return isFolderNote(notePath) ? posix.basename(posix.dirname(notePath)) : posix.basename(notePath, ".md");
}

/** Bir klasörün sahibi olan Node için olası dosya yolları: önce klasör notu, sonra eski düzendeki komşu dosya. */
export function ownerPathsOf(dir: string): string[] {
  return [`${dir}/${posix.basename(dir)}.md`, `${dir}.md`];
}

/** Klasördeki ad için Node yolu: klasör notu olarak ya da tek dosya olarak. */
export function notePathFor(dir: string, name: string, asFolder: boolean): string {
  const base = dir ? `${dir}/${name}` : name;
  return asFolder ? `${base}/${name}.md` : `${base}.md`;
}
