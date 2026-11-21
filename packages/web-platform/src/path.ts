// `node:path` yerine geçen modül (web sürümü): tarayıcıda yollar her zaman POSIX biçimindedir.
// path-browserify, Node'un `path.posix` uygulamasının kopyasıdır (MIT).

import posix from "path-browserify";

const p = posix as unknown as typeof import("node:path").posix;
export const { join, dirname, basename, extname, resolve, relative, normalize, isAbsolute, sep, delimiter, parse, format } = p;
export { p as posix };
export default Object.assign({}, p, { posix: p });
