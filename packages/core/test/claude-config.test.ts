import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { applyClaudeDesktop, claudeCodeCommand, planClaudeDesktop, type McpEntry } from "../src/index.ts";

const entry: McpEntry = {
  command: "/Applications/Nularche.app/Contents/MacOS/Nularche",
  args: ["/x/mcp.js"],
  env: { ELECTRON_RUN_AS_NODE: "1", NULARCHE_ORIGIN: "/Users/a/Notlar" },
};

test("diğer sunucuları koruyarak ekler, yedek alır ve idempotenttir", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "nularche-cfg-"));
  try {
    const file = path.join(dir, "claude_desktop_config.json");
    await writeFile(file, JSON.stringify({ mcpServers: { rea: { command: "rea" } }, preferences: { a: 1 } }));
    const plan = await planClaudeDesktop(entry, file);
    assert.equal(plan.status, "add");
    assert.deepEqual(plan.otherServers, ["rea"]);
    const { backup } = await applyClaudeDesktop(entry, file, { checkRunning: false });
    assert.ok(backup);
    const written = JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual(written.mcpServers.rea, { command: "rea" });
    assert.deepEqual(written.mcpServers.nularche, entry);
    assert.deepEqual(written.preferences, { a: 1 });
    assert.equal((await planClaudeDesktop(entry, file)).status, "unchanged");
    assert.equal((await readdir(dir)).filter((f) => f.includes(".bak-")).length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bozuk config'e yazmayı reddeder", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "nularche-cfg-"));
  try {
    const file = path.join(dir, "c.json");
    await writeFile(file, "{bozuk");
    await assert.rejects(applyClaudeDesktop(entry, file, { checkRunning: false }));
    assert.equal(await readFile(file, "utf8"), "{bozuk");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Claude Code komutu boşluklu yolları tırnaklar", () => {
  const cmd = claudeCodeCommand({ command: "/A B/node", args: ["/x/mcp.js"], env: { NULARCHE_ORIGIN: "/a b" } });
  assert.equal(cmd, "claude mcp add nularche --scope user -e 'NULARCHE_ORIGIN=/a b' -- '/A B/node' /x/mcp.js");
});
