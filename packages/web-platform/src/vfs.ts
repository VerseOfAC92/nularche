// Tarayıcı için bellek içi dosya sistemi. Nularche'nin çekirdeği dosya işlemlerini `node:fs/promises` üzerinden
// yapar; web sürümünde bu modül onun yerini alır (bkz. fs.ts ve docs/web-version.md). Yollar POSIX biçimindedir
// ve mutlaktır. Davranış, çekirdeğin kullandığı Node işlevleriyle (hata kodları dahil) aynı tutulur; bunu çekirdeğin
// kendi testleri bu dosya sistemi üzerinde de çalıştırılarak denetler.
//
// Değişiklikler dinlenebilir (`onChange`): web sürümü bunları Google Drive'a eşitlemek için kullanır.

import posix from "path-browserify";

export interface VfsFile {
  kind: "file";
  data: Uint8Array;
  mtimeMs: number;
  birthtimeMs: number;
}

export interface VfsDir {
  kind: "dir";
  mtimeMs: number;
  birthtimeMs: number;
}

export type VfsEntry = VfsFile | VfsDir;

export type VfsChange = { type: "write" | "remove"; path: string };

/** Node'daki gibi `code` taşıyan dosya sistemi hatası (ör. ENOENT). */
export class VfsError extends Error {
  readonly code: string;
  readonly path: string;
  constructor(code: string, syscall: string, path: string) {
    super(`${code}: ${syscall} '${path}'`);
    this.code = code;
    this.path = path;
  }
}

const enc = new TextEncoder();

export class Vfs {
  private entries = new Map<string, VfsEntry>([["/", { kind: "dir", mtimeMs: Date.now(), birthtimeMs: Date.now() }]]);
  private listeners = new Set<(c: VfsChange) => void>();
  private clock = 0;

  /** Zaman damgaları artan olsun (aynı milisaniyedeki iki yazım ayırt edilebilsin). */
  private now(): number {
    const t = Date.now();
    this.clock = t > this.clock ? t : this.clock + 0.001;
    return this.clock;
  }

  static norm(p: string): string {
    if (typeof p !== "string" || p.includes("\0")) throw new VfsError("EINVAL", "path", String(p));
    const abs = posix.resolve("/", p);
    return abs.length > 1 && abs.endsWith("/") ? abs.slice(0, -1) : abs;
  }

