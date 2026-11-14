// Tabula resimli şekilleri: Tabler Icons (MIT lisansı, https://tabler.io/icons). Binlerce simge, kullanıcı şekil
// kütüphanesini açtığında ya da tahtada simge olduğunda ayrı bir parça olarak yüklenir; uygulama açılışı yavaşlamaz.
// Marka logoları alınmaz. Öğe kimliği: `icon:<ad>` (çizgi) ya da `icon:<ad>:filled` (dolu).

import { useEffect, useState } from "react";

export type IconNode = [string, Record<string, string>];

interface IconData {
  outline: Record<string, IconNode[]>;
  filled: Record<string, IconNode[]>;
  meta: Record<string, { category?: string; tags?: (string | number)[] }>;
}

let data: IconData | null = null;
let loading: Promise<IconData> | null = null;
const listeners = new Set<() => void>();

export function loadIcons(): Promise<IconData> {
  loading ??= Promise.all([
    import("tabler-icons-data/tabler-nodes-outline.json"),
    import("tabler-icons-data/tabler-nodes-filled.json"),
    import("tabler-icons-data/icons.json"),
  ]).then(([o, f, m]) => {
    data = { outline: o.default as IconData["outline"], filled: f.default as IconData["filled"], meta: m.default as IconData["meta"] };
    listeners.forEach((l) => l());
    return data;
  });
  return loading;
}

/** Simge verisi yüklendi mi; `need` doğruysa yüklemeyi başlatır. */
export function useIconData(need: boolean): IconData | null {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    if (need && !data) void loadIcons();
    return () => void listeners.delete(l);
  }, [need]);
  return data;
}

export const isIconShape = (id: string | undefined) => !!id && id.startsWith("icon:");

export function iconNodes(id: string): IconNode[] | null {
  if (!data) return null;
  const [, name, variant] = id.split(":");
  return (variant === "filled" ? data.filled[name] : data.outline[name]) ?? null;
}

export const iconFilled = (id: string) => id.endsWith(":filled");

/** Freeform benzeri gruplar; her biri Tabler kategorilerini toplar. */
export const ICON_GROUPS: { id: string; name: { tr: string; en: string }; cats: string[] }[] = [
  { id: "people", name: { tr: "İnsanlar ve duygular", en: "People and moods" }, cats: ["Gender", "Gestures", "Mood"] },
  { id: "animals", name: { tr: "Hayvanlar ve doğa", en: "Animals and nature" }, cats: ["Animals", "Nature", "Weather", "Zodiac"] },
  { id: "food", name: { tr: "Yiyecek ve içecek", en: "Food and drink" }, cats: ["Food"] },
  { id: "places", name: { tr: "Yerler ve haritalar", en: "Places and maps" }, cats: ["Buildings", "Map"] },
  { id: "transport", name: { tr: "Ulaşım", en: "Transportation" }, cats: ["Vehicles"] },
  { id: "objects", name: { tr: "Nesneler", en: "Objects" }, cats: ["Devices", "E-commerce", "Laundry", "Photography", "Media"] },
  { id: "work", name: { tr: "İş ve belgeler", en: "Work and documents" }, cats: ["Document", "Communication", "Charts", "Currencies"] },
  { id: "science", name: { tr: "Bilim ve sağlık", en: "Science and health" }, cats: ["Health", "Math", "Electrical", "Logic"] },
  { id: "tech", name: { tr: "Teknoloji", en: "Technology" }, cats: ["Computers", "Database", "Development", "Version control", "Extensions"] },
  { id: "arts", name: { tr: "Sanat ve tasarım", en: "Arts and design" }, cats: ["Design", "Text"] },
  { id: "activities", name: { tr: "Spor ve oyun", en: "Sports and games" }, cats: ["Sport", "Games"] },
  { id: "symbols", name: { tr: "Semboller ve işaretler", en: "Symbols and signs" }, cats: ["Symbols", "Badges", "Shapes", "Arrows", "Letters", "Numbers"] },
  { id: "system", name: { tr: "Arayüz", en: "Interface" }, cats: ["System", ""] },
];

const EXCLUDED = new Set(["Brand"]);

/** Gruptaki simge adları. */
export function iconsInGroup(d: IconData, group: string): string[] {
  const g = ICON_GROUPS.find((x) => x.id === group);
  if (!g) return [];
  return Object.keys(d.outline).filter((n) => g.cats.includes(d.meta[n]?.category ?? "") && !EXCLUDED.has(d.meta[n]?.category ?? ""));
}

/** Türkçe aramalar için sık kullanılan sözcüklerin İngilizce karşılıkları (simge etiketleri İngilizcedir). */
const TR: Record<string, string> = {
  kedi: "cat", köpek: "dog", kuş: "bird", balık: "fish", at: "horse", inek: "cow", arı: "bee", böcek: "bug", kelebek: "butterfly", ağaç: "tree", çiçek: "flower", yaprak: "leaf",
  güneş: "sun", ay: "moon", yıldız: "star", bulut: "cloud", yağmur: "rain", kar: "snow", ateş: "flame", su: "droplet", dağ: "mountain", deniz: "sea",
  araba: "car", otobüs: "bus", tren: "train", uçak: "plane", gemi: "ship", tekne: "boat", bisiklet: "bike", motosiklet: "motorbike", kamyon: "truck", roket: "rocket",
  ev: "home", bina: "building", okul: "school", hastane: "hospital", banka: "building-bank", mağaza: "building-store", kale: "building-castle", harita: "map", konum: "map-pin",
  yemek: "tools-kitchen", pizza: "pizza", kahve: "coffee", çay: "cup", elma: "apple", ekmek: "bread", pasta: "cake", dondurma: "ice-cream", içki: "glass",
  insan: "user", kişi: "user", kadın: "woman", erkek: "man", bebek: "baby", el: "hand", göz: "eye", kalp: "heart", gülen: "mood-smile", üzgün: "mood-sad",
  telefon: "phone", bilgisayar: "device-desktop", dizüstü: "device-laptop", kamera: "camera", müzik: "music", kulaklık: "headphones", saat: "clock", takvim: "calendar",
  kitap: "book", belge: "file", klasör: "folder", posta: "mail", mesaj: "message", grafik: "chart", para: "currency", sepet: "basket", hediye: "gift", anahtar: "key", kilit: "lock",
  sağlık: "heartbeat", ilaç: "pill", doktor: "stethoscope", bilim: "flask", atom: "atom", dna: "dna", matematik: "math", oyun: "device-gamepad", top: "ball", futbol: "ball-football",
  ok: "arrow", onay: "check", çarpı: "x", uyarı: "alert", bilgi: "info", soru: "help", ayar: "settings", arama: "search", fikir: "bulb", ampul: "bulb", kalem: "pencil", fırça: "brush", palet: "palette",
};

export function searchIcons(d: IconData, query: string, limit = 240): string[] {
  const raw = query.trim().toLocaleLowerCase("tr");
  if (!raw) return [];
  const q = TR[raw] ?? raw;
  const out: string[] = [];
  for (const n of Object.keys(d.outline)) {
    const m = d.meta[n];
    if (EXCLUDED.has(m?.category ?? "")) continue;
    if (n.includes(q) || m?.tags?.some((t) => String(t).toLowerCase().includes(q))) out.push(n);
    if (out.length >= limit) break;
  }
  return out;
}

export const iconTitle = (id: string) =>
  id
    .split(":")[1]
    .split("-")
    .map((w, i) => (i ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
