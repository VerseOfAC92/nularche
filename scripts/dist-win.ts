// Windows kurulum dosyalarını (NSIS) işlemci türünü adında belirterek ayrı ayrı derler:
//   Nularche-Windows-x64-Setup.exe   (64 bit)
//   Nularche-Windows-x86-Setup.exe   (32 bit)
// Electron 44'ten itibaren 32 bit Windows paketi yayınlanmadığı için x86 kurulum dosyası,
// hâlâ desteklenen son Electron 43 sürümüyle derlenir (uygulama kodu aynıdır).
// Kullanım: node scripts/dist-win.ts [--output <klasör>] [--only x64|ia32]

import { spawnSync } from "node:child_process";
import path from "node:path";
import { projectRoot } from "../packages/core/src/config.ts";

const arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
const root = projectRoot();
const output = arg("--output");
const only = arg("--only");
const ELECTRON_IA32 = "43.7.7";
const builds = [
  { arch: "x64", label: "x64", electron: null },
  { arch: "ia32", label: "x86", electron: ELECTRON_IA32 },
].filter((b) => !only || b.arch === only);

const bin = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "electron-builder.cmd" : "electron-builder");
for (const b of builds) {
  const args = [
    "--win",
    "nsis",
    `--${b.arch}`,
    "--publish",
    "never",
    `-c.nsis.artifactName=Nularche-Windows-${b.label}-Setup.\${ext}`,
    ...(b.electron ? [`-c.electronVersion=${b.electron}`] : []),
    ...(output ? [`-c.directories.output=${output}`] : []),
  ];
  console.log(`\n→ Windows ${b.label} derleniyor…`);
  const res = spawnSync(bin, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (res.status !== 0) process.exit(res.status ?? 1);
}
