// Hazır şablonlar. İçerik arayüz diline göre üretilir; kullanıldığında sıradan Node'lar olarak oluşturulur
// (veritabanı şemaları ve örnek satırlar dahil), sonrasında kullanıcı istediği gibi değiştirir.

import { api, type NodeMeta, type ParentTarget } from "../api.ts";
import { getLang } from "../i18n/index.ts";
import { todayIso } from "../database/model.ts";
import { dirname, relative } from "../editor/paths.ts";

type Lang = "tr" | "en";
type L = Record<Lang, string>;

interface RowSpec {
  title: L;
  props: Record<string, unknown>;
  icon?: string;
}

interface DbSpec {
  properties: unknown[];
  views: unknown[];
  rows: RowSpec[];
}

export interface BuiltinTemplate {
  key: string;
  icon: string;
  title: L;
  description: L;
  body?: L;
  cover?: string;
  /** Sayfanın kendisi veritabanı */
  database?: DbSpec;
  /** Sayfanın altında oluşturulacak veritabanı */
  childDatabase?: { title: L; icon?: string; spec: DbSpec };
}

const opt = (id: string, tr: string, en: string, color: string) => ({ id, name: { tr, en }, color });
const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Şablon tanımındaki { tr, en } değerlerini seçili dile çevirir. */
function localize(value: unknown, lang: Lang): unknown {
  if (Array.isArray(value)) return value.map((v) => localize(v, lang));
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (Object.keys(o).length === 2 && typeof o.tr === "string" && typeof o.en === "string") return o[lang];
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, localize(v, lang)]));
  }
  return value;
}

