// Arayüz tercihleri ve akıllı klasörler: Origin'in `.nularche/ui.json` dosyasında saklanır.
// Masaüstünde yerel sunucunun portu her açılışta değiştiğinden tarayıcı deposu kalıcı değildir; tercihler bu yüzden
// Origin ile birlikte tutulur (yedekle ve Origin'le taşınır). Gizli klasör olduğu için Node taramasına girmez.

import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const FILE = path.join(".nularche", "ui.json");
/** Tek bir tercih değerinin en büyük boyutu (JSON olarak). */
const MAX_VALUE_BYTES = 256 * 1024;

export type Prefs = Record<string, unknown>;

export async function readPrefs(root: string): Promise<Prefs> {
  try {
    const data = JSON.parse(await readFile(path.join(root, FILE), "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Prefs) : {};
  } catch {
    return {};
  }
}

/** Verilen anahtarları günceller (`null` siler) ve tüm tercihleri döndürür. */
export async function writePrefs(root: string, patch: Prefs): Promise<Prefs> {
  const current = await readPrefs(root);
  for (const [key, value] of Object.entries(patch)) {
    if (!/^[\w.-]{1,64}$/.test(key)) continue;
    if (value === null) delete current[key];
    else if (JSON.stringify(value).length <= MAX_VALUE_BYTES) current[key] = value;
  }
  const file = path.join(root, FILE);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(current, null, 2)}\n`);
  await rename(tmp, file);
  return current;
}

/** Kullanıcının CSS parçacıkları (Obsidian "CSS snippets"): Origin'in `.nularche/snippets/*.css` dosyaları, ada göre. */
export async function readSnippets(root: string): Promise<{ name: string; css: string }[]> {
  const dir = path.join(root, ".nularche", "snippets");
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.toLowerCase().endsWith(".css")).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
  const out: { name: string; css: string }[] = [];
  for (const name of names) {
    const css = await readFile(path.join(dir, name), "utf8").catch(() => null);
    if (css !== null && css.length <= MAX_SNIPPET_BYTES) out.push({ name: name.slice(0, -4), css });
  }
  return out;
}

/** Tek bir CSS parçacığının en büyük boyutu. */
const MAX_SNIPPET_BYTES = 512 * 1024;
