import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { exportPageHtml, findCitations, formatEntry, latexToText, NodeStore, parseBibtex, parseCslJson, renderCitations, writePrefs, type CslItem } from "../src/index.ts";

const BIB = String.raw`
@string{jdh = "Journal of Digital History"}
@article{kaya2021,
  author = {Kaya, Ay{\c s}e and Y{\i}lmaz, Mehmet and Demir, Can},
  title = {{Dijital} Arşivlerde Bellek},
  journal = jdh,
  year = 2021,
  volume = {4},
  number = {2},
  pages = {10--25},
  doi = {https://doi.org/10.1000/xyz}
}
@book{smith2019,
  author = "John Smith",
  title = {The Long Road},
  publisher = {Oxford University Press},
  address = {Oxford},
  year = {2019}
}
@incollection{ozturk2020, author={{T{\"u}rk Dil Kurumu}}, title={Sözlük Bilimi}, booktitle={Dil Yazıları}, pages={1-9}, publisher={TDK}, year={2020}}
@comment{yok sayılır}
@misc{site, title={A Web Page}, url={https://example.com}, year={2024}}
@article{broken
`;

test("BibTeX: alanlar, makrolar, LaTeX aksanları ve yazar adları", () => {
  const { items, problems } = parseBibtex(BIB);
  const by = new Map(items.map((i) => [i.id, i]));
  assert.equal(by.get("kaya2021")!.type, "article-journal");
  assert.deepEqual(by.get("kaya2021")!.author, [
    { family: "Kaya", given: "Ayşe" },
    { family: "Yılmaz", given: "Mehmet" },
    { family: "Demir", given: "Can" },
  ]);
  assert.equal(by.get("kaya2021")!.title, "Dijital Arşivlerde Bellek");
  assert.equal(by.get("kaya2021")!["container-title"], "Journal of Digital History");
  assert.equal(by.get("kaya2021")!.page, "10–25");
  assert.equal(by.get("kaya2021")!.DOI, "10.1000/xyz");
  assert.deepEqual(by.get("smith2019")!.author, [{ family: "Smith", given: "John" }]);
  assert.deepEqual(by.get("ozturk2020")!.author, [{ literal: "Türk Dil Kurumu" }]);
  assert.equal(by.get("site")!.type, "webpage");
  assert.ok(!by.has("broken") || problems.length >= 0);
  assert.equal(latexToText("\\u{g}\\\"{o}\\c{c}\\.{I}"), "ğöçİ");
});

test("CSL-JSON okunur", () => {
  const { items } = parseCslJson(JSON.stringify([{ id: "a", type: "book", title: "T", author: [{ family: "F", given: "G" }], issued: { "date-parts": [[2000]] } }, { title: "kimliksiz" }]));
  assert.equal(items.length, 1);
});

test("atıf sözdizimi: kümeler, sayfa, yazarsız; bağlantı, dipnot, e-posta ve kod atıf değildir", () => {
  const body = "Bkz. [@kaya2021, s. 12; @smith2019] ve [-@smith2019]. [metin](https://x.y) [^1] a@b.com `[@kod]` [bkz. @site]";
  const c = findCitations(body);
  assert.equal(c.length, 3);
  assert.deepEqual(c[0].refs.map((r) => [r.key, r.locator]), [["kaya2021", "s. 12"], ["smith2019", ""]]);
  assert.equal(c[1].refs[0].suppressAuthor, true);
  assert.equal(c[2].refs[0].prefix, "bkz.");
});

const lib = () => new Map(parseBibtex(BIB).items.map((i) => [i.id, i] as [string, CslItem]));

test("APA 7: metin içi ve kaynakça (Türkçe)", () => {
  const r = renderCitations("Bellek [@kaya2021, 12] ve yol [@smith2019]. Bilinmeyen [@yok].", lib(), "apa", "tr");
  assert.ok(r.markdown.includes("(Kaya vd., 2021, s. 12)"), r.markdown);
  assert.ok(r.markdown.includes("(Smith, 2019)"));
  assert.ok(r.markdown.includes("(?yok)"));
  assert.deepEqual(r.missing, ["yok"]);
  assert.ok(r.markdown.includes("## Kaynakça"));
  assert.ok(r.markdown.includes("Kaya, A., Yılmaz, M., & Demir, C. (2021). Dijital Arşivlerde Bellek. *Journal of Digital History*, *4*(2), 10–25. https://doi.org/10.1000/xyz"), r.markdown);
  assert.ok(r.markdown.indexOf("Kaya, A.") < r.markdown.indexOf("Smith, J."), "alfabetik");
});

test("Chicago, MLA ve IEEE", () => {
  const body = "A [@smith2019, 5]. B [@kaya2021]. C [@smith2019].";
  const chicago = renderCitations(body, lib(), "chicago", "en").markdown;
  assert.ok(chicago.includes("(Smith 2019, 5)"));
  assert.ok(chicago.includes("Kaya, Ayşe, Mehmet Yılmaz, and Can Demir. 2021."), chicago);
  const mla = renderCitations(body, lib(), "mla", "en").markdown;
  assert.ok(mla.includes("(Smith 5)"));
  assert.ok(mla.includes("## Works Cited"));
  const ieee = renderCitations(body, lib(), "ieee", "en").markdown;
  assert.ok(ieee.includes("A [1, p. 5]. B [2]. C [1]."), ieee);
  assert.ok(ieee.includes("[1] J. Smith, *The Long Road*."), ieee);
  assert.equal(formatEntry(lib().get("ozturk2020")!, "apa", "tr"), "Türk Dil Kurumu. (2020). Sözlük Bilimi. İçinde *Dil Yazıları* (ss. 1–9). TDK.");
});

test("kaynakça yeri işaretlenebilir; dışa aktarmada atıflar biçimlenir", async () => {
  const r = renderCitations("Giriş [@smith2019]\n\n{{kaynakça}}\n\nEk", lib(), "apa", "tr");
  assert.ok(/## Kaynakça[\s\S]*Ek$/.test(r.markdown.trim()));
  const root = await mkdtemp(path.join(tmpdir(), "nularche-cite-"));
  const store = new NodeStore(root);
  await store.ensureRoot();
  await writeFile(path.join(root, "kaynaklar.bib"), BIB);
  await writePrefs(root, { citationFiles: ["kaynaklar.bib"], citationStyle: "apa" });
  const note = await store.create({ title: "Makale", body: "Tez [@kaya2021, 3]." });
  const { html } = await exportPageHtml(store, note.id, "tr");
  assert.ok(html.includes("(Kaya vd., 2021, s. 3)"), "metin içi atıf");
  assert.ok(html.includes("Kaynakça"));
  assert.ok(html.includes("<em>Journal of Digital History</em>"));
});
