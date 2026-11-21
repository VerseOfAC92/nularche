// `node:fs/promises` yerine geçen modül (web sürümü): çekirdeğin kullandığı işlevler, bellek içi dosya sistemi
// (vfs.ts) üzerinde, Node ile aynı imza ve hata kodlarıyla. Yeni bir fs işlevi kullanılmaya başlanırsa buraya
// eklenmeli; `npm run test:web-platform` çekirdek testlerini bu modülle çalıştırarak eksikleri yakalar.

import { Buffer } from "./buffer.ts";
import { vfs, VfsError } from "./vfs.ts";

type EncodingOpt = BufferEncoding | { encoding?: BufferEncoding | null; flag?: string } | null | undefined;

const encodingOf = (o: EncodingOpt) => (typeof o === "string" ? o : (o?.encoding ?? null));
const pathOf = (p: string | URL) => (p instanceof URL ? decodeURIComponent(p.pathname) : String(p));

export async function readFile(p: string | URL, opts?: EncodingOpt): Promise<never> {
  const data = vfs.readFile(pathOf(p));
  const e = encodingOf(opts);
  return (e ? Buffer.from(data).toString(e) : Buffer.from(data)) as never;
}

export async function writeFile(p: string | URL, data: string | Uint8Array, opts?: EncodingOpt): Promise<void> {
  const e = encodingOf(opts);
  const bytes = typeof data === "string" ? (e && e !== "utf8" && e !== "utf-8" ? Buffer.from(data, e) : data) : data;
  vfs.writeFile(pathOf(p), bytes, { flag: typeof opts === "object" && opts ? opts.flag : undefined });
}

export async function mkdir(p: string | URL, opts?: { recursive?: boolean } | number): Promise<string | undefined> {
  return vfs.mkdir(pathOf(p), typeof opts === "object" ? opts : {});
}

export interface Dirent {
  name: string;
  parentPath: string;
  path: string;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export async function readdir(p: string | URL, opts?: { withFileTypes?: boolean } | BufferEncoding): Promise<never> {
  const dir = pathOf(p);
  const names = vfs.readdir(dir);
  if (typeof opts !== "object" || !opts?.withFileTypes) return names as never;
  const abs = dir.endsWith("/") ? dir.slice(0, -1) : dir;
  return names.map((name) => {
    const kind = vfs.get(`${abs}/${name}`)?.kind;
    return { name, parentPath: abs, path: abs, isFile: () => kind === "file", isDirectory: () => kind === "dir", isSymbolicLink: () => false } satisfies Dirent;
  }) as never;
}

export async function rename(from: string | URL, to: string | URL): Promise<void> {
  vfs.rename(pathOf(from), pathOf(to));
}

export async function rm(p: string | URL, opts?: { recursive?: boolean; force?: boolean }): Promise<void> {
  vfs.rm(pathOf(p), opts ?? {});
}

export async function unlink(p: string | URL): Promise<void> {
  const e = vfs.get(pathOf(p));
  if (e?.kind === "dir") throw new VfsError("EPERM", "unlink", pathOf(p));
  vfs.rm(pathOf(p));
}

export interface Stats {
  size: number;
  mtimeMs: number;
  birthtimeMs: number;
  ctimeMs: number;
  atimeMs: number;
  mtime: Date;
  birthtime: Date;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export async function stat(p: string | URL): Promise<Stats> {
  const e = vfs.get(pathOf(p));
  if (!e) throw new VfsError("ENOENT", "stat", pathOf(p));
  return {
    size: e.kind === "file" ? e.data.byteLength : 0,
    mtimeMs: e.mtimeMs,
    birthtimeMs: e.birthtimeMs,
    ctimeMs: e.mtimeMs,
    atimeMs: e.mtimeMs,
    mtime: new Date(e.mtimeMs),
    birthtime: new Date(e.birthtimeMs),
    isFile: () => e.kind === "file",
    isDirectory: () => e.kind === "dir",
    isSymbolicLink: () => false,
  };
}

export const lstat = stat;

export async function access(p: string | URL): Promise<void> {
  if (!vfs.get(pathOf(p))) throw new VfsError("ENOENT", "access", pathOf(p));
}

export async function utimes(p: string | URL, _atime: number | Date, mtime: number | Date): Promise<void> {
  vfs.utimes(pathOf(p), typeof mtime === "number" ? mtime * 1000 : mtime.getTime());
}

export async function copyFile(from: string | URL, to: string | URL): Promise<void> {
  vfs.writeFile(pathOf(to), vfs.readFile(pathOf(from)));
}

export async function mkdtemp(prefix: string): Promise<string> {
  for (;;) {
    const dir = `${prefix}${Math.random().toString(36).slice(2, 8)}`;
    if (!vfs.get(dir)) {
      vfs.mkdir(dir, { recursive: true });
      return dir;
    }
  }
}

export default { readFile, writeFile, mkdir, readdir, rename, rm, unlink, stat, lstat, access, utimes, copyFile, mkdtemp };
