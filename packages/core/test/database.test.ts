import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addProperty,
  cellValue,
  defaultDatabase,
  evaluateFormula,
  groupRows,
  inputToStored,
  parseDatabase,
  queryRows,
  removeProperty,
  serializeDatabase,
  toCsv,
  valueForGroup,
  type Database,
  type Row,
} from "../src/index.ts";

const names = { tags: "Etiketler", status: "Durum", todo: "Yapılacak", doing: "Sürüyor", done: "Bitti", table: "Tablo", board: "Pano" };

function sample(): { db: Database; rows: Row[] } {
  let db = defaultDatabase(names);
  db = addProperty(db, { name: "Fiyat", type: "number" }).db;
  db = addProperty(db, { name: "Adet", type: "number" }).db;
  db = addProperty(db, { name: "Son tarih", type: "date" }).db;
  db = addProperty(db, { name: "Toplam", type: "formula", expression: 'prop("Fiyat") * prop("Adet")' }).db;
  const row = (id: string, title: string, props: Record<string, unknown>, createdAt: number): Row => ({ id, title, props, createdAt, updatedAt: createdAt });
  return {
    db,
    rows: [
      row("a", "Kalem", { status: "done", fiyat: 10, adet: 3, tags: ["ofis"], son_tarih: "2026-10-20" }, 1),
      row("b", "Defter", { status: "todo", fiyat: 25, adet: 2, son_tarih: "2026-10-10" }, 2),
      row("c", "Çanta", { status: "doing", fiyat: 300 }, 3),
    ],
  };
}

test("şema ayrıştırılır, geçersiz girdiler atlanır ve gidiş-dönüş korunur", () => {
  const db = parseDatabase({
    properties: [
      { id: "durum", name: "Durum", type: "status", options: ["Açık", { name: "Kapalı", color: "red" }] },
      { name: "Bozuk", type: "yok" },
      { id: "title", name: "Ad", type: "text" },
      "x",
    ],
    views: [{ type: "board", group_by: "durum" }, { type: "garip" }],
  });
  assert.deepEqual(db.properties.map((p) => p.id), ["durum"]);
  assert.deepEqual(db.properties[0].options?.map((o) => o.id), ["acik", "kapali"]);
  assert.equal(db.properties[0].options?.[1].color, "red");
  assert.equal(db.views[0].groupBy, "durum");
  assert.equal(db.views[1].type, "table");
  assert.deepEqual(parseDatabase(serializeDatabase(db)), db);
  assert.equal(parseDatabase(null).views.length, 1, "boş şemada da bir görünüm olur");
});

test("formüller hesaplanır; hatalar hücreye yazılır, kod çalıştırılmaz", () => {
  const { db, rows } = sample();
  assert.equal(cellValue(db, rows[0], "toplam"), 30);
  assert.equal(cellValue(db, rows[2], "toplam"), null, "boş değerle çarpım boş kalır");
  const f = (e: string, r = rows[0]) => evaluateFormula(e, db, r, { now: new Date("2026-10-17T12:00:00").getTime() });
  assert.equal(f('if(prop("Durum") == "Bitti", "✓", "…")'), "✓");
  assert.equal(f('concat(prop("title"), " x", prop("Adet"))'), "Kalem x3");
  assert.equal(f("2 + 3 * 4 - 1"), 13);
  assert.equal(f("(2 + 3) * 4"), 20);
  assert.equal(f("10 > 3 and not false"), true);
  assert.equal(f('dateBetween(prop("Son tarih"), today(), "days")'), 3);
  assert.equal(f('dateAdd("2026-01-30", 3, "days")'), "2026-02-02");
  assert.equal(f('round(10 / 3, 2)'), 3.33);
  assert.equal(f('contains(prop("Durum"), "Bit")'), true, "seçim değeri adıyla karşılaştırılır");
  assert.deepEqual(f("1 / 0"), { error: "division by zero" });
  assert.deepEqual(f('constructor("alert(1)")'), { error: 'unknown function "constructor"' });
  assert.deepEqual(f('prop("Yok")'), { error: 'no property "Yok"' });
  assert.deepEqual(f("2 +"), { error: "unexpected end" });
});

