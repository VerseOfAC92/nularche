import { describe, expect, it } from "vitest";
import { format } from "../src/i18n/format.ts";
import { STRINGS } from "../src/i18n/strings.ts";

describe("metin şablonu tekil/çoğul", () => {
  it("İngilizcede sayıya göre tekil ya da çoğul biçimi seçer", () => {
    expect(format(STRINGS["list.count"].en, { n: 1 })).toBe("1 note");
    expect(format(STRINGS["list.count"].en, { n: 3 })).toBe("3 notes");
    expect(format(STRINGS["stats.selection"].en, { words: 1, chars: 5 })).toBe("Selection: 1 word · 5 characters");
  });
  it("Türkçe metinler değişmez", () => {
    expect(format(STRINGS["list.count"].tr, { n: 1 })).toBe("1 not");
  });
});