const STATUS_TASK = {
  id: "status",
  name: { tr: "Durum", en: "Status" },
  type: "status",
  options: [opt("todo", "Yapılacak", "To do", "gray"), opt("doing", "Sürüyor", "In progress", "blue"), opt("done", "Bitti", "Done", "green")],
};
const PRIORITY = {
  id: "priority",
  name: { tr: "Öncelik", en: "Priority" },
  type: "select",
  options: [opt("high", "Yüksek", "High", "red"), opt("medium", "Orta", "Medium", "yellow"), opt("low", "Düşük", "Low", "gray")],
};
const DUE = { id: "due", name: { tr: "Son tarih", en: "Due date" }, type: "date" };

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    key: "meeting",
    icon: "🗓️",
    title: { tr: "Toplantı notu", en: "Meeting notes" },
    description: { tr: "Katılımcılar, gündem, kararlar ve yapılacaklar.", en: "Attendees, agenda, decisions and action items." },
    body: {
      tr: `**Tarih:** ${"{today}"}\n\n## Katılımcılar\n\n- \n\n## Gündem\n\n1. \n\n## Notlar\n\n\n\n## Kararlar\n\n- \n\n## Yapılacaklar\n\n- [ ] `,
      en: `**Date:** ${"{today}"}\n\n## Attendees\n\n- \n\n## Agenda\n\n1. \n\n## Notes\n\n\n\n## Decisions\n\n- \n\n## Action items\n\n- [ ] `,
    },
  },
  {
    key: "project",
    icon: "🚀",
    cover: "gradient-2",
    title: { tr: "Proje", en: "Project" },
    description: { tr: "Proje özeti ve pano, tablo, zaman çizelgesi görünümlü görevler.", en: "Project brief with tasks on a board, table and timeline." },
    body: {
      tr: "## Amaç\n\nBu proje neyi başaracak?\n\n## Kapsam\n\n- \n\n## Başarı ölçütleri\n\n- \n\n## Görevler\n\n{database}",
      en: "## Goal\n\nWhat will this project achieve?\n\n## Scope\n\n- \n\n## Success criteria\n\n- \n\n## Tasks\n\n{database}",
    },
    childDatabase: {
      title: { tr: "Görevler", en: "Tasks" },
      icon: "✅",
      spec: {
        properties: [STATUS_TASK, PRIORITY, DUE, { id: "owner", name: { tr: "Sorumlu", en: "Owner" }, type: "text" }],
        views: [
          { id: "v_board", name: { tr: "Pano", en: "Board" }, type: "board", groupBy: "status" },
          { id: "v_table", name: { tr: "Tablo", en: "Table" }, type: "table", sorts: [{ prop: "due", dir: "asc" }] },
          { id: "v_timeline", name: { tr: "Zaman çizelgesi", en: "Timeline" }, type: "timeline", dateProp: "due" },
        ],
        rows: [
          { title: { tr: "Başlangıç toplantısı", en: "Kick-off meeting" }, props: { status: "done", priority: "high", due: day(-2) } },
          { title: { tr: "Gereksinimleri yaz", en: "Write requirements" }, props: { status: "doing", priority: "high", due: { start: day(0), end: day(4) } } },
          { title: { tr: "İlk sürümü hazırla", en: "Prepare the first version" }, props: { status: "todo", priority: "medium", due: day(10) } },
        ],
      },
    },
  },
  {
    key: "reading",
    icon: "📚",
    title: { tr: "Okuma listesi", en: "Reading list" },
    description: { tr: "Kitaplar ve makaleler: galeri ve tablo görünümü, durum ve puan.", en: "Books and articles in gallery and table views, with status and rating." },
    database: {
      properties: [
        { id: "author", name: { tr: "Yazar", en: "Author" }, type: "text" },
        {
          id: "status",
          name: { tr: "Durum", en: "Status" },
          type: "status",
          options: [opt("toread", "Okunacak", "To read", "gray"), opt("reading", "Okunuyor", "Reading", "blue"), opt("read", "Okundu", "Read", "green")],
        },
        { id: "type", name: { tr: "Tür", en: "Type" }, type: "multi_select", options: [opt("book", "Kitap", "Book", "brown"), opt("article", "Makale", "Article", "blue"), opt("podcast", "Podcast", "Podcast", "purple")] },
        { id: "rating", name: { tr: "Puan", en: "Rating" }, type: "select", options: [opt("r5", "★★★★★", "★★★★★", "yellow"), opt("r4", "★★★★", "★★★★", "yellow"), opt("r3", "★★★", "★★★", "orange")] },
        { id: "url", name: { tr: "Bağlantı", en: "Link" }, type: "url" },
      ],
      views: [
        { id: "v_gallery", name: { tr: "Galeri", en: "Gallery" }, type: "gallery" },
        { id: "v_board", name: { tr: "Duruma göre", en: "By status" }, type: "board", groupBy: "status" },
        { id: "v_table", name: { tr: "Tablo", en: "Table" }, type: "table" },
      ],
      rows: [
        { title: { tr: "Örnek kitap", en: "Sample book" }, icon: "📘", props: { author: "—", status: "reading", type: ["book"] } },
        { title: { tr: "Örnek makale", en: "Sample article" }, icon: "📄", props: { status: "toread", type: ["article"] } },
      ],
    },
  },
  {
    key: "tasks",
    icon: "✅",
    title: { tr: "Görev panosu", en: "Task board" },
    description: { tr: "Kanban panosu, öncelik ve takvim görünümü.", en: "Kanban board with priorities and a calendar view." },
    database: {
      properties: [STATUS_TASK, PRIORITY, DUE, { id: "tags", name: { tr: "Etiketler", en: "Tags" }, type: "multi_select", options: [] }],
      views: [
        { id: "v_board", name: { tr: "Pano", en: "Board" }, type: "board", groupBy: "status" },
        { id: "v_calendar", name: { tr: "Takvim", en: "Calendar" }, type: "calendar", dateProp: "due" },
        { id: "v_table", name: { tr: "Tablo", en: "Table" }, type: "table" },
      ],
      rows: [
        { title: { tr: "İlk görev", en: "First task" }, props: { status: "todo", priority: "medium", due: day(1) } },
        { title: { tr: "Devam eden görev", en: "Task in progress" }, props: { status: "doing", priority: "high", due: day(0) } },
      ],
    },
  },
  {
    key: "habits",
    icon: "🌱",
    title: { tr: "Alışkanlık takibi", en: "Habit tracker" },
    description: { tr: "Her gün için onay kutuları ve otomatik tamamlanma yüzdesi.", en: "Daily checkboxes with an automatic completion percentage." },
    database: {
      properties: [
        { id: "date", name: { tr: "Tarih", en: "Date" }, type: "date" },
        { id: "exercise", name: { tr: "Spor", en: "Exercise" }, type: "checkbox" },
        { id: "reading", name: { tr: "Okuma", en: "Reading" }, type: "checkbox" },
        { id: "water", name: { tr: "2 L su", en: "2 L water" }, type: "checkbox" },
        {
          id: "score",
          name: { tr: "Tamamlanan", en: "Completed" },
          type: "formula",
          expression: {
            tr: 'concat(round((toNumber(prop("Spor")) + toNumber(prop("Okuma")) + toNumber(prop("2 L su"))) / 3 * 100), "%")',
            en: 'concat(round((toNumber(prop("Exercise")) + toNumber(prop("Reading")) + toNumber(prop("2 L water"))) / 3 * 100), "%")',
          },
        },
      ],
      views: [
        { id: "v_table", name: { tr: "Tablo", en: "Table" }, type: "table", sorts: [{ prop: "date", dir: "desc" }] },
        { id: "v_calendar", name: { tr: "Takvim", en: "Calendar" }, type: "calendar", dateProp: "date" },
      ],
      rows: [
        { title: { tr: "Bugün", en: "Today" }, props: { date: day(0), exercise: true } },
        { title: { tr: "Dün", en: "Yesterday" }, props: { date: day(-1), exercise: true, reading: true, water: true } },
      ],
    },
  },
  {
    key: "crm",
    icon: "🤝",
    title: { tr: "Kişiler (CRM)", en: "Contacts (CRM)" },
    description: { tr: "Kişi ve müşteri takibi: şirket, iletişim, durum, son görüşme.", en: "Track people and clients: company, contact, status, last contact." },
    database: {
      properties: [
        { id: "company", name: { tr: "Şirket", en: "Company" }, type: "text" },
        { id: "email", name: { tr: "E-posta", en: "Email" }, type: "email" },
        { id: "phone", name: { tr: "Telefon", en: "Phone" }, type: "phone" },
        {
          id: "stage",
          name: { tr: "Aşama", en: "Stage" },
          type: "status",
          options: [opt("lead", "Aday", "Lead", "gray"), opt("talking", "Görüşülüyor", "In talks", "blue"), opt("client", "Müşteri", "Client", "green")],
        },
        { id: "last", name: { tr: "Son görüşme", en: "Last contact" }, type: "date" },
        { id: "days", name: { tr: "Geçen gün", en: "Days since" }, type: "formula", expression: { tr: 'dateBetween(today(), prop("Son görüşme"), "days")', en: 'dateBetween(today(), prop("Last contact"), "days")' } },
      ],
      views: [
        { id: "v_table", name: { tr: "Tablo", en: "Table" }, type: "table" },
        { id: "v_board", name: { tr: "Aşamalar", en: "Pipeline" }, type: "board", groupBy: "stage" },
      ],
      rows: [{ title: { tr: "Örnek Kişi", en: "Sample Contact" }, props: { company: "ACME", stage: "talking", last: day(-5) } }],
    },
  },
  {
    key: "daily",
    icon: "📔",
    title: { tr: "Günlük", en: "Daily journal" },
    description: { tr: "Günün odağı, yapılacaklar, notlar ve şükran listesi.", en: "Daily focus, to-dos, notes and gratitude." },
    body: {
      tr: "## Bugünün odağı\n\n\n\n## Yapılacaklar\n\n- [ ] \n\n## Notlar\n\n\n\n## Şükran\n\n- ",
      en: "## Today's focus\n\n\n\n## To-dos\n\n- [ ] \n\n## Notes\n\n\n\n## Grateful for\n\n- ",
    },
  },
  {
    key: "weekly",
    icon: "🗂️",
    title: { tr: "Haftalık plan", en: "Weekly plan" },
    description: { tr: "Haftanın hedefleri ve gün gün görevler.", en: "Weekly goals and tasks day by day." },
    body: {
      tr: "## Haftanın hedefleri\n\n1. \n\n" + ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Hafta sonu"].map((d) => `### ${d}\n\n- [ ] `).join("\n\n") + "\n\n## Değerlendirme\n\n",
      en: "## Goals for the week\n\n1. \n\n" + ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Weekend"].map((d) => `### ${d}\n\n- [ ] `).join("\n\n") + "\n\n## Review\n\n",
    },
  },
];

