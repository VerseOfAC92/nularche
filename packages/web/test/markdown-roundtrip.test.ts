// @vitest-environment jsdom
// Her Shard türünün Markdown → editör → Markdown dönüşümünde korunduğunu doğrular.
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, test } from "vitest";
import { buildExtensions } from "../src/editor/extensions.ts";
import { fromEditorMarkdown, toEditorMarkdown } from "../src/editor/paths.ts";

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

function roundtrip(md: string): string {
  editor = new Editor({ extensions: buildExtensions(), content: md, contentType: "markdown" } as never);
  return (editor as unknown as { getMarkdown(): string }).getMarkdown().trim();
}

// [Markdown, ayrıştırma sonrası belgede bulunması gereken düğüm/işaret türü]
const cases: Record<string, [string, string]> = {
  başlıklar: ["# Bir\n\n## İki\n\n### Üç", "heading"],
  biçim: ["**kalın** *italik* ~~çizik~~ `kod` ==vurgu==", "highlight"],
  bağlantı: ["[Plan](/files/Projeler/Plan.md) ve [site](https://example.com)", "link"],
  listeler: ["- bir\n- iki\n\n1. bir\n2. iki", "orderedList"],
  yapılacaklar: ["- [ ] yapılacak\n- [x] bitti", "taskItem"],
  alıntı: ["> alıntı", "blockquote"],
  kod: ["```ts\nconst x = 1;\n```", "codeBlock"],
  ayırıcı: ["üst\n\n---\n\nalt", "horizontalRule"],
  tablo: ["| Ad | Durum |\n| --- | --- |\n| A | Açık |", "tableCell"],
  resim: ["![ekran](/files/ekler/ekran.png)", "image"],
  callout: ["> [!WARNING]\n> Dikkat edilmeli\n>\n> - madde", "callout"],
  açılır: ["<details>\n<summary>Ayrıntılar</summary>\n\nGizli **içerik**\n\n- madde\n\n</details>", "detailsContent"],
  youtube: ["@[youtube](https://www.youtube.com/watch?v=dQw4w9WgXcQ)", "youtube"],
  renk: ['önce <span style="color: #00A8B5">renkli</span> sonra', "textStyle"],
};

function types(json: unknown, out = new Set<string>()): Set<string> {
  const n = json as { type?: string; content?: unknown[]; marks?: { type: string }[] };
  if (n.type) out.add(n.type);
  n.marks?.forEach((m) => out.add(m.type));
  n.content?.forEach((c) => types(c, out));
  return out;
}

describe("Markdown gidiş-dönüş", () => {
  for (const [name, [md, mustHave]] of Object.entries(cases)) {
    test(name, () => {
      const once = roundtrip(md);
      expect([...types(editor!.getJSON())]).toContain(mustHave);
      editor?.destroy();
      const twice = roundtrip(once);
      expect(twice).toBe(once);
      expect(normalize(once)).toBe(normalize(md));
    });
  }
});

function normalize(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/\|\s*-+\s*/g, "|-")
    .trim();
}

describe("editör bağlantı sınırı", () => {
  test("callout türü korunur", () => {
    roundtrip("> [!TIP]\n> ipucu");
    expect(JSON.stringify(editor!.getJSON())).toContain('"kind":"tip"');
  });

  test("göreli yollar /files/ olur ve geri döner", () => {
    const md = "[Plan](../Plan%20A.md) ![r](../ekler/r.png) [d](https://x.y)";
    const ed = toEditorMarkdown(md, "Projeler/Alt.md");
    expect(ed).toBe("[Plan](/files/Plan%20A.md) ![r](/files/ekler/r.png) [d](https://x.y)");
    expect(fromEditorMarkdown(ed, "Projeler/Alt.md")).toBe(md);
  });
});
