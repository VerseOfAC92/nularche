// nularche.verseofac.com etkileşimleri: dil (EN/TR), kaydırmayla hareket eden arka plan, deneme editörü, özellik sekmeleri, veri akışı,
// Nularche dili kartları ve işletim sistemine göre indirme. Dış kaynak yok; JavaScript kapalıyken sayfa İngilizce
// metinleriyle eksiksiz okunur. Kullanıcının yazdığı hiçbir şey sayfadan çıkmaz.
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const store = {
    get: (k) => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      try {
        localStorage.setItem(k, v);
      } catch {
        /* özel pencere */
      }
    },
  };

  // ------------------------------------------------------------------ dil
  const TR = {
    skip: "İçeriğe geç",
    "nav.idea": "Fikir",
    "nav.try": "Deneyin",
    "nav.features": "Özellikler",
    "nav.privacy": "Verileriniz",
    "nav.download": "İndir",
    "nav.get": "Nularche'yi edinin",
    "hero.kicker": "Sıfır noktasından ilk ilkelere",
    "hero.t1": "Notların.",
    "hero.t2": "Bilgisayarın.",
    "hero.t3": "Yapay zekân.",
    "hero.lede": "Nularche, bildiğiniz her şeyi kendi klasörünüzde düz Markdown dosyaları olarak tutan, ücretsiz ve açık kaynaklı bir not uygulamasıdır. Zaten kullandığınız yapay zekâ düşünmenize, yazmanıza ve hatırlamanıza yardım eder.",
    "hero.download": "Nularche 3.0'ı indirin",
    "hero.try": "Burada deneyin",
    "fact.1": "Hesap yok",
    "fact.2": "Nularche sunucusu yok",
    "fact.3": "Abonelik yok",
    "fact.4": "MIT açık kaynak",
    "hero.note1": "eviniz: hedefler, projeler, hızlı yakalama",
    "hero.note2": "her sayfa düz bir .md dosyası",
    "idea.kicker": "Fikir",
    "idea.title": "Null + Arche: temiz başla, ilk ilkeler üzerine kur",
    "idea.1.t": "Sıfır noktası",
    "idea.1.p": "Düşüncelerinizle aranızda hiçbir şey yok: hesap, kilitlenme, akış yok. Yalnızca bugün de yirmi yıl sonra da her editörün açabileceği Markdown dosyalarından oluşan bir klasör.",
    "idea.2.t": "Arche",
    "idea.2.p": "Hayatınızın her alanına kendi kökünü, bir Arche verin; sayfalar, veritabanları, manuskriptler ve panolar ondan büyüsün.",
    "idea.3.t": "Bir bilgi ağı",
    "idea.3.p": "Bağlantılar, atıflar, canlı sorgular ve bilgi kartları notları bulup atıf yapabileceğiniz, yeniden kullanıp hatırlayabileceğiniz bilgiye dönüştürür.",
    "mission.vision.t": "Vizyon",
    "mission.vision.p": "Bilgi, onu yazan kişiye ait olsun: hiçbir uygulama olmadan okunabilir, varsayılan olarak gizli ve ömür boyu işe yarar.",
    "mission.mission.t": "Misyon",
    "mission.mission.p": "Düz dosyalar üzerinde eksiksiz ve güzel bir not stüdyosu kurmak; zaten sahip olduğunuz yapay zekâyla, aboneliksiz ve güvenmeniz gereken tek şey herkesin okuyabildiği kod olacak şekilde.",
    "try.kicker": "Burada deneyin",
    "try.title": "Nularche'deki gibi yazın",
    "try.intro": "Sağa Nularche'de yazdığınız gibi yazın: satırı başlık için # ile, görev için - [ ] ile başlatın ya da Soru :: Cevap yazın. Solda Nularche'nin kaydettiği düz Markdown dosyası var; onu herhangi bir düzenleyici açabilir. Yazdığınız hiçbir şey bu sayfadan çıkmaz.",
    "try.yours": "Nularche'de",
    "try.file": "Markdown dosyası",
    "try.cards": "Anamnesis bilgi kartları",
    "feat.kicker": "Her şey tek stüdyoda",
    "feat.title": "Düşünmek, yazmak ve hatırlamak için tek uygulama",
    "feat.t.organise": "Düzenle",
    "feat.t.write": "Yaz",
    "feat.t.research": "Araştır",
    "feat.t.remember": "Hatırla",
    "feat.t.protect": "Koru",
    "priv.kicker": "Verileriniz",
    "priv.title": "Notlarınızın tam olarak nereye gittiğini görün",
    "priv.m.local": "Bu bilgisayar",
    "priv.m.drive": "Google Drive",
    "priv.m.e2e": "Drive + uçtan uca şifreleme",
    "priv.you": "Bilgisayarınız",
    "priv.drive": "Google Drive'ınız",
    "priv.us": "Nularche sunucuları",
    "priv.none": "Yok",
    "g.title": "Nularche, Google verilerini nasıl kullanır",
    "g.drive": "Notlarınızı Google Drive'da tutmayı seçerseniz Nularche yalnızca drive.file iznini ister. Yalnızca Nularche klasörünü ve kendi oluşturduğu dosyaları görebilir ve değiştirebilir, diğer dosyalarınızı asla. Bu erişimi yalnızca notlarınızı bilgisayarlarınız arasında eşitlemek için kullanır. Uçtan uca şifreleme açıkken dosyalar yüklenmeden önce bilgisayarınızda şifrelenir; Google bile okuyamaz.",
    "g.cal": "Google Takvim'i bağlarsanız Nularche takvimlerinizi Takvim sayfasında göstermek için okur; etkinlikleri yalnızca siz Nularche'de oluşturduğunuzda, düzenlediğinizde ya da sildiğinizde değiştirir.",
    "g.policy": "Nularche Google ile doğrudan bilgisayarınızdan konuşur. Google verileriniz bize ya da başkasına gönderilmez, reklam için kullanılmaz, satılmaz ve yapay zekâ eğitiminde kullanılmaz. Nularche'nin Google API'lerinden aldığı bilgileri kullanımı, Sınırlı Kullanım koşulları dahil Google API Hizmetleri Kullanıcı Verileri Politikası'na uyar.",
    "g.read": "Gizlilik politikasının tamamını okuyun",
    "lang.kicker": "Nularche dili",
    "lang.title": "Her parçanın kendi adı var",
    "lang.intro": "Anlamını görmek için bir karta dokunun.",
    "dl.kicker": "Herkes için ücretsiz",
    "dl.title": "Nularche'yi edinin",
    "dl.intro": "Her kurulum dosyası yayından önce kendi işletim sisteminde kurulup sınanır. Güncellemek notlarınızı ve ayarlarınızı korur.",
    "dl.terminal": "Ya da terminalden (macOS ve Linux)",
    "dl.copy": "Kopyala",
    "dl.source": "GitHub'da kaynak kod",
    "dl.notes": "Sürüm notları",
    "dl.web": "Tarayıcıda Nularche: yakında",
    "foot.privacy": "Gizlilik politikası",
    "foot.source": "Kaynak kod",
  };
  const EN = {};
  $$("[data-i18n]").forEach((el) => (EN[el.dataset.i18n] = el.textContent));
  let lang = store.get("nlc-lang") || ((navigator.language || "").toLowerCase().startsWith("tr") ? "tr" : "en");
  const t = (en, tr) => (lang === "tr" ? tr : en);

  function applyLang() {
    document.documentElement.lang = lang;
    $$("[data-i18n]").forEach((el) => {
      const k = el.dataset.i18n;
      el.textContent = lang === "tr" ? (TR[k] ?? EN[k]) : EN[k];
    });
    const btn = $("[data-lang-toggle]");
    btn.textContent = lang === "tr" ? "EN" : "TR";
    btn.setAttribute("aria-label", lang === "tr" ? "Dil: İngilizceye geç" : "Language: switch to Turkish");
    renderTab();
    renderFlow();
    renderGlossary();
    renderDemo();
    detectOs();
  }

  // ------------------------------------------------------------------ arka plan
  /** Sayfanın tek arka planı kaydırmayla hareket eder: kaydırma oranı (0–1) köke --p olarak yazılır. */
  function backdrop() {
    if (reduced) return;
    const root = document.documentElement;
    let ticking = false;
    const update = () => {
      const max = Math.max(1, root.scrollHeight - innerHeight);
      root.style.setProperty("--p", Math.min(1, Math.max(0, scrollY / max)).toFixed(4));
      ticking = false;
    };
    addEventListener(
      "scroll",
      () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(update);
      },
      { passive: true },
    );
    addEventListener("resize", update, { passive: true });
    update();
  }

  // ------------------------------------------------------------------ deneme editörü
  const LIB = {
    halbwachs1992: ["Halbwachs", "1992"],
    nora1989: ["Nora", "1989"],
    assmann2011: ["Assmann", "2011"],
  };
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  /**
   * Nularche'deki gibi yazılan küçük editör. Belge bloklardan oluşur ({t: tür, x: görev bitti mi, s: düz metin});
   * soldaki Markdown dosyası her değişiklikte bu bloklardan üretilir. Satır başı kuralları ("# ", "- ", "- [ ] ",
   * "> ") Nularche'deki gibi blok türüne dönüşür; [[bağlantı]], #etiket, [@atıf] ve Soru :: Cevap satırları
   * imlecin olmadığı bloklarda işlenmiş görünür. HTML hiçbir yerde yorumlanmaz.
   */
  const SAMPLE = `# Memory and the archive

Collective memory is a practice of the present [@halbwachs1992, p. 38]. See [[Chapter 2]] for archives. #research

What shapes what we remember? :: The archive

Lieu de mémoire ::: A place where memory crystallises

- [ ] Add the Nora chapter`;
  const CARD = /^(.*?\S)\s+(:{2,3})\s+(\S.*)$/;
  const MAX_BLOCKS = 200;
  const MAX_CHARS = 2000;
  let doc = [];
  const history = [];
  const future = [];

  function parseMd(md) {
    const out = [];
    for (const raw of md.replace(/\r/g, "").split("\n")) {
      const line = raw.replace(/\t/g, "  ").slice(0, MAX_CHARS);
      if (!line.trim()) continue;
      let m;
      if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) out.push({ t: `h${m[1].length}`, s: m[2] });
      else if ((m = /^\s*[-*+] \[( |x|X)\]\s?(.*)$/.exec(line))) out.push({ t: "task", x: m[1] !== " ", s: m[2] });
      else if ((m = /^\s*[-*+]\s+(.*)$/.exec(line))) out.push({ t: "li", s: m[1] });
      else if ((m = /^>\s?(.*)$/.exec(line))) out.push({ t: "quote", s: m[1] });
      else out.push({ t: "p", s: line });
    }
    return out.slice(0, MAX_BLOCKS);
  }
  const listy = (b) => b.t === "li" || b.t === "task";
  function toMd(blocks) {
    let md = "";
    blocks.forEach((b, i) => {
      const prefix = { h1: "# ", h2: "## ", h3: "### ", li: "- ", quote: "> ", p: "" }[b.t] ?? (b.x ? "- [x] " : "- [ ] ");
      if (i) md += listy(b) && listy(blocks[i - 1]) ? "\n" : "\n\n";
      md += prefix + b.s;
    });
    return md + "\n";
  }

  /** Satır içi işaretler: ham metin korunur, işaret karakterleri .mk içinde (imleç başka bloktayken gizlenir). */
  function decorate(text) {
    const out = [];
    const re = /\[\[([^\]\n]{1,80})\]\]|\[(-?@[^\]\n]{1,120})\]|(^|\s)(#[\p{L}\d_/-]{1,40})/gu;
    let last = 0;
    const mk = (s) => el("span", "mk", s);
    for (const m of text.matchAll(re)) {
      const start = m.index + (m[3] ? m[3].length : 0);
      out.push(document.createTextNode(text.slice(last, start)));
      if (m[1]) {
        const a = el("span", "d-link");
        a.append(mk("[["), m[1], mk("]]"));
        out.push(a);
      } else if (m[2]) {
        const c = el("span", "d-cite");
        c.dataset.label = citeLabel(m[2]);
        c.append(el("span", "raw", `[${m[2]}]`));
        out.push(c);
      } else out.push(el("span", "d-tag", m[4]));
      last = m.index + m[0].length;
    }
    out.push(document.createTextNode(text.slice(last)));
    return out;
  }
  function citeLabel(body) {
    return `(${body
      .split(";")
      .map((p) => {
        const mm = /^(-?)@([\w:.-]+)(?:,\s*(.+))?$/.exec(p.trim());
        if (!mm) return p.trim();
        const it = LIB[mm[2]];
        if (!it) return `?${mm[2]}`;
        return [mm[1] ? "" : it[0], it[1], mm[3] ? (lang === "tr" ? mm[3].replace(/^p\./, "s.") : mm[3]) : ""].filter(Boolean).join(", ");
      })
      .join("; ")})`;
  }
  function blockEl(b) {
    const d = el("div", "b");
    d.dataset.t = b.t;
    if (b.t === "task") d.dataset.x = b.x ? "1" : "0";
    const card = b.t === "p" && CARD.exec(b.s);
    if (card) {
      d.classList.add("card");
      const at = b.s.indexOf(card[2], card[1].length);
      d.append(...decorate(b.s.slice(0, at)), el("span", "sep", card[2]), ...decorate(b.s.slice(at + card[2].length)));
    } else d.append(...decorate(b.s));
    if (!b.s) d.append(el("br"));
    return d;
  }

  const editor = () => $("[data-demo-editor]");
  function caret() {
    const ed = editor();
    const sel = getSelection();
    if (!sel.rangeCount || !ed.contains(sel.anchorNode)) return null;
    const node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    const block = node.closest(".b");
    if (!block || block.parentElement !== ed) return null;
    const r = document.createRange();
    r.setStart(block, 0);
    r.setEnd(sel.anchorNode, sel.anchorOffset);
    return { i: [...ed.children].indexOf(block), o: r.toString().length, collapsed: sel.isCollapsed };
  }
  function place(i, o) {
    const block = editor().children[Math.max(0, Math.min(i, doc.length - 1))];
    if (!block) return;
    const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let left = o;
    let n;
    const r = document.createRange();
    r.setStart(block, 0);
    while ((n = walk.nextNode())) {
      if (left <= n.length) {
        r.setStart(n, left);
        break;
      }
      left -= n.length;
      r.setStart(n, n.length);
    }
    r.collapse(true);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    markActive();
  }
  function markActive() {
    const ed = editor();
    const c = caret();
    [...ed.children].forEach((b, i) => b.classList.toggle("active", !!c && c.i === i));
  }
  function draw(at) {
    const ed = editor();
    if (!doc.length) doc = [{ t: "p", s: "" }];
    ed.replaceChildren(...doc.map(blockEl));
    if (at) place(at.i, at.o);
    output();
  }
  function snapshot(at) {
    history.push({ doc: structuredClone(doc), at });
    if (history.length > 200) history.shift();
    future.length = 0;
  }
  /** Tarayıcının bloklarda yaptığı değişikliği belgeye geri okur. */
  function readDom() {
    const ed = editor();
    const blocks = [];
    for (const n of [...ed.childNodes]) {
      const text = n.textContent.replace(/ /g, " ").replace(/\n/g, "").slice(0, MAX_CHARS);
      if (n.nodeType === 1 && n.classList.contains("b")) blocks.push({ t: n.dataset.t || "p", x: n.dataset.x === "1", s: text });
      else if (text) blocks.push({ t: "p", s: text });
    }
    return blocks.slice(0, MAX_BLOCKS);
  }
  const RULES = [
    [/^#{1}\s/, "h1", 2],
    [/^#{2}\s/, "h2", 3],
    [/^#{3}\s/, "h3", 4],
    [/^\[( |x)?\]\s/i, "task", 0],
    [/^[-*+]\s\[( |x)?\]\s/i, "task", 0],
    [/^[-*+]\s/, "li", 2],
    [/^>\s/, "quote", 2],
  ];
  function inputRules(c) {
    const b = doc[c.i];
    if (!b || (b.t !== "p" && !(b.t === "li" && /^\[( |x)?\]\s/i.test(b.s)))) return c;
    for (const [re, t, n] of RULES) {
      const m = re.exec(b.s);
      if (!m) continue;
      const cut = n || m[0].length;
      if (c.o < cut) return c;
      b.t = t;
      if (t === "task") b.x = /x/i.test(m[0]);
      b.s = b.s.slice(cut);
      return { i: c.i, o: c.o - cut };
    }
    return c;
  }
  function onInput(e) {
    if (e.isComposing) return;
    const before = structuredClone(doc);
    const c = caret() || { i: doc.length - 1, o: 0 };
    doc = readDom();
    history.push({ doc: before, at: c });
    future.length = 0;
    draw(inputRules(c));
  }
  function onKey(e) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      const from = e.shiftKey ? future : history;
      const to = e.shiftKey ? history : future;
      const s = from.pop();
      if (!s) return;
      to.push({ doc: structuredClone(doc), at: caret() || s.at });
      doc = s.doc;
      draw(s.at);
      return;
    }
    if (mod && e.key.toLowerCase() === "y") return e.preventDefault();
    let c = caret();
    if (!c) return;
    if (e.key === "Enter") {
      e.preventDefault();
      if (!c.collapsed) {
        document.execCommand("delete");
        doc = readDom();
        c = caret() || c;
      }
      snapshot(c);
      const b = doc[c.i];
      if (listy(b) && !b.s) {
        b.t = "p";
        return draw({ i: c.i, o: 0 });
      }
      if (doc.length >= MAX_BLOCKS) return;
      const next = { t: listy(b) || b.t === "quote" ? b.t : "p", x: false, s: b.s.slice(c.o) };
      b.s = b.s.slice(0, c.o);
      doc.splice(c.i + 1, 0, next);
      return draw({ i: c.i + 1, o: 0 });
    }
    if (e.key === "Backspace" && c.collapsed && c.o === 0) {
      const b = doc[c.i];
      if (b.t !== "p") {
        e.preventDefault();
        snapshot(c);
        b.t = "p";
        return draw(c);
      }
      if (c.i > 0) {
        e.preventDefault();
        snapshot(c);
        const prev = doc[c.i - 1];
        const o = prev.s.length;
        prev.s += b.s;
        doc.splice(c.i, 1);
        return draw({ i: c.i - 1, o });
      }
    }
    if (e.key === "Delete" && c.collapsed && c.o === doc[c.i].s.length && c.i < doc.length - 1) {
      e.preventDefault();
      snapshot(c);
      doc[c.i].s += doc[c.i + 1].s;
      doc.splice(c.i + 1, 1);
      return draw(c);
    }
  }
  function onPaste(e) {
    e.preventDefault();
    const text = (e.clipboardData?.getData("text/plain") || "").slice(0, 20000);
    if (!text) return;
    let c = caret();
    if (!c) return;
    if (!c.collapsed) {
      document.execCommand("delete");
      doc = readDom();
      c = caret() || c;
    }
    snapshot(c);
    const b = doc[c.i];
    const head = b.s.slice(0, c.o);
    const tail = b.s.slice(c.o);
    const lines = text.replace(/\r/g, "").split("\n");
    if (lines.length === 1) {
      b.s = (head + lines[0] + tail).slice(0, MAX_CHARS);
      return draw({ i: c.i, o: head.length + lines[0].length });
    }
    const pasted = parseMd(lines.slice(1).join("\n"));
    b.s = head + lines[0];
    const last = pasted.length ? pasted[pasted.length - 1] : b;
    const o = last.s.length;
    last.s += tail;
    doc.splice(c.i + 1, 0, ...pasted);
    doc = doc.slice(0, MAX_BLOCKS);
    draw({ i: c.i + pasted.length, o });
  }
  /** Görev kutusu: satırın solundaki kutuya tıklamak işaretler. */
  function onPointer(e) {
    const block = e.target.closest?.(".b[data-t='task']");
    if (!block) return;
    const r = block.getBoundingClientRect();
    if (e.clientX - r.left > 32) return;
    e.preventDefault();
    const i = [...editor().children].indexOf(block);
    snapshot(caret());
    doc[i].x = !doc[i].x;
    draw();
  }

  /** Soldaki dosya görünümü: Markdown sözdizimi renklendirilir (yalnızca metin düğümleri). */
  function output() {
    const md = toMd(doc);
    const pre = $("[data-demo-md]");
    const lines = md.split("\n");
    const frag = [];
    const re = /\[\[[^\]\n]+\]\]|\[-?@[^\]\n]+\]|(?<=^|\s)#[\p{L}\d_/-]+|\s:{2,3}\s/gu;
    lines.forEach((line, n) => {
      const m = /^(#{1,3} |\s*[-*+] \[[ xX]\] |\s*[-*+] |> )/.exec(line);
      const row = el("span", m && m[1].startsWith("#") ? "m-h" : "");
      let rest = line;
      if (m) {
        row.append(el("span", "m-mk", m[1]));
        rest = line.slice(m[1].length);
      }
      let last = 0;
      for (const x of rest.matchAll(re)) {
        row.append(rest.slice(last, x.index));
        const v = x[0];
        row.append(el("span", v.startsWith("[[") ? "m-link" : v.startsWith("[") ? "m-cite" : v.startsWith("#") ? "m-tag" : "m-card", v));
        last = x.index + v.length;
      }
      row.append(rest.slice(last));
      frag.push(row);
      if (n < lines.length - 1) frag.push("\n");
    });
    pre.replaceChildren(...frag);
    const h = doc.find((b) => /^h[1-3]$/.test(b.t) && b.s.trim());
    const name = (h ? h.s.trim() : t("Untitled", "Adsız")).replace(/[\\/:*?"<>|#^[\]]/g, "").slice(0, 60) || t("Untitled", "Adsız");
    $("[data-demo-name]").textContent = `${name}.md`;
    cards();
  }
  function cards() {
    const box = $("[data-demo-cards]");
    box.replaceChildren();
    const list = [];
    for (const b of doc) {
      const m = b.t === "p" && CARD.exec(b.s);
      if (!m) continue;
      list.push([m[1], m[3]]);
      if (m[2] === ":::") list.push([m[3], m[1]]);
    }
    if (!list.length) box.append(el("p", "muted", t("Write a line like Question :: Answer.", "Soru :: Cevap gibi bir satır yazın.")));
    for (const [q, a] of list.slice(0, 12)) {
      const c = el("button", "flash");
      c.type = "button";
      c.append(el("span", "front", q), el("span", "back", a));
      c.addEventListener("click", () => c.classList.toggle("flipped"));
      box.append(c);
    }
  }
  function renderDemo() {
    if (!editor()) return;
    const focused = editor().contains(document.activeElement) || document.activeElement === editor();
    draw(focused ? caret() : null);
  }
  function demo() {
    const ed = editor();
    if (!ed) return;
    doc = parseMd(SAMPLE);
    ed.addEventListener("input", onInput);
    ed.addEventListener("compositionend", onInput);
    ed.addEventListener("keydown", onKey);
    ed.addEventListener("paste", onPaste);
    ed.addEventListener("drop", (e) => e.preventDefault());
    ed.addEventListener("mousedown", onPointer);
    document.addEventListener("selectionchange", markActive);
    $$("[data-insert]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const add = btn.dataset.insert;
        const c = caret() || { i: doc.length - 1, o: doc[doc.length - 1].s.length };
        snapshot(c);
        const b = doc[c.i];
        if (btn.dataset.block) {
          const nb = { t: btn.dataset.block, x: false, s: add };
          if (!b.s.trim() && b.t === "p") doc[c.i] = nb;
          else doc.splice(c.i + 1, 0, nb);
          const i = !b.s.trim() && b.t === "p" ? c.i : c.i + 1;
          ed.focus();
          return draw({ i, o: add.length });
        }
        const before = b.s.slice(0, c.o);
        const sep = before && !/\s$/.test(before) ? " " : "";
        b.s = `${before}${sep}${add}${b.s.slice(c.o)}`;
        ed.focus();
        draw({ i: c.i, o: c.o + sep.length + add.length });
      }),
    );
  }

  // ------------------------------------------------------------------ özellik sekmeleri
  const TABS = {
    organise: {
      img: "/assets/organise.png",
      alt: ["The sidebar with Arches grouped into Archipelagos over the Lavender Hills", "Lavanta tepeleri üzerinde Archipelago'lara ayrılmış Arche'lerle kenar çubuğu"],
      title: ["Notes, databases and boards", "Notlar, veritabanları ve panolar"],
      items: [
        ["Arches with nested pages, a Shadow inbox, tags, smart folders, backlinks and a graph.", "İç içe sayfalı Arche'ler, Shadow gelen kutusu, etiketler, akıllı klasörler, geri bağlantılar ve grafik."],
        ["Databases with Table, Board, Calendar, Gallery, List and Timeline views; every row is a page.", "Tablo, Pano, Takvim, Galeri, Liste ve Zaman çizelgesi görünümlü veritabanları; her satır bir sayfa."],
        ["Tabula: a whiteboard with pressure-sensitive pens, 130+ diagram shapes and ~4,800 icons.", "Tabula: basınca duyarlı kalemler, 130'dan fazla şema şekli ve yaklaşık 4.800 simgeyle beyaz tahta."],
      ],
    },
    write: {
      img: "/assets/codex.png",
      alt: ["A Codex manuscript with chapters and a word goal", "Bölümleri ve kelime hedefi olan bir Codex manuskripti"],
      title: ["A writing studio", "Bir yazma stüdyosu"],
      items: [
        ["Codex manuscripts, Axis outlines, Mosaic card boards and a Lore story bible.", "Codex manuskriptleri, Axis taslakları, Mosaic kart panoları ve Lore hikâye kılavuzu."],
        ["Word goals and streaks, focus mode, typewriter and ambient sounds, Nularche's own handwriting font.", "Kelime hedefleri ve seriler, odak modu, daktilo ve ortam sesleri, Nularche'nin kendi el yazısı fontu."],
        ["Export to Word, RTF, HTML and PDF, or publish a static website in one click.", "Word, RTF, HTML ve PDF'e aktarma ya da tek tıkla statik site yayınlama."],
      ],
    },
    research: {
      img: "/assets/lectio.png",
      alt: ["The Lectio PDF reader with highlights and comments", "Vurgular ve yorumlarla Lectio PDF okuyucusu"],
      title: ["Read, cite and connect", "Oku, atıf yap ve bağla"],
      items: [
        ["Lectio: highlight PDFs and turn highlights into notes that link back to the page.", "Lectio: PDF'leri vurgulayın, vurguları sayfasına dönen bağlantılı notlara dönüştürün."],
        ["Fontes: [@key] citations from BibTeX or CSL-JSON, bibliographies in APA, Chicago, MLA or IEEE.", "Fontes: BibTeX ya da CSL-JSON'dan [@anahtar] atıfları; APA, Chicago, MLA ya da IEEE kaynakça."],
        ["Tessera: link to or embed a single paragraph; Claritas: a readability score as you write.", "Tessera: tek bir paragrafa bağlantı ya da gömme; Claritas: yazarken okunabilirlik puanı."],
      ],
    },
    remember: {
      img: "/assets/anamnesis.png",
      alt: ["An Anamnesis flashcard with its review buttons", "Tekrar düğmeleriyle bir Anamnesis bilgi kartı"],
      title: ["Make knowledge stick", "Bilgiyi kalıcı kılın"],
      items: [
        ["Anamnesis: every Question :: Answer line becomes a flashcard, scheduled with the FSRS algorithm.", "Anamnesis: her Soru :: Cevap satırı FSRS algoritmasıyla zamanlanan bir bilgi kartı olur."],
        ["Speculum: live queries inside a note list notes by tag, Arche or property as they change.", "Speculum: not içindeki canlı sorgular, notları etikete, Arche'ye ya da özelliğe göre değiştikçe listeler."],
        ["Vigil: scheduled automations, such as a weekly digest written by Nularche AI.", "Vigil: Nularche AI'ın yazdığı haftalık özet gibi zamanlanmış otomasyonlar."],
      ],
    },
    protect: {
      img: "/assets/security.png",
      alt: ["Settings → Security: auto-lock, encrypted Arches and snapshots", "Ayarlar → Güvenlik: otomatik kilit, şifreli Arche'ler ve anlık görüntüler"],
      title: ["Private by default", "Varsayılan olarak gizli"],
      items: [
        ["Locked notes and Crypta: AES-256 encrypted notes and whole Arches, with a password that is never stored.", "Kilitli notlar ve Crypta: parolası hiç saklanmayan, AES-256 ile şifreli notlar ve bütün Arche'ler."],
        ["Custos closes open locked notes when you step away; Strata keeps encrypted snapshots you can restore.", "Custos, uzaklaşınca açık kilitli notları kapatır; Strata geri yüklenebilir şifreli anlık görüntüler tutar."],
        ["Optional Google Drive sync with end-to-end encryption, so not even Google can read your notes.", "İsteğe bağlı, uçtan uca şifreli Google Drive eşitlemesi: notlarınızı Google bile okuyamaz."],
      ],
    },
  };
  let tab = "organise";
  function renderTab() {
    const d = TABS[tab];
    const i = lang === "tr" ? 1 : 0;
    $("[data-tab-title]").textContent = d.title[i];
    $("[data-tab-list]").replaceChildren(...d.items.map((x) => el("li", "", x[i])));
    const img = $("[data-tab-img]");
    img.src = d.img;
    img.alt = d.alt[i];
  }
  function tabs() {
    const buttons = $$("[data-tab]");
    const select = (b, focus) => {
      buttons.forEach((x) => x.setAttribute("aria-selected", String(x === b)));
      buttons.forEach((x) => (x.tabIndex = x === b ? 0 : -1));
      tab = b.dataset.tab;
      renderTab();
      if (focus) b.focus();
    };
    buttons.forEach((b, i) => {
      b.tabIndex = i === 0 ? 0 : -1;
      b.addEventListener("click", () => select(b));
      b.addEventListener("keydown", (e) => {
        const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (dir) select(buttons[(i + dir + buttons.length) % buttons.length], true);
      });
    });
  }

  // ------------------------------------------------------------------ veri akışı
  let mode = "local";
  const FLOW = {
    local: {
      packet: "",
      drive: ["not used", "kullanılmıyor"],
      caption: ["Your notes stay in a folder on this computer as plain Markdown files. Nothing is uploaded.", "Notlarınız bu bilgisayarda bir klasörde düz Markdown dosyaları olarak durur. Hiçbir şey yüklenmez."],
    },
    drive: {
      packet: "Plan.md",
      drive: ["Plan.md: “# Plan …”", "Plan.md: “# Plan …”"],
      caption: [
        "Your notes sync with your own Google Drive, straight from your computer. Nularche can see only the folder it created.",
        "Notlarınız doğrudan bilgisayarınızdan kendi Google Drive'ınızla eşitlenir. Nularche yalnızca kendi oluşturduğu klasörü görebilir.",
      ],
    },
    e2e: {
      packet: "9f3c…e1.nlce",
      drive: ["9f3c…e1.nlce: unreadable", "9f3c…e1.nlce: okunamaz"],
      caption: [
        "Each file is encrypted on your computer before upload (AES-256). Even file names are hidden; only your passphrase opens them.",
        "Her dosya yüklenmeden önce bilgisayarınızda şifrelenir (AES-256). Dosya adları bile gizlidir; yalnızca sizin parolanız açar.",
      ],
    },
  };
  function renderFlow() {
    const f = FLOW[mode];
    const i = lang === "tr" ? 1 : 0;
    const box = $("[data-flow]");
    box.dataset.flow = mode;
    $("[data-packet]").textContent = f.packet;
    $(".packet").hidden = !f.packet;
    $("[data-drive-sees]").textContent = f.drive[i];
    $("[data-flow-caption]").textContent = f.caption[i];
  }
  function flow() {
    const radios = $$("[data-mode]");
    radios.forEach((b) =>
      b.addEventListener("click", () => {
        radios.forEach((x) => x.setAttribute("aria-checked", String(x === b)));
        mode = b.dataset.mode;
        renderFlow();
      }),
    );
  }

  // ------------------------------------------------------------------ Nularche dili
  const GLOSSARY = [
    ["Origin", "Your notes folder.", "Notlarınızın klasörü."],
    ["Arche", "A top-level area or project.", "En üst düzey alan ya da proje."],
    ["Node", "A page.", "Bir sayfa."],
    ["Shadow", "The inbox for quick, unfiled notes.", "Henüz yerleştirilmemiş notların gelen kutusu."],
    ["Atrium", "The home page: where you left off, goals and projects.", "Ana sayfa: kaldığınız yer, hedefler ve projeler."],
    ["Codex", "A manuscript of ordered chapters.", "Sıralı bölümlerden oluşan manuskript."],
    ["Tabula", "A whiteboard over your writing background.", "Yazı arka planınızın üzerinde beyaz tahta."],
    ["Lore", "A story bible of characters, places and ideas.", "Karakterler, mekânlar ve fikirlerden oluşan hikâye kılavuzu."],
    ["Fontes", "Your bibliography and [@key] citations.", "Kaynakçanız ve [@anahtar] atıfları."],
    ["Lectio", "The PDF reader with highlights.", "Vurgulu PDF okuyucu."],
    ["Tessera", "A link to a single block.", "Tek bir bloğa bağlantı."],
    ["Speculum", "A live query inside a note.", "Not içinde canlı sorgu."],
    ["Anamnesis", "Flashcards with spaced repetition.", "Aralıklı tekrarlı bilgi kartları."],
    ["Vigil", "A scheduled automation.", "Zamanlanmış otomasyon."],
    ["Crypta", "An Arche encrypted with one password.", "Tek parolayla şifrelenmiş Arche."],
    ["Strata", "Encrypted snapshots of everything.", "Her şeyin şifreli anlık görüntüleri."],
  ];
  function renderGlossary() {
    const box = $("[data-glossary]");
    if (!box) return;
    box.replaceChildren(
      ...GLOSSARY.map(([term, en, tr]) => {
        const c = el("button", "term");
        c.type = "button";
        c.append(el("span", "front", term), el("span", "back", lang === "tr" ? tr : en));
        c.addEventListener("click", () => c.classList.toggle("flipped"));
        return c;
      }),
    );
  }

  // ------------------------------------------------------------------ indirme
  function detectOs() {
    const ua = navigator.userAgent;
    const plat = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
    let os = null;
    if (/Mac/i.test(plat) || /Macintosh/.test(ua)) os = "mac-arm";
    else if (/Win/i.test(plat) || /Windows/.test(ua)) os = "win-x64"; // 32 bit Windows artık çok nadir; gerekirse listeden seçilir
    else if (/Linux/i.test(plat) && !/Android/i.test(ua)) os = "linux";
    $$(".platform").forEach((p) => p.classList.toggle("recommended", p.dataset.os === os));
    const note = $("[data-detected]");
    const primary = $("[data-download-primary]");
    if (!os) {
      note.textContent = t("Pick your system above.", "Yukarıdan sisteminizi seçin.");
      return;
    }
    const link = $(`.platform[data-os="${os}"]`);
    primary.href = link.href;
    const name = `${$("b", link).textContent} ${$("span", link).textContent}`;
    note.textContent =
      os === "mac-arm"
        ? t(`Recommended for you: ${name}. On a Mac with an Intel processor, choose Intel.`, `Size önerilen: ${name}. Intel işlemcili bir Mac'te Intel'i seçin.`)
        : t(`Recommended for you: ${name}.`, `Size önerilen: ${name}.`);
  }
  function copyButton() {
    const b = $("[data-copy]");
    if (!b) return;
    b.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText($("[data-term]").textContent);
        b.textContent = t("Copied", "Kopyalandı");
      } catch {
        b.textContent = t("Select and copy", "Seçip kopyalayın");
      }
      setTimeout(() => (b.textContent = lang === "tr" ? TR["dl.copy"] : EN["dl.copy"]), 1800);
    });
  }

  // ------------------------------------------------------------------ belirme
  function reveal() {
    const items = $$(".reveal");
    if (reduced || !("IntersectionObserver" in window)) return items.forEach((e) => e.classList.add("in"));
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }),
      { threshold: 0.15 },
    );
    items.forEach((e) => io.observe(e));
  }

  document.documentElement.classList.add("js");
  $("[data-lang-toggle]").addEventListener("click", () => {
    lang = lang === "tr" ? "en" : "tr";
    store.set("nlc-lang", lang);
    applyLang();
  });
  backdrop();
  demo();
  tabs();
  flow();
  copyButton();
  reveal();
  applyLang();
})();
