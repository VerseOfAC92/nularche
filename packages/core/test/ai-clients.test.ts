import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { parse } from "smol-toml";
import {
  applyConnection,
  connectionConfigPath,
  findExecutable,
  manualCommand,
  planConnection,
  removeTomlServer,
  type Env,
  type McpEntry,
} from "../src/index.ts";

const entry: McpEntry = {
  command: "/Applications/Nularche.app/Contents/MacOS/Nularche",
  args: ["/Users/a/Library/Application Support/Nularche/mcp/nularche-mcp.mjs"],
  env: { ELECTRON_RUN_AS_NODE: "1", NULARCHE_ORIGIN: "/Users/a/Nularche Origin" },
};

let home: string;
let env: Env;
const opts = () => ({ env, checkRunning: false });

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "nlc-ai-"));
  env = { platform: "darwin", home, vars: { PATH: "" } };
});
afterEach(async () => rm(home, { recursive: true, force: true }));

test("Claude Desktop: diğer sunucuları ve ayarları korur, eski 'notlar' kaydını kaldırır, idempotenttir", async () => {
  const file = connectionConfigPath("claude-desktop", env);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify({
      mcpServers: { rea: { command: "rea" }, notlar: { command: "node", args: ["/x/notlar/packages/mcp/src/index.ts"] } },
      preferences: { a: 1 },
    }),
  );
  const plan = await planConnection("claude-desktop", entry, env);
  assert.equal(plan.status, "add");
  assert.deepEqual(plan.otherServers, ["rea"]);
  assert.deepEqual(plan.legacyServers, ["notlar"]);
  const { backup } = await applyConnection("claude-desktop", entry, opts());
  assert.ok(backup);
  const written = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(Object.keys(written.mcpServers).sort(), ["nularche", "rea"]);
  assert.deepEqual(written.mcpServers.nularche, entry);
  assert.deepEqual(written.preferences, { a: 1 });
  assert.equal((await planConnection("claude-desktop", entry, env)).status, "unchanged");
});

test("Codex (ChatGPT): TOML'da yorumları ve diğer tabloları korur, kaydı günceller", async () => {
  const file = connectionConfigPath("codex", env);
  await mkdir(path.dirname(file), { recursive: true });
  const original = `# kullanıcı yorumu\nmodel = "gpt-5"\n\n[mcp_servers.diger]\ncommand = "npx"\nargs = ["-y", "x"]\n\n[mcp_servers.nularche]\ncommand = "eski"\n\n[mcp_servers.nularche.env]\nA = "1"\n\n[profiles.hizli]\nmodel = "mini"\n`;
  await writeFile(file, original);
  assert.equal((await planConnection("codex", entry, env)).status, "update");
  await applyConnection("codex", entry, opts());
  const text = await readFile(file, "utf8");
  assert.match(text, /^# kullanıcı yorumu\nmodel = "gpt-5"/);
  const parsed = JSON.parse(JSON.stringify(parse(text))) as any;
  assert.deepEqual(parsed.mcp_servers.diger, { command: "npx", args: ["-y", "x"] });
  assert.deepEqual(parsed.profiles, { hizli: { model: "mini" } });
  assert.deepEqual(parsed.mcp_servers.nularche, { command: entry.command, args: entry.args, env: entry.env });
  assert.equal((await planConnection("codex", entry, env)).status, "unchanged");
  assert.equal((await readdir(path.dirname(file))).filter((f) => f.includes(".bak-")).length, 1);
});

test("Codex: dosya yoksa oluşturur; satır içi tanımı elle düzeltme ister", async () => {
  await applyConnection("codex", entry, opts());
  const parsed = parse(await readFile(connectionConfigPath("codex", env), "utf8")) as any;
  assert.equal(parsed.mcp_servers.nularche.command, entry.command);

  const file = connectionConfigPath("codex", env);
  await writeFile(file, `[mcp_servers]\nnularche = { command = "x" }\n`);
  await assert.rejects(applyConnection("codex", entry, opts()), /elle/);
  assert.equal(await readFile(file, "utf8"), `[mcp_servers]\nnularche = { command = "x" }\n`);
});

test("Antigravity (Gemini): mcpServers JSON'una yazar", async () => {
  await applyConnection("antigravity", entry, opts());
  const file = connectionConfigPath("antigravity", env);
  assert.equal(file, path.join(home, ".gemini/config/mcp_config.json"));
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")).mcpServers.nularche, entry);
});

test("bozuk yapılandırmaya yazmayı reddeder", async () => {
  for (const id of ["claude-desktop", "codex"] as const) {
    const file = connectionConfigPath(id, env);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, id === "codex" ? "[[bozuk" : "{bozuk");
    await assert.rejects(applyConnection(id, entry, opts()), /okunamadı/);
  }
});

test("removeTomlServer yalnızca nularche tablolarını çıkarır", () => {
  const t = `a = 1\n[mcp_servers.nularche]\ncommand = "x"\n[mcp_servers.nularche.env]\nB = "2"\n[mcp_servers.nularche2]\ncommand = "y"\n`;
  assert.equal(removeTomlServer(t), `a = 1\n[mcp_servers.nularche2]\ncommand = "y"\n`);
});

test("findExecutable kısıtlı PATH'te de ~/.local/bin'i bulur", async () => {
  await mkdir(path.join(home, ".local/bin"), { recursive: true });
  await writeFile(path.join(home, ".local/bin/agy"), "");
  assert.equal(await findExecutable("agy", env), path.join(home, ".local/bin/agy"));
  assert.equal(await findExecutable("yok-boyle-bir-sey", env), null);
});

test("elle çalıştırılacak komutlar boşluklu yolları tırnaklar", () => {
  assert.equal(
    manualCommand("codex", { command: "/A B/n", args: ["/x.mjs"], env: { K: "a b" } }),
    "codex mcp add nularche --env 'K=a b' -- '/A B/n' /x.mjs",
  );
  assert.match(manualCommand("claude-code", entry)!, /^claude mcp add nularche --scope user -e ELECTRON_RUN_AS_NODE=1/);
});
