// Tarayıcıda Node'un `Buffer` sınıfı: `buffer` paketi, Node'un da desteklediği `base64url` kodlamasıyla
// tamamlanır (paket bu kodlamayı tanımıyor). Web sürümünde `globalThis.Buffer` budur (bkz. globals.ts).

import { Buffer as Base } from "buffer";

type Enc = BufferEncoding;

const toB64 = (s: string) => {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  return b + "=".repeat((4 - (b.length % 4)) % 4);
};

const origFrom = Base.from.bind(Base) as (...args: unknown[]) => Base;
(Base as unknown as { from: (...args: unknown[]) => Base }).from = (value: unknown, enc?: unknown, len?: unknown) =>
  typeof value === "string" && enc === "base64url" ? origFrom(toB64(value), "base64") : origFrom(value, enc as Enc, len);

const origToString = Base.prototype.toString;
Base.prototype.toString = function (this: Base, enc?: string, start?: number, end?: number) {
  if (enc === "base64url") return origToString.call(this, "base64", start, end).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return origToString.call(this, enc as Enc, start, end);
} as typeof Base.prototype.toString;

const origIsEncoding = Base.isEncoding.bind(Base);
Base.isEncoding = (e: string) => e === "base64url" || origIsEncoding(e);

const origByteLength = Base.byteLength.bind(Base) as (...args: unknown[]) => number;
(Base as unknown as { byteLength: (...args: unknown[]) => number }).byteLength = (s: unknown, enc?: unknown) =>
  typeof s === "string" && enc === "base64url" ? origByteLength(toB64(s), "base64") : origByteLength(s, enc);

export const Buffer = Base;
export default { Buffer: Base };
