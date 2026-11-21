// Node modül yükleyici kancası: çekirdeğin (ve testlerinin) Node modüllerini web sürümünün platform katmanıyla
// değiştirir. Böylece çekirdek testleri, tarayıcıdaki bellek içi dosya sistemi ve şifreleme modülleriyle aynen
// çalıştırılır (`npm run test:web-platform`).

const root = new URL("../../", import.meta.url).href;
const shim = (f) => new URL(`packages/web-platform/src/${f}`, root).href;
const MAP = {
  "node:fs/promises": shim("fs.ts"),
  "fs/promises": shim("fs.ts"),
  "node:fs": shim("fs-sync.ts"),
  "node:crypto": shim("crypto.ts"),
  "crypto": shim("crypto.ts"),
  "node:path": shim("path.ts"),
  "path": shim("path.ts"),
  "node:zlib": shim("zlib.ts"),
};
const OURS = [`${root}packages/core/`, `${root}packages/server/`];

export async function resolve(specifier, context, next) {
  const target = MAP[specifier];
  if (target && context.parentURL && OURS.some((p) => context.parentURL.startsWith(p))) return { url: target, shortCircuit: true };
  return next(specifier, context);
}
