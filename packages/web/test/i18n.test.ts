import { describe, expect, it } from "vitest";
import { STRINGS } from "../src/i18n/strings.ts";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("arayüz metinleri", () => {
  it("her anahtarın Türkçe ve İngilizce metni var ve yer tutucuları aynı", () => {
    for (const [key, entry] of Object.entries(STRINGS)) {
      expect(entry.tr.trim(), key).not.toBe("");
      expect(entry.en.trim(), key).not.toBe("");
      expect(placeholders(entry.en), key).toEqual(placeholders(entry.tr));
    }
  });
});
