// nularche.verseofac.com etkileşimleri: dil (EN/TR), canlı bilgi ağı, deneme editörü, özellik sekmeleri, veri akışı,
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
    "hero.hint": "İmleci gezdirin: her nokta bir not, her çizgi bir bağlantı.",
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
    "try.intro": "Sola yazın. Nularche düz Markdown okur; bağlantıları, etiketleri, atıfları ve bilgi kartlarını kullanılabilir hâle getirir. Yazdığınız hiçbir şey bu sayfadan çıkmaz.",
    "try.yours": "Notunuz",
    "try.sees": "Nularche'nin gördüğü",
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

  // ------------------------------------------------------------------ canlı bilgi ağı
  function graph() {
    const canvas = $(".graph");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let w = 0;
    let h = 0;
    let dpr = 1;
    const mouse = { x: -1e4, y: -1e4 };
    const nodes = [];
    const resize = () => {
      dpr = Math.min(2, devicePixelRatio || 1);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const want = Math.round(Math.min(110, (w * h) / 12000));
      while (nodes.length < want) nodes.push({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25, r: 1 + Math.random() * 2.2, hub: Math.random() < 0.08 });
      nodes.length = want;
    };
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const R = 150;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < R) {
            ctx.strokeStyle = `rgba(110, 220, 235, ${0.22 * (1 - d / R)})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
        const dm = Math.hypot(a.x - mouse.x, a.y - mouse.y);
        if (dm < 190) {
          ctx.strokeStyle = `rgba(160, 140, 255, ${0.45 * (1 - dm / 190)})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(mouse.x, mouse.y);
          ctx.stroke();
        }
      }
      for (const n of nodes) {
        ctx.fillStyle = n.hub ? "rgba(190, 170, 255, 0.95)" : "rgba(160, 235, 245, 0.75)";
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.hub ? n.r + 1.5 : n.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    const step = () => {
      for (const n of nodes) {
        const dx = mouse.x - n.x;
        const dy = mouse.y - n.y;
        const d = Math.hypot(dx, dy);
        if (d < 190 && d > 1) {
          n.vx += (dx / d) * 0.012;
          n.vy += (dy / d) * 0.012;
        }
        n.vx = Math.max(-0.6, Math.min(0.6, n.vx * 0.995));
        n.vy = Math.max(-0.6, Math.min(0.6, n.vy * 0.995));
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > w) n.vx *= -1;
        if (n.y < 0 || n.y > h) n.vy *= -1;
      }
      draw();
      if (visible) requestAnimationFrame(step);
    };
    let visible = true;
    addEventListener("resize", resize);
    const hero = canvas.parentElement;
    hero.addEventListener("pointermove", (e) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
      if (reduced) draw();
    });
    hero.addEventListener("pointerleave", () => ((mouse.x = -1e4), (mouse.y = -1e4)));
    resize();
    if (reduced) return draw();
    new IntersectionObserver(([e]) => {
      const was = visible;
      visible = e.isIntersecting;
      if (visible && !was) requestAnimationFrame(step);
    }).observe(canvas);
    requestAnimationFrame(step);
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
  /** Satır içi parçalar: [[bağlantı]], #etiket, [@atıf] ve düz metin (DOM düğümleri; HTML yorumlanmaz). */
  function inline(text) {
    const out = [];
    const re = /\[\[([^\]\n]{1,80})\]\]|\[(-?@[^\]\n]{1,120})\]|(^|\s)#([\p{L}\d_/-]{1,40})/gu;
    let last = 0;
    for (const m of text.matchAll(re)) {
      const start = m.index + (m[3] ? m[3].length : 0);
      out.push(document.createTextNode(text.slice(last, start)));
      if (m[1]) out.push(el("span", "d-link", m[1]));
      else if (m[2]) {
        const parts = m[2].split(";").map((p) => p.trim());
        const label = parts
          .map((p) => {
            const mm = /^(-?)@([\w:.-]+)(?:,\s*(.+))?$/.exec(p);
            if (!mm) return p;
            const it = LIB[mm[2]];
            if (!it) return `?${mm[2]}`;
            return [mm[1] ? "" : it[0], it[1], mm[3] ? (lang === "tr" ? mm[3].replace(/^p\./, "s.") : mm[3]) : ""].filter(Boolean).join(", ");
          })
          .join("; ");
        out.push(el("span", "d-cite", `(${label})`));
      } else out.push(el("span", "d-tag", `#${m[4]}`));
      last = m.index + m[0].length;
    }
    out.push(document.createTextNode(text.slice(last)));
    return out;
  }
  function renderDemo() {
    const input = $("[data-demo-input]");
    const view = $("[data-demo-render]");
    const cardsBox = $("[data-demo-cards]");
    if (!input || !view) return;
    view.replaceChildren();
    cardsBox.replaceChildren();
    const cards = [];
    let para = null;
    for (const raw of input.value.split("\n").slice(0, 200)) {
      const line = raw.slice(0, 500);
      const h = /^(#{1,3})\s+(.*)$/.exec(line);
      const task = /^\s*[-*] \[( |x)\]\s+(.*)$/i.exec(line);
      const card = /^(.*?\S)\s+(:{2,3})\s+(\S.*)$/.exec(line);
      if (!line.trim()) {
        para = null;
        continue;
      }
      if (h) {
        const e = el(`h${h[1].length + 2}`);
        e.append(...inline(h[2]));
        view.append(e);
        para = null;
      } else if (task) {
        const row = el("label", "d-task");
        const box = el("input");
        box.type = "checkbox";
        box.checked = task[1].toLowerCase() === "x";
        row.append(box, ...inline(` ${task[2]}`));
        view.append(row);
        para = null;
      } else if (card) {
        cards.push([card[1], card[3]]);
        if (card[2] === ":::") cards.push([card[3], card[1]]);
        const e = el("p", "d-cardline");
        e.append(el("span", "d-badge", "Anamnesis"), document.createTextNode(` ${card[1]} → ${card[3]}`));
        view.append(e);
        para = null;
      } else {
        if (!para) {
          para = el("p");
          view.append(para);
        } else para.append(document.createTextNode(" "));
        para.append(...inline(line));
      }
    }
    if (!cards.length) cardsBox.append(el("p", "muted", t("Write a line like Question :: Answer.", "Soru :: Cevap gibi bir satır yazın.")));
    for (const [q, a] of cards.slice(0, 12)) {
      const c = el("button", "flash");
      c.type = "button";
      c.append(el("span", "front", q), el("span", "back", a));
      c.addEventListener("click", () => c.classList.toggle("flipped"));
      cardsBox.append(c);
    }
  }
  function demo() {
    const input = $("[data-demo-input]");
    if (!input) return;
    input.addEventListener("input", renderDemo);
    $$("[data-insert]").forEach((b) =>
      b.addEventListener("click", () => {
        const add = b.dataset.insert;
        const { selectionStart: s, selectionEnd: e, value } = input;
        const before = value.slice(0, s);
        const sep = before && !/\s$/.test(before) ? " " : "";
        input.value = `${before}${sep}${add}${value.slice(e)}`;
        input.focus();
        const pos = s + sep.length + add.length;
        input.setSelectionRange(pos, pos);
        renderDemo();
      }),
    );
  }

  // ------------------------------------------------------------------ özellik sekmeleri
  const TABS = {
    organise: {
      img: "/assets/project.png",
      alt: ["A project page with an embedded task board", "Gömülü görev panosu olan bir proje sayfası"],
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
  graph();
  demo();
  tabs();
  flow();
  copyButton();
  reveal();
  applyLang();
})();
