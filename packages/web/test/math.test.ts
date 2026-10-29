import { describe, expect, test } from "vitest";
import { evaluate, lineResult, readAssignment, type Vars } from "../src/editor/math.ts";

describe("matematik sonuçları", () => {
  test("dört işlem, öncelik, üs, parantez, yüzde", () => {
    expect(evaluate("2 + 3 * 4")).toBe(14);
    expect(evaluate("(2 + 3) * 4")).toBe(20);
    expect(evaluate("2^3^2")).toBe(512);
    expect(evaluate("200 + 10%")).toBe(220);
    expect(evaluate("50%")).toBe(0.5);
    expect(evaluate("3 x 4")).toBe(12);
    expect(evaluate("12 ÷ 4 × 2")).toBe(6);
    expect(evaluate("sqrt(16) + round(2,567; 1)".replace(";", ","))).toBe(6.6);
    expect(evaluate("2pi")).toBeCloseTo(6.2832, 3);
    expect(evaluate("1 +")).toBeNull();
    expect(evaluate("alert(1)")).toBeNull();
  });

  test("satır sonu = ve değişkenler; Türkçe virgül korunur", () => {
    const vars: Vars = new Map();
    readAssignment("kira = 1500", vars);
    readAssignment("aidat = 250,5", vars);
    expect(lineResult("kira + aidat =", vars, true)).toBe("1750,5");
    expect(lineResult("1.5 * 2 =", vars, true)).toBe("3");
    expect(lineResult("2,5 * 3 =", vars)).toBe("7,5");
    expect(lineResult("Toplam: 12 * 3 =", vars)).toBe("36");
    expect(lineResult("kira =", vars)).toBe("1500");
    expect(lineResult("5 =", vars)).toBeNull();
    expect(lineResult("a = b =", vars)).toBeNull();
    expect(lineResult("bu bir cümle =", vars)).toBeNull();
    expect(lineResult("1/3 =", vars)).toBe("0.333333333333");
  });
});
