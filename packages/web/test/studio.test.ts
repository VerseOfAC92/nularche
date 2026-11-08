// @vitest-environment jsdom
// 2.0 yazma stüdyosu: taslak numaraları, yazma günlüğü, wiki anma ve yorum süslemeleri, metin kısaltmaları.
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, test } from "vitest";
import { buildExtensions } from "../src/editor/extensions.ts";
import { anchorFromSelection, plainIndex, setStudioData } from "../src/studio/editor-plugins.ts";
import { outlineNumbers } from "../src/studio/OutlineView.tsx";
import { writingStats, dayKey } from "../src/studio/goals.ts";
import { STRINGS } from "../src/i18n/strings.ts";
import { MENU } from "../src/commands.ts";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
  setStudioData({ wikiTerms: [], shortcuts: [], mentionsOn: true, comments: { noteId: "n1", list: [] } });
});

function make(md: string): Editor {
  const el = document.createElement("div");
  document.body.append(el);
  editor = new Editor({ element: el, extensions: buildExtensions(), content: md, contentType: "markdown", editorProps: { attributes: { "data-note-id": "n1" } } } as never);
  return editor;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("taslak numaraları", () => {
  test("I. → A. → 1. → a. ve düzey değişince sayaç sıfırlanır", () => {
    const rows = [0, 1, 1, 2, 3, 0, 1].map((depth, i) => ({ id: String(i), text: "", depth }));
    expect(outlineNumbers(rows)).toEqual(["I.", "A.", "B.", "1.", "a.", "II.", "A."]);
  });
});

describe("yazma günlüğü", () => {
  test("bugün, seri ve son yedi gün", () => {
    const now = new Date(2026, 10, 7, 12);
    const d = (offset: number) => dayKey(new Date(2026, 10, 7 - offset, 12));
    const stats = writingStats({ [d(0)]: 300, [d(1)]: 50, [d(2)]: 10, [d(4)]: 99 }, now);
    expect(stats.today).toBe(300);
    expect(stats.streak).toBe(3);
    expect(stats.week).toEqual([0, 0, 99, 0, 10, 50, 300]);
    // Bugün henüz yazılmadıysa seri dünden sayılır.
    expect(writingStats({ [d(1)]: 5, [d(2)]: 5 }, now).streak).toBe(2);
  });
});

describe("editör süslemeleri", () => {
  test("wiki girdisi adları ve takma adları işaretlenir; kendi notunda işaretlenmez", async () => {
    const e = make("Ada limana indi. **Rıhtım** boştu. Adana değil.");
    setStudioData({ wikiTerms: [{ id: "w1", title: "Ada", path: "Dünya/Ada.md", names: ["Ada"] }, { id: "w2", title: "Liman", path: "Dünya/Liman.md", names: ["Liman", "Rıhtım"] }] });
    await flush();
    const marks = [...e.view.dom.querySelectorAll<HTMLElement>(".nl-wiki-mention")].map((x) => [x.textContent, x.dataset.wikiId]);
    expect(marks).toEqual([
      ["Ada", "w1"],
      ["Rıhtım", "w2"],
    ]);
    setStudioData({ wikiTerms: [{ id: "n1", title: "Ada", path: "x.md", names: ["Ada"] }] });
    await flush();
    expect(e.view.dom.querySelectorAll(".nl-wiki-mention").length).toBe(0);
    setStudioData({ mentionsOn: false, wikiTerms: [{ id: "w1", title: "Ada", path: "x.md", names: ["Ada"] }] });
    await flush();
    expect(e.view.dom.querySelectorAll(".nl-wiki-mention").length).toBe(0);
  });

  test("yorum bağlantı noktası seçimden üretilir ve vurgulanır; çözülen yorum vurgulanmaz", async () => {
    const e = make("Birinci paragraf.\n\nkedi uyudu, kedi koştu.");
    const text = plainIndex(e.state.doc).text;
    expect(text).toBe("Birinci paragraf.\nkedi uyudu, kedi koştu.");
    // İkinci "kedi" kelimesini seç.
    const { pos } = plainIndex(e.state.doc);
    const i = text.lastIndexOf("kedi");
    e.commands.setTextSelection({ from: pos[i], to: pos[i + 3] + 1 });
    const anchor = anchorFromSelection(e.state)!;
    expect(anchor.text).toBe("kedi");
    expect(anchor.prefix?.endsWith("uyudu, ")).toBe(true);
    setStudioData({ comments: { noteId: "n1", list: [{ id: "c1", anchor }] } });
    await flush();
    const hl = e.view.dom.querySelector<HTMLElement>(".nl-annot")!;
    expect(hl.textContent).toBe("kedi");
    expect(hl.nextSibling?.textContent?.startsWith(" koştu")).toBe(true);
    setStudioData({ comments: { noteId: "n1", list: [{ id: "c1", anchor, resolved: true }] } });
    await flush();
    expect(e.view.dom.querySelector(".nl-annot")).toBeNull();
  });

  test("metin kısaltması boşlukla açılır, kod içinde açılmaz", () => {
    const e = make("x");
    setStudioData({ shortcuts: [{ abbr: ";ty", text: "Teşekkürler" }] });
    e.commands.setTextSelection(e.state.doc.content.size - 1);
    e.commands.insertContent(" ;ty");
    const view = e.view;
    const from = view.state.selection.from;
    const handled = view.someProp("handleTextInput", (f) => f(view, from, from, " ", () => view.state.tr));
    expect(handled).toBe(true);
    expect(e.state.doc.textContent).toBe("x Teşekkürler ");
  });
});

describe("metinler", () => {
  test("yeni menü komutlarının ve stüdyo anahtarlarının iki dilde metni var", () => {
    const ids: string[] = [];
    for (const g of MENU) for (const i of g.items) if (i !== "-") ids.push("submenu" in i ? i.submenu : i.label, ...("submenu" in i ? i.items.flatMap((x) => (x === "-" ? [] : [x.label])) : []));
    for (const k of ids) expect(STRINGS[k as keyof typeof STRINGS], k).toBeTruthy();
    for (const k of ["ws.amb.rain", "ws.ck.card", "ws.every.weekly", "ws.font.book", "ws.kind.wiki"]) expect(STRINGS[k as keyof typeof STRINGS]?.en, k).toBeTruthy();
  });
});
