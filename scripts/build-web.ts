// Web sürümünü (nularche.verseofac.com/app) derler: uygulama arayüzü, giriş penceresi ve service worker. Çekirdeğin
// Node modülleri web platform katmanıyla değiştirilir (WEB_PLATFORM_ALIASES). Çıktı: packages/web/dist-web (ya da
// `--out <klasör>`); girişler `--entry <ts>` ile değiştirilebilir (denetimlerde sahte Drive'lı giriş için).

import { rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import { WEB_PLATFORM_ALIASES } from "../packages/web-platform/src/aliases.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.join(root, "packages/web");
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const out = path.resolve(arg("--out") ?? path.join(web, "dist-web"));
const entry = arg("--entry");

export async function buildWeb(outDir: string, entryOverride?: string): Promise<void> {
  const alias = [...WEB_PLATFORM_ALIASES, { find: "tabler-icons-data", replacement: path.join(root, "node_modules/@tabler/icons") }];
  await build({
    configFile: false,
    root: web,
    base: "/app/",
    logLevel: "warn",
    plugins: [
      react(),
      // Denetim girişi: app.html'deki üretim girişinin yerine verilen dosya.
      ...(entryOverride
        ? [{ name: "nularche-entry", enforce: "pre" as const, resolveId: (id: string) => (id.endsWith("/src/web/main-web.ts") ? path.resolve(entryOverride) : null) }]
        : []),
    ],
    resolve: { alias },
    build: { outDir, emptyOutDir: true, chunkSizeWarningLimit: 4000, rollupOptions: { input: path.join(web, "app.html") } },
  });
  await rename(path.join(outDir, "app.html"), path.join(outDir, "index.html"));
  await build({
    configFile: false,
    logLevel: "warn",
    resolve: { alias: WEB_PLATFORM_ALIASES },
    build: {
      lib: { entry: path.join(root, "packages/web-platform/src/service-worker.ts"), formats: ["iife"], fileName: () => "sw.js", name: "nularcheSw" },
      outDir,
      emptyOutDir: false,
    },
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildWeb(out, entry);
  console.log(`Web sürümü derlendi: ${path.relative(root, out)}`);
}
