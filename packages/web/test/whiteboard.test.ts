// Tabula: blok okuma/yazma, bağlı çizgi uçları ve şekil kütüphanesinin geçerliliği.
import { describe, expect, test } from "vitest";
import { linePath, parseBoard, resolveEnds, serializeBoard, type Item } from "../src/whiteboard/model.ts";
import { SHAPES } from "../src/whiteboard/shapes.ts";
import { rewriteWhiteboardFiles, whiteboardFiles } from "../../core/src/whiteboard.ts";

const item = (p: Partial<Item>): Item => ({ id: "x", type: "shape", x: 0, y: 0, w: 100, h: 50, style: {}, ...p }) as Item;

describe("Tabula", () => {
  test("blok yazılır ve okunur; blok dışındaki metin korunur, bozuk blok bildirilir", () => {
    const body = serializeBoard("Giriş metni\n", { version: 1, items: [item({ id: "a", x: 1.234 })] });
    expect(body.startsWith("Giriş metni\n\n```json whiteboard\n")).toBe(true);
    const { board, broken } = parseBoard(body);
    expect(broken).toBe(false);
    expect(board.items[0].x).toBe(1.2);
    expect(parseBoard("```json whiteboard\n{bozuk\n```").broken).toBe(true);
  });

  test("öğeye bağlı çizgi, öğe taşınınca uygun kenardan başlar", () => {
    const a = item({ id: "a", x: 0, y: 0 });
    const b = item({ id: "b", x: 300, y: 0 });
    const line = item({ id: "l", type: "line", from: { x: 0, y: 0, id: "a" }, to: { x: 0, y: 0, id: "b" } });
    const ends = resolveEnds(line, new Map([a, b].map((i) => [i.id, i])));
    expect(ends.a).toMatchObject({ x: 100, y: 25, side: "right" });
    expect(ends.b).toMatchObject({ x: 300, y: 25, side: "left" });
    expect(linePath(ends.a, ends.b, "elbow").d.startsWith("M100 25")).toBe(true);
  });

  test("her şeklin yolu geçerli sayılardan oluşur ve kimlikler benzersizdir", () => {
    expect(new Set(SHAPES.map((s) => s.id)).size).toBe(SHAPES.length);
    expect(SHAPES.length).toBeGreaterThan(120);
    for (const s of SHAPES) {
      const d = `${s.path(160, 100)} ${s.detail?.(160, 100) ?? ""}`;
      expect(d, s.id).not.toMatch(/NaN|undefined|Infinity/);
    }
  });

  test("görsel dosya başvuruları izlenir ve taşınınca güncellenir", () => {
    const body = serializeBoard("", { version: 1, items: [item({ id: "i", type: "image", file: "Ekler/a.png" })] });
    expect(whiteboardFiles(body)).toEqual(["Ekler/a.png"]);
    expect(whiteboardFiles(rewriteWhiteboardFiles(body, new Map([["Ekler/a.png", "Ekler/b.png"]])))).toEqual(["Ekler/b.png"]);
  });
});
