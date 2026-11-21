// Çekirdeğin web sürümünde kullanılan kısmını (packages/web-platform/src/core-entry.ts) tarayıcı için derler ve
// pakette Node modülü kalmadığını denetler. Kalırsa ya platform katmanına bir karşılık eklenmeli ya da modül web
// girişinden çıkarılmalı.

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "vite";
import { WEB_CORE_ENTRY, WEB_PLATFORM_ALIASES } from "../../packages/web-platform/src/aliases.ts";

const out = await mkdtemp(path.join(tmpdir(), "nularche-web-core-"));
const warnings: string[] = [];
try {
  await build({
    configFile: false,
    logLevel: "silent",
    resolve: { alias: WEB_PLATFORM_ALIASES },
    build: {
      lib: { entry: WEB_CORE_ENTRY, formats: ["es"], fileName: "core" },
      outDir: out,
      minify: false,
      rollupOptions: { onwarn: (w) => void warnings.push(String(w.message)) },
    },
  });
  const files = (await readdir(out)).filter((f) => f.endsWith(".js"));
  const code = (await Promise.all(files.map((f) => readFile(path.join(out, f), "utf8")))).join("\n");
  const leaks = [...new Set([...code.matchAll(/["'](node:[\w/]+)["']|__vite-browser-external:([\w:/]+)/g)].map((m) => m[1] ?? m[2]))];
  const external = warnings.filter((w) => /externalized for browser compatibility|node:/.test(w));
  if (leaks.length || external.length) {
    console.error("Tarayıcı paketinde Node modülü kaldı:", [...leaks, ...external].join("\n  "));
    process.exit(1);
  }
  console.log(`Çekirdeğin web paketi temiz: ${(code.length / 1024).toFixed(0)} KB, Node modülü yok.`);
} finally {
  await rm(out, { recursive: true, force: true });
}
