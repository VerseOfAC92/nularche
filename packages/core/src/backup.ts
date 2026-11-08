// Otomatik yedekleme (2.0): Origin'in tamamı belirli aralıklarla seçilen bir klasöre `.nla` arşivi olarak yazılır ve
// en eski yedekler silinerek yalnızca son N yedek tutulur. Klasör bir iCloud Drive, Google Drive ya da OneDrive
// klasörü olabilir; Nularche hiçbir hesaba bağlanmaz, yalnızca dosya yazar. Yalnızca Nularche'nin kendi yazdığı
// (`Nularche-…-YYYYMMDD-HHMMSS.nla` adlı) dosyalar silinir.

import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { exportArchive } from "./archive.ts";
import type { NodeStore } from "./node-store.ts";

export type BackupInterval = "off" | "hourly" | "daily" | "weekly";
export const BACKUP_INTERVALS: readonly BackupInterval[] = ["off", "hourly", "daily", "weekly"];
export const INTERVAL_MS: Record<Exclude<BackupInterval, "off">, number> = { hourly: 3_600_000, daily: 86_400_000, weekly: 7 * 86_400_000 };

const NAME_RE = /^Nularche-.+-\d{8}-\d{6}\.nla$/;

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "Origin";
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export interface BackupInfo {
  file: string;
  name: string;
  size: number;
  createdAt: number;
}

/** Klasördeki Nularche yedekleri (en yeni önce). */
export async function listBackups(dir: string, originName?: string): Promise<BackupInfo[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const prefix = originName ? `Nularche-${safeName(originName)}-` : "Nularche-";
  const out: BackupInfo[] = [];
  for (const name of names) {
    if (!NAME_RE.test(name) || !name.startsWith(prefix)) continue;
    const st = await stat(path.join(dir, name)).catch(() => null);
    if (st?.isFile()) out.push({ file: path.join(dir, name), name, size: st.size, createdAt: st.mtimeMs });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** Yedek alır ve aynı Origin'in en eski yedeklerini `keep` sayısına indirir. */
export async function backupOrigin(store: NodeStore, options: { dir: string; originName: string; keep: number; now?: Date }): Promise<BackupInfo> {
  const keep = Math.max(1, Math.min(200, Math.floor(options.keep) || 10));
  await mkdir(options.dir, { recursive: true });
  const { data } = await exportArchive(store, { kind: "nla" });
  const name = `Nularche-${safeName(options.originName)}-${stamp(options.now ?? new Date())}.nla`;
  const file = path.join(options.dir, name);
  const tmp = path.join(options.dir, `.${name}.tmp`);
  await writeFile(tmp, data);
  await rename(tmp, file);
  const all = await listBackups(options.dir, options.originName);
  for (const old of all.filter((b) => b.name !== name).slice(keep - 1)) await rm(old.file, { force: true });
  return { file, name, size: data.length, createdAt: Date.now() };
}

/** Yedek zamanı geldi mi? */
export function backupDue(interval: BackupInterval, lastAt: number | null | undefined, now = Date.now()): boolean {
  if (interval === "off") return false;
  return !lastAt || now - lastAt >= INTERVAL_MS[interval];
}
