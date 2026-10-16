// Terminal tabanlı AI araçlarını (Claude Code, Codex, Antigravity) kullanıcının terminalinde açar.
// İstem uzun ve çok satırlı olabildiği için geçici bir dosyaya yazılır ve betik onu okuyarak verir;
// böylece kabuk tırnaklama sorunları oluşmaz.

import { execFile, spawn } from "node:child_process";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const quoteSh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const quotePs = (s: string) => `'${s.replace(/'/g, "''")}'`;

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

/** `executable`'ı yeni bir terminal penceresinde başlatır; `prompt` verilirse ilk argüman olarak geçirir. */
export async function openInTerminal(executable: string, prompt: string | null): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "nularche-ai-"));
  const promptFile = path.join(dir, "istem.txt");
  if (prompt) await writeFile(promptFile, prompt);

  if (process.platform === "win32") {
    const script = path.join(dir, "baslat.ps1");
    const call = prompt ? `& ${quotePs(executable)} (Get-Content -Raw -Encoding UTF8 ${quotePs(promptFile)})` : `& ${quotePs(executable)}`;
    await writeFile(script, `﻿${call}\r\n`);
    await run("cmd.exe", ["/c", "start", "", "powershell.exe", "-NoExit", "-ExecutionPolicy", "Bypass", "-File", script]);
    return;
  }

  const script = path.join(dir, process.platform === "darwin" ? "baslat.command" : "baslat.sh");
  const call = prompt ? `${quoteSh(executable)} "$(cat ${quoteSh(promptFile)})"` : quoteSh(executable);
  await writeFile(script, `#!/bin/sh\ncd "$HOME"\n${call}\nexec "\${SHELL:-/bin/sh}" -l\n`);
  await chmod(script, 0o755);

  if (process.platform === "darwin") {
    // .command dosyası Terminal'de açılır; Otomasyon izni gerektirmez.
    await new Promise<void>((resolve, reject) => execFile("open", ["-a", "Terminal", script], (err) => (err ? reject(err) : resolve())));
    return;
  }
  const candidates: [string, string[]][] = [
    ["x-terminal-emulator", ["-e", script]],
    ["gnome-terminal", ["--", script]],
    ["konsole", ["-e", script]],
    ["xfce4-terminal", ["-x", script]],
    ["kitty", [script]],
    ["alacritty", ["-e", script]],
    ["xterm", ["-e", script]],
  ];
  for (const [cmd, args] of candidates) {
    try {
      await run(cmd, args);
      return;
    } catch {
      // sıradaki terminali dene
    }
  }
  throw new Error("Terminal bulunamadı. İstem panoya kopyalandı; aracı kendi terminalinizde açıp yapıştırın.");
}
