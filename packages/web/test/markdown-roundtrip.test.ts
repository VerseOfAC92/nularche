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
  resim: ["![ekran](/files/Attachments/ekran.png)", "image"],
  callout: ["> [!WARNING]\n> Dikkat edilmeli\n>\n> - madde", "callout"],
  açılır: ["<details>\n<summary>Ayrıntılar</summary>\n\nGizli **içerik**\n\n- madde\n\n</details>", "detailsContent"],
  youtube: ["@[youtube](https://www.youtube.com/watch?v=dQw4w9WgXcQ)", "youtube"],
  veritabanı: ["@[database](/files/Proje/Gorevler/Gorevler.md#view=v_board)", "inlineDatabase"],
  renk: ['önce <span style="color: #00A8B5">renkli</span> sonra', "textStyle"],
  hizalama: ['<div align="center">\n\nOrtalı **metin**\n\n</div>\n\nnormal', "paragraph"],
  "sağdan sola başlık": ['<div align="right" dir="rtl">\n\n## مرحبا\n\n</div>', "heading"],
  girinti: ['<div data-indent="2">\n\nGirintili\n\n</div>', "paragraph"],
  "üs ve indis": ["x<sup>2</sup> ve H<sub>2</sub>O", "superscript"],
  "tire liste": ["+ bir\n+ iki\n\n- madde", "bulletList"],
  ses: ["@[audio](/files/Attachments/kayit.webm)", "audioBlock"],
  çizim: ["@[drawing](/files/Attachments/cizim.png)", "drawingBlock"],
  etiket: ["Bugün #toplantı vardı", "text"],
  "wiki bağlantısı": ["Bkz [[Plan#Hedef|takma]] ve ![[resim.png]] ile ![[Plan]]", "wikiLink"],
  dipnot: ["Metin[^1] devam\n\n[^1]: Dipnot metni", "footnoteRef"],
  "tek kelimelik dipnot tanımı": ["Dipnot[^1]\n\n[^1]: açıklama\n\n[^not]: **kalın** tanım", "footnoteDef"],
  "satır içi matematik": ["Euler $e^{i\\pi}+1=0$ ama $5 ile $6 para", "mathInline"],
  "blok matematik": ["$$\n\\int_0^1 x\\,dx\n$$", "mathBlock"],
  "obsidian kutusu": ["> [!info]- Katlanır başlık\n> içerik", "callout"],
  yorum: ["a %%gizli not%% b", "text"],
  mermaid: ["```mermaid\ngraph TD; A-->B\n```", "codeBlock"],
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

describe("gömülü veritabanı bağlantısı", () => {
  test("dosyadaki göreli yol editörde /files/ yoluna çevrilir ve görünüm parçası korunur", async () => {
    const { toEditorMarkdown, fromEditorMarkdown } = await import("../src/editor/paths.ts");
    const md = "@[database](Gorevler/Gorevler.md#view=v_board)";
    const ed = toEditorMarkdown(md, "Proje/Proje.md");
    expect(ed).toBe("@[database](/files/Proje/Gorevler/Gorevler.md#view=v_board)");
    expect(fromEditorMarkdown(ed, "Proje/Proje.md")).toBe(md);
  });
});

describe("v1.5 biçimleri", () => {
  test("hizalama özniteliği editöre taşınır", () => {
    roundtrip('<div align="center">\n\nOrta\n\n</div>');
    expect(JSON.stringify(editor!.getJSON())).toContain('"textAlign":"center"');
  });
  test("tire liste ve madde listesi ayrı kalır", () => {
    const out = roundtrip("+ bir\n+ iki\n\n- madde");
    expect(out).toContain("+ bir");
    expect(out).toContain("- madde");
    expect(JSON.stringify(editor!.getJSON())).toContain('"dashed":true');
  });
});
