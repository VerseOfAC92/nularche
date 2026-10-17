// macOS paketlerini işlemci türünü adında ve DMG başlığında açıkça belirterek derler:
//   Nularche-macOS-AppleSilicon.dmg  (M1, M2, M3, M4, M5…)
//   Nularche-macOS-Intel.dmg
// Kullanım: node scripts/dist-mac.ts [--output <klasör>] [--only arm64|x64]

import { spawnSync } from "node:child_process";
import path from "node:path";
import { projectRoot } from "../packages/core/src/config.ts";

const arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
const root = projectRoot();
const output = arg("--output");
const only = arg("--only");
const builds = [
  { arch: "arm64", label: "AppleSilicon", title: "Apple Silicon" },
  { arch: "x64", label: "Intel", title: "Intel" },
].filter((b) => !only || b.arch === only);

const bin = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "electron-builder.cmd" : "electron-builder");
for (const b of builds) {
  const args = [
    "--mac",
    "dmg",
    `--${b.arch}`,
    "--publish",
    "never",
    `-c.mac.artifactName=Nularche-macOS-${b.label}.\${ext}`,
    `-c.dmg.title=Nularche \${version} (${b.title})`,
    ...(output ? [`-c.directories.output=${output}`] : []),
  ];
  console.log(`\n→ macOS ${b.title} derleniyor…`);
  const res = spawnSync(bin, args, { cwd: root, stdio: "inherit" });
  if (res.status !== 0) process.exit(res.status ?? 1);
}