  onChange(fn: (c: VfsChange) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private emit(c: VfsChange): void {
    for (const l of this.listeners) l(c);
  }

  get(p: string): VfsEntry | undefined {
    return this.entries.get(Vfs.norm(p));
  }

  private parentDir(abs: string, syscall: string): VfsDir {
    const parent = this.entries.get(posix.dirname(abs));
    if (!parent) throw new VfsError("ENOENT", syscall, abs);
    if (parent.kind !== "dir") throw new VfsError("ENOTDIR", syscall, abs);
    return parent;
  }

  private children(abs: string): string[] {
    const prefix = abs === "/" ? "/" : `${abs}/`;
    const out: string[] = [];
    for (const k of this.entries.keys()) {
      if (k !== abs && k.startsWith(prefix) && !k.slice(prefix.length).includes("/")) out.push(k.slice(prefix.length));
    }
    return out.sort();
  }

  readFile(p: string): Uint8Array {
    const abs = Vfs.norm(p);
    const e = this.entries.get(abs);
    if (!e) throw new VfsError("ENOENT", "open", abs);
    if (e.kind !== "file") throw new VfsError("EISDIR", "read", abs);
    return e.data.slice();
  }

  writeFile(p: string, data: string | Uint8Array, opts: { flag?: string } = {}): void {
    const abs = Vfs.norm(p);
    const parent = this.parentDir(abs, "open");
    const prev = this.entries.get(abs);
    if (prev?.kind === "dir") throw new VfsError("EISDIR", "open", abs);
    if (prev && opts.flag === "wx") throw new VfsError("EEXIST", "open", abs);
    const t = this.now();
    const bytes = typeof data === "string" ? enc.encode(data) : new Uint8Array(data);
    this.entries.set(abs, { kind: "file", data: bytes, mtimeMs: t, birthtimeMs: prev?.birthtimeMs ?? t });
    if (!prev) parent.mtimeMs = t;
    this.emit({ type: "write", path: abs });
  }

  mkdir(p: string, opts: { recursive?: boolean } = {}): string | undefined {
    const abs = Vfs.norm(p);
    const existing = this.entries.get(abs);
    if (existing) {
      if (opts.recursive && existing.kind === "dir") return undefined;
      throw new VfsError("EEXIST", "mkdir", abs);
    }
    if (!opts.recursive) {
      this.parentDir(abs, "mkdir");
      const t = this.now();
      this.entries.set(abs, { kind: "dir", mtimeMs: t, birthtimeMs: t });
      return undefined;
    }
    let first: string | undefined;
    const parts = abs.split("/").filter(Boolean);
    let cur = "";
    for (const part of parts) {
      cur += `/${part}`;
      const e = this.entries.get(cur);
      if (e?.kind === "file") throw new VfsError("ENOTDIR", "mkdir", cur);
      if (!e) {
        const t = this.now();
        this.entries.set(cur, { kind: "dir", mtimeMs: t, birthtimeMs: t });
        first ??= cur;
      }
    }
    return first;
  }

  readdir(p: string): string[] {
    const abs = Vfs.norm(p);
    const e = this.entries.get(abs);
    if (!e) throw new VfsError("ENOENT", "scandir", abs);
    if (e.kind !== "dir") throw new VfsError("ENOTDIR", "scandir", abs);
    return this.children(abs);
  }

  rename(from: string, to: string): void {
    const a = Vfs.norm(from);
    const b = Vfs.norm(to);
    const src = this.entries.get(a);
    if (!src) throw new VfsError("ENOENT", "rename", a);
    if (a === b) return;
    this.parentDir(b, "rename");
    const dst = this.entries.get(b);
    if (src.kind === "dir" && (b + "/").startsWith(a + "/")) throw new VfsError("EINVAL", "rename", a);
    if (dst) {
      if (dst.kind === "dir" && src.kind !== "dir") throw new VfsError("EISDIR", "rename", b);
      if (dst.kind !== "dir" && src.kind === "dir") throw new VfsError("ENOTDIR", "rename", b);
      if (dst.kind === "dir" && this.children(b).length) throw new VfsError("ENOTEMPTY", "rename", b);
      this.entries.delete(b);
    }
    const moved: [string, VfsEntry][] = [];
    for (const [k, v] of this.entries) if (k === a || k.startsWith(`${a}/`)) moved.push([k, v]);
    for (const [k] of moved) this.entries.delete(k);
    for (const [k, v] of moved) this.entries.set(b + k.slice(a.length), v);
    for (const [k, v] of moved) {
      if (v.kind !== "file") continue;
      this.emit({ type: "remove", path: k });
      this.emit({ type: "write", path: b + k.slice(a.length) });
    }
  }

  rm(p: string, opts: { recursive?: boolean; force?: boolean } = {}): void {
    const abs = Vfs.norm(p);
    const e = this.entries.get(abs);
    if (!e) {
      if (opts.force) return;
      throw new VfsError("ENOENT", "rm", abs);
    }
    if (abs === "/") throw new VfsError("EPERM", "rm", abs);
    if (e.kind === "dir") {
      if (!opts.recursive) throw new VfsError("ERR_FS_EISDIR", "rm", abs);
      for (const k of [...this.entries.keys()]) {
        if (k.startsWith(`${abs}/`)) {
          const wasFile = this.entries.get(k)?.kind === "file";
          this.entries.delete(k);
          if (wasFile) this.emit({ type: "remove", path: k });
        }
      }
      this.entries.delete(abs);
      return;
    }
    this.entries.delete(abs);
    this.emit({ type: "remove", path: abs });
  }

  utimes(p: string, mtimeMs: number): void {
    const abs = Vfs.norm(p);
    const e = this.entries.get(abs);
    if (!e) throw new VfsError("ENOENT", "utime", abs);
    e.mtimeMs = mtimeMs;
  }

  /** Tüm dosyalar (yol → içerik), eşitleme ve testler için. */
  files(): Map<string, VfsFile> {
    const out = new Map<string, VfsFile>();
    for (const [k, v] of this.entries) if (v.kind === "file") out.set(k, v);
    return out;
  }

  /** Her şeyi siler (çıkış yapınca). */
  clear(): void {
    this.entries = new Map([["/", { kind: "dir", mtimeMs: Date.now(), birthtimeMs: Date.now() }]]);
  }
}

/** Uygulamanın tek dosya sistemi örneği. */
export const vfs = new Vfs();
