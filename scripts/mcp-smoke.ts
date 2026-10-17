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
import { AiActivity } from "../packages/core/src/ai-activity.ts";

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
    "add_database_row",
    "append_to_node",
    "capture_to_shadow",
    "complete_nularche_request",
    "create_database",
    "create_node",
    "duplicate_node",
    "get_backlinks",
    "get_nularche_request",
    "list_nodes",
    "list_shadow",
    "move_node",
    "query_database",
    "read_node",
    "search_nodes",
    "set_row_properties",
    "trash_node",
    "update_database_schema",
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

  // Nularche AI akışı: arayüz istek oluşturur, AI alır, düzenler, cevap yazar; istemci kaydedilir.
  const activity = new AiActivity(vault);
  const clients = await activity.clients();
  assert.ok(
    clients.some((c) => c.name === "nularche-smoke"),
    JSON.stringify(clients),
  );
  const req = await activity.createRequest({
    provider: "claude",
    label: "Özetle",
    instruction: "Özet ekle",
    nodeId: created.data.id,
    nodeTitle: "MCP duman testi",
  });
  const got = await call("get_nularche_request", {});
  assert.equal(got.data.request.id, req.id);
  assert.equal(got.data.node.id, created.data.id);
  await call("update_node", { node: created.data.id, body: "## Özet\n- tamam\n\n" + got.data.node.body, base_revision: got.data.node.revision });
  const done = await call("complete_nularche_request", { request_id: req.id, reply: "Özet eklendi." });
  assert.equal(done.data.status, "done");
  assert.equal(done.data.changes, 1);
  const undo = await activity.undo(new (await import("../packages/core/src/node-store.ts")).NodeStore(vault), req.id);
  assert.equal(undo.restored.length, 1);

  // Veritabanı: oluştur, satır ekle, değer değiştir, formül ekle, sorgula.
  const tasks = await call("create_database", {
    title: "Görevler",
    parent_node_id: arche.data.id,
    properties: [
      { name: "Durum", type: "status", options: ["Yapılacak", "Bitti"] },
      { name: "Saat", type: "number" },
      { name: "Son tarih", type: "date" },
    ],
  });
  assert.equal(tasks.isError, false);
  await call("add_database_row", { database: tasks.data.id, title: "Rapor yaz", values: { Durum: "Yapılacak", Saat: 3, "Son tarih": "2026-10-20" } });
  const second = await call("add_database_row", { database: tasks.data.id, title: "Sunum", values: { Durum: "Yapılacak", Saat: 5, Etiket: "x" } });
  assert.equal(second.isError, true, "bilinmeyen özellik reddedilir");
  const row2 = await call("add_database_row", { database: tasks.data.id, title: "Sunum", values: { Saat: 5 } });
  const setv = await call("set_row_properties", { row: row2.data.id, values: { Durum: "Bitti" } });
  assert.equal(setv.data.props.durum, "bitti");
  await call("update_database_schema", { database: tasks.data.id, add: [{ name: "Gün", type: "formula", expression: 'round(prop("Saat") / 8, 2)' }] });
  const q = await call("query_database", { database: tasks.data.id, filters: [{ property: "Durum", op: "is", value: "Bitti" }] });
  assert.equal(q.data.total, 1);
  assert.equal(q.data.rows[0].title, "Sunum");
  assert.equal(q.data.rows[0].values["Gün"], "0.63");
  const sorted = await call("query_database", { database: tasks.data.id, sorts: [{ property: "Saat", direction: "desc" }] });
  assert.deepEqual(sorted.data.rows.map((r: { title: string }) => r.title), ["Sunum", "Rapor yaz"]);
  if (temporary) await call("trash_node", { node: arche.data.id });
  console.log(`\nTamam. Origin: ${vault}`);
} finally {
  await client.close();
  if (temporary) await rm(vault, { recursive: true, force: true });
}