test("filtre, sıralama ve 'herhangi biri' eşleşmesi", () => {
  const { db, rows } = sample();
  const ids = (rs: Row[]) => rs.map((r) => r.id);
  assert.deepEqual(ids(queryRows(db, rows, { filters: [{ prop: "status", op: "is", value: "done" }], sorts: [], match: "all" })), ["a"]);
  assert.deepEqual(ids(queryRows(db, rows, { filters: [{ prop: "fiyat", op: "gte", value: 25 }], sorts: [{ prop: "fiyat", dir: "desc" }], match: "all" })), ["c", "b"]);
  assert.deepEqual(ids(queryRows(db, rows, { filters: [{ prop: "title", op: "contains", value: "çan" }], sorts: [], match: "all" })), ["c"]);
  assert.deepEqual(ids(queryRows(db, rows, { filters: [{ prop: "son_tarih", op: "is_empty" }], sorts: [], match: "all" })), ["c"]);
  assert.deepEqual(
    ids(queryRows(db, rows, { filters: [{ prop: "status", op: "is", value: "todo" }, { prop: "tags", op: "contains", value: "ofis" }], sorts: [], match: "any" })),
    ["a", "b"],
  );
  // Boş değerler sıralamada her zaman sonda; tarih sıralaması tarih olarak yapılır.
  assert.deepEqual(ids(queryRows(db, rows, { filters: [], sorts: [{ prop: "son_tarih", dir: "asc" }], match: "all" })), ["b", "a", "c"]);
  assert.deepEqual(ids(queryRows(db, rows, { filters: [], sorts: [{ prop: "son_tarih", dir: "desc" }], match: "all" })), ["a", "b", "c"]);
  // Durum, seçenek sırasına göre sıralanır.
  assert.deepEqual(ids(queryRows(db, rows, { filters: [], sorts: [{ prop: "status", dir: "asc" }], match: "all" })), ["b", "c", "a"]);
  assert.deepEqual(ids(queryRows(db, rows, { filters: [], sorts: [{ prop: "toplam", dir: "desc" }], match: "all" })), ["b", "a", "c"]);
});

test("pano gruplaması ve kart taşıma değeri", () => {
  const { db, rows } = sample();
  const groups = groupRows(db, rows, "status", "Yok");
  assert.deepEqual(groups.map((g) => [g.key, g.rows.map((r) => r.id)]), [["todo", ["b"]], ["doing", ["c"]], ["done", ["a"]], ["", []]]);
  const tags = db.properties.find((p) => p.id === "tags")!;
  assert.deepEqual(valueForGroup(tags, ["ofis", "acil"], "ofis", "ev"), ["acil", "ev"]);
  assert.deepEqual(valueForGroup(tags, ["ofis"], "ofis", ""), []);
});

test("insan okunur değerler saklanan değere çevrilir; yeni seçenekler şemaya eklenir", () => {
  const { db } = sample();
  const status = db.properties.find((p) => p.id === "status")!;
  assert.equal(inputToStored(db, status, "Bitti").value, "done");
  const r = inputToStored(db, db.properties.find((p) => p.id === "tags")!, "ofis, acil iş");
  assert.deepEqual(r.value, ["ofis", "acil_is"]);
  assert.deepEqual(r.db.properties.find((p) => p.id === "tags")!.options!.map((o) => o.name), ["ofis", "acil iş"]);
  assert.throws(() => inputToStored(db, db.properties.find((p) => p.id === "fiyat")!, "çok"), /expects a number/);
  assert.throws(() => inputToStored(db, db.properties.find((p) => p.id === "toplam")!, 3), /computed/);
  assert.equal(inputToStored(db, db.properties.find((p) => p.id === "son_tarih")!, "2026-11-01").value, "2026-11-01");
});

test("ilişki ve toplama (rollup) başka veritabanındaki satırları hesaplar", () => {
  const products = sample();
  let orders = parseDatabase({});
  orders = addProperty(orders, { name: "Ürünler", type: "relation", target: "urunler-db" }).db;
  orders = addProperty(orders, { name: "Tutar", type: "rollup", relation: "urunler", targetProp: "fiyat", fn: "sum" }).db;
  orders = addProperty(orders, { name: "Kalem sayısı", type: "rollup", relation: "urunler", fn: "count" }).db;
  const order: Row = { id: "o1", title: "Sipariş", props: { urunler: ["a", "b", "x"] }, createdAt: 1, updatedAt: 1 };
  const ctx = { databases: new Map([["urunler-db", products]]) };
  assert.equal(cellValue(orders, order, "tutar", ctx), 35);
  assert.equal(cellValue(orders, order, "kalem_sayisi", ctx), 2);
  assert.equal(cellValue(orders, order, "kalem_sayisi"), 3, "hedef yüklenmemişse bağlantı sayısı");
});

test("özellik silinince görünümlerden temizlenir; CSV görünür sütunları verir", () => {
  const { db, rows } = sample();
  const view = { ...db.views[0], hidden: ["tags", "adet"], filters: [{ prop: "fiyat", op: "lt" as const, value: 100 }], sorts: [{ prop: "fiyat", dir: "asc" as const }] };
  const removed = removeProperty({ ...db, views: [view] }, "fiyat");
  assert.deepEqual(removed.views[0].filters, []);
  assert.deepEqual(removed.views[0].sorts, []);
  const csv = toCsv(db, rows, view, "Ad").split("\n");
  assert.equal(csv[0], "Ad,Durum,Fiyat,Son tarih,Toplam");
  assert.equal(csv[1], "Kalem,Bitti,10,2026-10-20,30");
  assert.equal(csv.length, 3);
});
