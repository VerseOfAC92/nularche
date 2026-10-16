// Masaüstü uygulamasının Node tarafını (ana süreç, preload, MCP sunucusu) esbuild ile paketler.
// Electron'un gömülü Node'u TypeScript'i doğrudan çalıştıramadığı için gereklidir.
import { build } from "esbuild";
import path from "node:path";
import { projectRoot } from "../packages/core/src/config.ts";

const root = projectRoot();
const out = path.join(root, "dist-desktop");
const common = {
  bundle: true,
  platform: "node" as const,
  target: "node22",
  sourcemap: false,
  logLevel: "warning" as const,
  legalComments: "none" as const,
};

await Promise.all([
  build({
    ...common,
    entryPoints: [path.join(root, "packages/desktop/src/main.ts")],
    outfile: path.join(out, "main.cjs"),
    format: "cjs",
    external: ["electron"],
  }),
  build({
    ...common,
    entryPoints: [path.join(root, "packages/desktop/src/preload.ts")],
    outfile: path.join(out, "preload.cjs"),
    format: "cjs",
    external: ["electron"],
  }),
  build({
    ...common,
    entryPoints: [path.join(root, "packages/mcp/src/index.ts")],
    outfile: path.join(out, "mcp.mjs"),
    format: "esm",
    // ESM paketinde CommonJS bağımlılıklarının require çağrıları için.
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  }),
]);
console.log(`Paketlendi: ${out}`);
