// MCP sunucusunu stdio üzerinden gerçek bir MCP istemcisiyle çalıştırır.
// Varsayılan olarak geçici bir vault kullanır; `--vault <yol>` ile gerçek vault'a karşı çalışır.
// Kullanım: npm run mcp:smoke [-- --vault ./origin]
// Paketli uygulamayı denemek için: -- --app /Applications/Nularche.app/Contents/MacOS/Nularche --script <nularche-mcp.mjs>

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { projectRoot } from "../packages/core/src/config.ts";

const vaultArg = process.argv.indexOf("--vault");
const vault = vaultArg > 0 ? path.resolve(process.argv[vaultArg + 1]) : await mkdtemp(path.join(tmpdir(), "nularche-smoke-"));
const temporary = vaultArg < 0;

const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const app = arg("--app");
const transport = new StdioClientTransport({
  command: app ?? process.execPath,
  args: [arg("--script") ?? path.join(projectRoot(), "packages/mcp/src/index.ts")],
  env: { ...process.env, NULARCHE_ORIGIN: vault, ...(app ? { ELECTRON_RUN_AS_NODE: "1" } : {}) } as Record<string, string>,
  stderr: "inherit",
});
const client = new Client({ name: "nularche-smoke", version: "0.0.0" });
await client.connect(transport);

async function call(name: string, args: Record<string, unknown>) {
  const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  const data = JSON.parse(res.content[0].text);
  console.log(`${res.isError ? "✗" : "✓"} ${name}`, JSON.stringify(data).slice(0, 200));
  return { data, isError: Boolean(res.isError) };
}

try {
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  console.log("araçlar:", tools.join(", "));
  assert.deepEqual(tools, [
    "append_to_node",
    "capture_to_shadow",
    "create_node",
    "get_backlinks",
    "list_nodes",
    "list_shadow",
    "move_node",
    "read_node",
    "search_nodes",
    "trash_node",
    "update_node",
  ]);

  const arche = await call("create_node", { title: "MCP duman Arche", parent_node_id: "root" });
  const created = await call("create_node", { title: "MCP duman testi", body: "Bu nott yazım hatası içeriyor.", parent_node_id: arche.data.id });
  assert.equal(created.data.arche_id, arche.data.id);
  const listed = await call("list_nodes", {});
  assert.ok(listed.data.nodes.some((n: { id: string }) => n.id === created.data.id));
  const found = await call("search_nodes", { query: "yazım hatası" });
  assert.equal(found.data.results[0].id, created.data.id);
  const read = await call("read_node", { node: created.data.id });
  const updated = await call("update_node", { node: created.data.id, body: "Bu not yazım hatası içermiyor.", base_revision: read.data.revision });
  assert.equal(updated.isError, false);
  const stale = await call("update_node", { node: created.data.id, body: "eski sürüm", base_revision: read.data.revision });
  assert.equal(stale.isError, true);
  assert.equal(stale.data.error, "conflict");
  await call("append_to_node", { node: created.data.id, text: "- Claude tarafından eklendi" });
  const final = await call("read_node", { node: created.data.id });
  assert.match(final.data.body, /içermiyor\.\n\n- Claude tarafından eklendi/);
  const captured = await call("capture_to_shadow", { text: "Ham fikir: Lattice görünümü\nayrıntı" });
  assert.equal(captured.data.arche_id, null);
  const shadow = await call("list_shadow", {});
  assert.ok(shadow.data.inbox.some((n: { id: string }) => n.id === captured.data.id));
  await call("move_node", { node: captured.data.id, new_parent_node_id: arche.data.id });
  if (temporary) await call("trash_node", { node: arche.data.id });
  console.log(`\nTamam. Origin: ${vault}`);
} finally {
  await client.close();
  if (temporary) await rm(vault, { recursive: true, force: true });
}
