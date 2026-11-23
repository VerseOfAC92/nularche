// @vitest-environment jsdom
// İkon seçicisinin emoji verisi: bütün kategoriler dolu, adlar iki dilde, arama Türkçe ve İngilizce çalışır, ten rengi
// çeşitleri doğru sırada. jsdom'da tuval olmadığından destek ölçülemez: liste olduğu gibi döner.

import { describe, expect, it } from "vitest";
import raw from "../src/emoji/emoji-data.json" with { type: "json" };
import { loadEmoji, searchEmoji, withTone } from "../src/emoji/data.ts";
import { STRINGS } from "../src/i18n/strings.ts";

describe("emoji seçicisi", () => {
  it("bütün Unicode emojileri dokuz kategoride, iki dilde", async () => {
    const data = await loadEmoji();
    expect(data.items.length).toBe((raw as { list: unknown[] }).list.length);
    expect(data.items.length).toBeGreaterThan(1800);
    expect(data.groups).toEqual(["smileys-emotion", "people-body", "animals-nature", "food-drink", "travel-places", "activities", "objects", "symbols", "flags"]);
    for (const [i, g] of data.groups.entries()) {
      expect(data.items.some((x) => x.group === i), g).toBe(true);
      expect(STRINGS[`emoji.g.${g}` as keyof typeof STRINGS], g).toBeTruthy();
    }
    // Eski sabit listedeki emojiler de var.
    for (const e of ["📄", "📝", "🧠", "💡", "🚀", "🔒", "🧭", "🌀"]) expect(data.items.some((x) => x.emoji === e), e).toBe(true);
    expect(data.items.filter((x) => x.tr !== x.en).length).toBeGreaterThan(1500);
  });

  it("arama Türkçe ve İngilizce adlarla ve anahtar sözcüklerle bulur", async () => {
    const { items } = await loadEmoji();
    const found = (q: string) => searchEmoji(items, q).map((x) => x.emoji);
    expect(found("kalp")).toContain("❤️");
    expect(found("heart")).toContain("❤️");
    expect(found("KEDİ")).toContain("🐱");
    expect(found("rocket")[0]).toBe("🚀");
    expect(found("bayrak türkiye")).toContain("🇹🇷");
    expect(found("zzzz-yok")).toEqual([]);
    expect(searchEmoji(items, "  ")).toBe(items);
  });

  it("ten rengi çeşitleri açıktan koyuya; çeşidi olmayan emoji değişmez", async () => {
    const { items } = await loadEmoji();
    const wave = items.find((x) => x.emoji === "👋")!;
    expect(withTone(wave, 0)).toBe("👋");
    expect(withTone(wave, 1)).toBe("👋🏻");
    expect(withTone(wave, 5)).toBe("👋🏿");
    const rocket = items.find((x) => x.emoji === "🚀")!;
    expect(withTone(rocket, 3)).toBe("🚀");
  });
});
