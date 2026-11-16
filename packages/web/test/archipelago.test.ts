// Archipelago (Arche grupları): grupların gerçek Arche'lerle eşlenmesi ve Arche'nin gruplar arasında taşınması.
import { describe, expect, test } from "vitest";
import { assignArche, groupOf, resolveArchipelagos, type Archipelago } from "../src/notes/archipelago.ts";
import type { NodeMeta } from "../src/api.ts";

const arche = (id: string) => ({ id, title: id, parentNodeId: null, archeId: id }) as unknown as NodeMeta;
const A = arche("a"), B = arche("b"), C = arche("c"), D = arche("d");

describe("resolveArchipelagos", () => {
  test("gruplar kendi sıralarıyla, kalan Arche'ler kök sırasıyla", () => {
    const groups: Archipelago[] = [{ id: "g1", name: "İş", archeIds: ["c", "a"] }];
    const r = resolveArchipelagos(groups, [A, B, C, D]);
    expect(r.groups[0].arches.map((x) => x.id)).toEqual(["c", "a"]);
    expect(r.loose.map((x) => x.id)).toEqual(["b", "d"]);
  });

  test("kökte olmayan Arche gizlenir ama kimliği silinmez; aynı Arche iki grupta ise ilkinde görünür", () => {
    const groups: Archipelago[] = [
      { id: "g1", name: "1", archeIds: ["x", "a"] },
      { id: "g2", name: "2", archeIds: ["a", "b"] },
    ];
    const r = resolveArchipelagos(groups, [A, B]);
    expect(r.groups.map((g) => g.arches.map((x) => x.id))).toEqual([["a"], ["b"]]);
    expect(r.groups[0].group.archeIds).toContain("x");
    expect(r.loose).toEqual([]);
  });
});

describe("assignArche", () => {
  const base: Archipelago[] = [
    { id: "g1", name: "1", archeIds: ["a", "b"] },
    { id: "g2", name: "2", archeIds: ["c"] },
  ];

  test("başka gruba taşır ve eski gruptan çıkarır", () => {
    const next = assignArche(base, "a", "g2");
    expect(next.map((g) => g.archeIds)).toEqual([["b"], ["c", "a"]]);
    expect(groupOf(next, "a")?.id).toBe("g2");
  });

  test("bir Arche'nin önüne ya da arkasına yerleştirir", () => {
    expect(assignArche(base, "d", "g1", { id: "b", after: false })[0].archeIds).toEqual(["a", "d", "b"]);
    expect(assignArche(base, "d", "g1", { id: "a", after: true })[0].archeIds).toEqual(["a", "d", "b"]);
    expect(assignArche(base, "b", "g1", { id: "a", after: false })[0].archeIds).toEqual(["b", "a"]);
  });

  test("null gruptan çıkarır; değişmeyen grup aynı nesne kalır", () => {
    const next = assignArche(base, "c", null);
    expect(next[1].archeIds).toEqual([]);
    expect(next[0]).toBe(base[0]);
    expect(groupOf(next, "c")).toBeUndefined();
  });
});