async function createDatabaseRows(dbId: string, spec: DbSpec, lang: Lang) {
  for (const r of spec.rows) {
    await api.create(r.title[lang], dbId, "", { props: r.props, ...(r.icon ? { icon: r.icon } : {}) });
  }
}

const schema = (spec: DbSpec, lang: Lang) => localize({ properties: spec.properties, views: spec.views }, lang) as Record<string, unknown>;

/** Hazır şablondan sayfa oluşturur; oluşturulan kök Node'u döndürür. */
export async function instantiateBuiltin(tpl: BuiltinTemplate, parentNodeId: ParentTarget, title?: string): Promise<NodeMeta> {
  const lang = getLang();
  const body = (tpl.body?.[lang] ?? "").replace("{today}", todayIso());
  const page = await api.create(title || tpl.title[lang], parentNodeId, body.replace("{database}", ""), {
    icon: tpl.icon,
    ...(tpl.cover ? { cover: tpl.cover } : {}),
    ...(tpl.database ? { database: schema(tpl.database, lang) } : {}),
  });
  if (tpl.database) await createDatabaseRows(page.id, tpl.database, lang);
  if (tpl.childDatabase) {
    const c = tpl.childDatabase;
    const db = await api.create(c.title[lang], page.id, "", { ...(c.icon ? { icon: c.icon } : {}), database: schema(c.spec, lang) });
    await createDatabaseRows(db.id, c.spec, lang);
    // Sayfaya gömülü veritabanı: bağlantı, veritabanının güncel (klasör notu) yoluna göre göreli yazılır.
    const fresh = await api.read(db.id);
    const pageNow = await api.read(page.id);
    const rel = relative(dirname(pageNow.path), fresh.path);
    await api.update(page.id, { body: body.replace("{database}", `@[database](${rel.split("/").map(encodeURIComponent).join("/")})`) });
  }
  return page;
}

