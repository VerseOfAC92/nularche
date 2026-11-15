// Tabula şekil kütüphanesi: temel şekiller, oklar, akış şeması, süreç (BPMN), UML, ağ/BT, konuşma balonları ve
// semboller. Her şekil, verilen genişlik ve yükseklikte çizilen bir SVG yolu (`path`) üretir; `detail` yalnızca çizgi
// olarak çizilen iç ayrıntılardır (ör. belge kıvrımı, sınıf bölmeleri). `text`, şeklin içindeki yazı alanıdır (0–1 oranları).

export type ShapeCategory = "basic" | "arrows" | "flowchart" | "process" | "uml" | "network" | "callouts" | "symbols";

export interface ShapeDef {
  id: string;
  cat: ShapeCategory;
  name: { tr: string; en: string };
  path: (w: number, h: number) => string;
  detail?: (w: number, h: number) => string;
  /** Yazı alanı [sol, üst, sağ, alt] oranları. */
  text?: [number, number, number, number];
  /** Varsayılan boyut. */
  size?: [number, number];
  /** Ayrıntı yolu da doldurulsun (ör. dolu daire, simge). */
  solidDetail?: boolean;
}

export const CATEGORIES: { id: ShapeCategory; name: { tr: string; en: string } }[] = [
  { id: "basic", name: { tr: "Temel", en: "Basic" } },
  { id: "arrows", name: { tr: "Oklar", en: "Arrows" } },
  { id: "flowchart", name: { tr: "Akış şeması", en: "Flowchart" } },
  { id: "process", name: { tr: "Süreç (BPMN)", en: "Process (BPMN)" } },
  { id: "uml", name: { tr: "UML ve yazılım", en: "UML and software" } },
  { id: "network", name: { tr: "Ağ ve BT", en: "Network and IT" } },
  { id: "callouts", name: { tr: "Balonlar", en: "Callouts" } },
  { id: "symbols", name: { tr: "Semboller", en: "Symbols" } },
];

const f = (n: number) => Math.round(n * 100) / 100;
/** Oransal noktalardan kapalı çokgen. */
const poly =
  (...pts: [number, number][]) =>
  (w: number, h: number) =>
    `M${pts.map(([x, y]) => `${f(x * w)} ${f(y * h)}`).join(" L")} Z`;
const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
  `M${f(cx - rx)} ${f(cy)} A${f(rx)} ${f(ry)} 0 1 0 ${f(cx + rx)} ${f(cy)} A${f(rx)} ${f(ry)} 0 1 0 ${f(cx - rx)} ${f(cy)} Z`;
const rect = (x: number, y: number, w: number, h: number) => `M${f(x)} ${f(y)} H${f(x + w)} V${f(y + h)} H${f(x)} Z`;
const rrect = (x: number, y: number, w: number, h: number, r: number) => {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${f(x + r)} ${f(y)} H${f(x + w - r)} A${f(r)} ${f(r)} 0 0 1 ${f(x + w)} ${f(y + r)} V${f(y + h - r)} A${f(r)} ${f(r)} 0 0 1 ${f(x + w - r)} ${f(y + h)} H${f(x + r)} A${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(y + h - r)} V${f(y + r)} A${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)} Z`;
};
const line = (x1: number, y1: number, x2: number, y2: number) => `M${f(x1)} ${f(y1)} L${f(x2)} ${f(y2)}`;

/** Düzgün çokgen ya da yıldız (iç yarıçap oranı `inner` verilirse). */
const regular =
  (n: number, inner?: number, rot = -90) =>
  (w: number, h: number) => {
    const pts: string[] = [];
    const k = inner ? n * 2 : n;
    for (let i = 0; i < k; i++) {
      const a = ((rot + (360 / k) * i) * Math.PI) / 180;
      const r = inner && i % 2 ? inner : 1;
      pts.push(`${f(w / 2 + (Math.cos(a) * r * w) / 2)} ${f(h / 2 + (Math.sin(a) * r * h) / 2)}`);
    }
    return `M${pts.join(" L")} Z`;
  };

const cloudPath = (w: number, h: number) =>
  `M${f(w * 0.25)} ${f(h * 0.85)} C${f(w * 0.02)} ${f(h * 0.85)} ${f(w * 0.02)} ${f(h * 0.5)} ${f(w * 0.2)} ${f(h * 0.48)} C${f(w * 0.16)} ${f(h * 0.2)} ${f(w * 0.45)} ${f(h * 0.08)} ${f(w * 0.55)} ${f(h * 0.28)} C${f(w * 0.68)} ${f(h * 0.08)} ${f(w * 0.92)} ${f(h * 0.2)} ${f(w * 0.85)} ${f(h * 0.45)} C${f(w * 1.02)} ${f(h * 0.5)} ${f(w * 1.0)} ${f(h * 0.88)} ${f(w * 0.76)} ${f(h * 0.85)} Z`;

const cylinder = (w: number, h: number) => {
  const ry = Math.min(h * 0.12, w * 0.25);
  return `M0 ${f(ry)} A${f(w / 2)} ${f(ry)} 0 0 1 ${f(w)} ${f(ry)} V${f(h - ry)} A${f(w / 2)} ${f(ry)} 0 0 1 0 ${f(h - ry)} Z`;
};
const cylinderTop = (w: number, h: number) => {
  const ry = Math.min(h * 0.12, w * 0.25);
  return `M0 ${f(ry)} A${f(w / 2)} ${f(ry)} 0 0 0 ${f(w)} ${f(ry)}`;
};
const hCylinder = (w: number, h: number) => {
  const rx = Math.min(w * 0.12, h * 0.25);
  return `M${f(rx)} 0 H${f(w - rx)} A${f(rx)} ${f(h / 2)} 0 0 1 ${f(w - rx)} ${f(h)} H${f(rx)} A${f(rx)} ${f(h / 2)} 0 0 1 ${f(rx)} 0 Z`;
};
const docPath = (w: number, h: number) => `M0 0 H${f(w)} V${f(h * 0.85)} C${f(w * 0.75)} ${f(h * 0.7)} ${f(w * 0.5)} ${f(h * 1.05)} ${f(w * 0.25)} ${f(h * 0.92)} C${f(w * 0.12)} ${f(h * 0.86)} ${f(w * 0.05)} ${f(h * 0.85)} 0 ${f(h * 0.88)} Z`;
const dogEar = (w: number, h: number) => {
  const c = Math.min(w, h) * 0.22;
  return `M0 0 H${f(w - c)} L${f(w)} ${f(c)} V${f(h)} H0 Z`;
};
const dogEarFold = (w: number, h: number) => {
  const c = Math.min(w, h) * 0.22;
  return `M${f(w - c)} 0 V${f(c)} H${f(w)}`;
};

const S = (tr: string, en: string) => ({ tr, en });

export const SHAPES: ShapeDef[] = [
  // --- Temel ---
  { id: "rect", cat: "basic", name: S("Dikdörtgen", "Rectangle"), path: (w, h) => rect(0, 0, w, h) },
  { id: "rounded", cat: "basic", name: S("Yuvarlak köşeli", "Rounded rectangle"), path: (w, h) => rrect(0, 0, w, h, Math.min(w, h) * 0.18) },
  { id: "square", cat: "basic", name: S("Kare", "Square"), path: (w, h) => rect(0, 0, w, h), size: [120, 120] },
  { id: "ellipse", cat: "basic", name: S("Elips", "Ellipse"), path: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2), text: [0.15, 0.15, 0.85, 0.85] },
  { id: "circle", cat: "basic", name: S("Daire", "Circle"), path: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2), size: [120, 120], text: [0.15, 0.15, 0.85, 0.85] },
  { id: "triangle", cat: "basic", name: S("Üçgen", "Triangle"), path: poly([0.5, 0], [1, 1], [0, 1]), text: [0.25, 0.45, 0.75, 0.95] },
  { id: "right-triangle", cat: "basic", name: S("Dik üçgen", "Right triangle"), path: poly([0, 0], [1, 1], [0, 1]), text: [0.05, 0.5, 0.6, 0.95] },
  { id: "diamond", cat: "basic", name: S("Eşkenar dörtgen", "Diamond"), path: poly([0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]), text: [0.25, 0.25, 0.75, 0.75] },
  { id: "parallelogram", cat: "basic", name: S("Paralelkenar", "Parallelogram"), path: poly([0.2, 0], [1, 0], [0.8, 1], [0, 1]), text: [0.2, 0.05, 0.8, 0.95] },
  { id: "trapezoid", cat: "basic", name: S("Yamuk", "Trapezoid"), path: poly([0.2, 0], [0.8, 0], [1, 1], [0, 1]), text: [0.2, 0.05, 0.8, 0.95] },
  { id: "pentagon", cat: "basic", name: S("Beşgen", "Pentagon"), path: regular(5), size: [130, 125], text: [0.2, 0.25, 0.8, 0.85] },
  { id: "hexagon", cat: "basic", name: S("Altıgen", "Hexagon"), path: poly([0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]), text: [0.2, 0.1, 0.8, 0.9] },
  { id: "heptagon", cat: "basic", name: S("Yedigen", "Heptagon"), path: regular(7), size: [130, 130], text: [0.2, 0.2, 0.8, 0.85] },
  { id: "octagon", cat: "basic", name: S("Sekizgen", "Octagon"), path: poly([0.3, 0], [0.7, 0], [1, 0.3], [1, 0.7], [0.7, 1], [0.3, 1], [0, 0.7], [0, 0.3]), size: [130, 130], text: [0.15, 0.15, 0.85, 0.85] },
  { id: "star4", cat: "basic", name: S("Dört köşeli yıldız", "4-point star"), path: regular(4, 0.4), size: [130, 130], text: [0.35, 0.35, 0.65, 0.65] },
  { id: "star5", cat: "basic", name: S("Yıldız", "Star"), path: regular(5, 0.45), size: [130, 130], text: [0.32, 0.38, 0.68, 0.7] },
  { id: "star6", cat: "basic", name: S("Altı köşeli yıldız", "6-point star"), path: regular(6, 0.55), size: [130, 130], text: [0.3, 0.3, 0.7, 0.7] },
  { id: "star8", cat: "basic", name: S("Patlama", "Burst"), path: regular(12, 0.7), size: [140, 140], text: [0.25, 0.25, 0.75, 0.75] },
  { id: "plus", cat: "basic", name: S("Artı", "Cross"), path: poly([0.33, 0], [0.67, 0], [0.67, 0.33], [1, 0.33], [1, 0.67], [0.67, 0.67], [0.67, 1], [0.33, 1], [0.33, 0.67], [0, 0.67], [0, 0.33], [0.33, 0.33]), size: [120, 120], text: [0.33, 0.33, 0.67, 0.67] },
  {
    id: "heart",
    cat: "basic",
    name: S("Kalp", "Heart"),
    size: [130, 120],
    text: [0.2, 0.2, 0.8, 0.65],
    path: (w, h) => `M${f(w / 2)} ${f(h)} C${f(w * 0.1)} ${f(h * 0.7)} 0 ${f(h * 0.45)} 0 ${f(h * 0.28)} C0 ${f(h * 0.08)} ${f(w * 0.18)} 0 ${f(w * 0.28)} 0 C${f(w * 0.4)} 0 ${f(w * 0.48)} ${f(h * 0.08)} ${f(w / 2)} ${f(h * 0.2)} C${f(w * 0.52)} ${f(h * 0.08)} ${f(w * 0.6)} 0 ${f(w * 0.72)} 0 C${f(w * 0.82)} 0 ${f(w)} ${f(h * 0.08)} ${f(w)} ${f(h * 0.28)} C${f(w)} ${f(h * 0.45)} ${f(w * 0.9)} ${f(h * 0.7)} ${f(w / 2)} ${f(h)} Z`,
  },
  { id: "cloud", cat: "basic", name: S("Bulut", "Cloud"), path: cloudPath, size: [170, 110], text: [0.2, 0.35, 0.8, 0.8] },
  { id: "moon", cat: "basic", name: S("Hilal", "Moon"), size: [100, 130], path: (w, h) => `M${f(w * 0.8)} 0 A${f(w * 0.8)} ${f(h / 2)} 0 1 0 ${f(w * 0.8)} ${f(h)} A${f(w * 0.55)} ${f(h * 0.42)} 0 1 1 ${f(w * 0.8)} 0 Z`, text: [0.1, 0.3, 0.45, 0.7] },
  { id: "bolt", cat: "basic", name: S("Şimşek", "Lightning"), size: [100, 140], path: poly([0.55, 0], [0.1, 0.55], [0.45, 0.55], [0.35, 1], [0.9, 0.4], [0.55, 0.4], [0.7, 0]), text: [0.3, 0.4, 0.7, 0.6] },
  { id: "donut", cat: "basic", name: S("Halka", "Ring"), size: [120, 120], path: (w, h) => `${ellipse(w / 2, h / 2, w / 2, h / 2)} ${ellipse(w / 2, h / 2, w * 0.28, h * 0.28)}`, text: [0.3, 0.3, 0.7, 0.7] },
  { id: "teardrop", cat: "basic", name: S("Damla", "Teardrop"), size: [110, 140], path: (w, h) => `M${f(w / 2)} 0 C${f(w * 0.75)} ${f(h * 0.35)} ${f(w)} ${f(h * 0.5)} ${f(w)} ${f(h * 0.68)} A${f(w / 2)} ${f(h * 0.32)} 0 1 1 0 ${f(h * 0.68)} C0 ${f(h * 0.5)} ${f(w * 0.25)} ${f(h * 0.35)} ${f(w / 2)} 0 Z`, text: [0.15, 0.45, 0.85, 0.9] },
  { id: "cylinder", cat: "basic", name: S("Silindir", "Cylinder"), size: [110, 140], path: cylinder, detail: cylinderTop, text: [0.05, 0.25, 0.95, 0.9] },
  {
    id: "cube",
    cat: "basic",
    name: S("Küp", "Cube"),
    size: [130, 130],
    path: poly([0.25, 0], [1, 0], [1, 0.75], [0.75, 1], [0, 1], [0, 0.25]),
    detail: (w, h) => `M0 ${f(h * 0.25)} H${f(w * 0.75)} V${f(h)} M${f(w * 0.75)} ${f(h * 0.25)} L${f(w)} 0`,
    text: [0.05, 0.3, 0.7, 0.95],
  },
  { id: "frame", cat: "basic", name: S("Çerçeve", "Frame"), path: (w, h) => `${rect(0, 0, w, h)} ${rect(w * 0.1, h * 0.1, w * 0.8, h * 0.8)}`, text: [0.12, 0.12, 0.88, 0.88] },
  { id: "plaque", cat: "basic", name: S("Plaka", "Plaque"), path: (w, h) => { const r = Math.min(w, h) * 0.18; return `M${f(r)} 0 H${f(w - r)} A${f(r)} ${f(r)} 0 0 0 ${f(w)} ${f(r)} V${f(h - r)} A${f(r)} ${f(r)} 0 0 0 ${f(w - r)} ${f(h)} H${f(r)} A${f(r)} ${f(r)} 0 0 0 0 ${f(h - r)} V${f(r)} A${f(r)} ${f(r)} 0 0 0 ${f(r)} 0 Z`; } },
  { id: "half-circle", cat: "basic", name: S("Yarım daire", "Half circle"), size: [140, 70], path: (w, h) => `M0 ${f(h)} A${f(w / 2)} ${f(h)} 0 0 1 ${f(w)} ${f(h)} Z`, text: [0.2, 0.35, 0.8, 0.95] },
  { id: "pie", cat: "basic", name: S("Dilim", "Pie"), size: [120, 120], path: (w, h) => `M${f(w / 2)} ${f(h / 2)} L${f(w / 2)} 0 A${f(w / 2)} ${f(h / 2)} 0 1 1 0 ${f(h / 2)} Z`, text: [0.25, 0.5, 0.75, 0.85] },
  { id: "chord", cat: "basic", name: S("Kesit", "Chord"), size: [120, 120], path: (w, h) => `M${f(w * 0.85)} ${f(h * 0.15)} A${f(w / 2)} ${f(h / 2)} 0 1 1 ${f(w * 0.15)} ${f(h * 0.85)} Z`, text: [0.35, 0.35, 0.8, 0.8] },

  // --- Oklar ---
  { id: "arrow-right", cat: "arrows", name: S("Sağ ok", "Right arrow"), size: [160, 90], path: poly([0, 0.3], [0.65, 0.3], [0.65, 0], [1, 0.5], [0.65, 1], [0.65, 0.7], [0, 0.7]), text: [0.05, 0.3, 0.7, 0.7] },
  { id: "arrow-left", cat: "arrows", name: S("Sol ok", "Left arrow"), size: [160, 90], path: poly([1, 0.3], [0.35, 0.3], [0.35, 0], [0, 0.5], [0.35, 1], [0.35, 0.7], [1, 0.7]), text: [0.3, 0.3, 0.95, 0.7] },
  { id: "arrow-up", cat: "arrows", name: S("Yukarı ok", "Up arrow"), size: [90, 160], path: poly([0.3, 1], [0.3, 0.35], [0, 0.35], [0.5, 0], [1, 0.35], [0.7, 0.35], [0.7, 1]), text: [0.3, 0.35, 0.7, 0.95] },
  { id: "arrow-down", cat: "arrows", name: S("Aşağı ok", "Down arrow"), size: [90, 160], path: poly([0.3, 0], [0.3, 0.65], [0, 0.65], [0.5, 1], [1, 0.65], [0.7, 0.65], [0.7, 0]), text: [0.3, 0.05, 0.7, 0.65] },
  { id: "arrow-lr", cat: "arrows", name: S("Çift yönlü ok", "Left-right arrow"), size: [180, 90], path: poly([0, 0.5], [0.25, 0], [0.25, 0.3], [0.75, 0.3], [0.75, 0], [1, 0.5], [0.75, 1], [0.75, 0.7], [0.25, 0.7], [0.25, 1]), text: [0.25, 0.3, 0.75, 0.7] },
  { id: "arrow-ud", cat: "arrows", name: S("Yukarı-aşağı ok", "Up-down arrow"), size: [90, 180], path: poly([0.5, 0], [1, 0.25], [0.7, 0.25], [0.7, 0.75], [1, 0.75], [0.5, 1], [0, 0.75], [0.3, 0.75], [0.3, 0.25], [0, 0.25]), text: [0.3, 0.25, 0.7, 0.75] },
  { id: "arrow-quad", cat: "arrows", name: S("Dört yönlü ok", "Quad arrow"), size: [150, 150], path: poly([0.5, 0], [0.65, 0.15], [0.57, 0.15], [0.57, 0.43], [0.85, 0.43], [0.85, 0.35], [1, 0.5], [0.85, 0.65], [0.85, 0.57], [0.57, 0.57], [0.57, 0.85], [0.65, 0.85], [0.5, 1], [0.35, 0.85], [0.43, 0.85], [0.43, 0.57], [0.15, 0.57], [0.15, 0.65], [0, 0.5], [0.15, 0.35], [0.15, 0.43], [0.43, 0.43], [0.43, 0.15], [0.35, 0.15]) },
  { id: "chevron", cat: "arrows", name: S("Şerit ok", "Chevron"), size: [150, 80], path: poly([0, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0, 1], [0.25, 0.5]), text: [0.25, 0.1, 0.78, 0.9] },
  { id: "pentagon-arrow", cat: "arrows", name: S("Etiket ok", "Pentagon arrow"), size: [160, 80], path: poly([0, 0], [0.78, 0], [1, 0.5], [0.78, 1], [0, 1]), text: [0.05, 0.1, 0.8, 0.9] },
  { id: "notched-arrow", cat: "arrows", name: S("Çentikli ok", "Notched arrow"), size: [160, 90], path: poly([0, 0.3], [0.65, 0.3], [0.65, 0], [1, 0.5], [0.65, 1], [0.65, 0.7], [0, 0.7], [0.1, 0.5]), text: [0.12, 0.3, 0.7, 0.7] },
  { id: "striped-arrow", cat: "arrows", name: S("Çizgili ok", "Striped arrow"), size: [160, 90], path: (w, h) => `${rect(0, h * 0.3, w * 0.04, h * 0.4)} ${rect(w * 0.07, h * 0.3, w * 0.04, h * 0.4)} ${poly([0.14, 0.3], [0.65, 0.3], [0.65, 0], [1, 0.5], [0.65, 1], [0.65, 0.7], [0.14, 0.7])(w, h)}`, text: [0.15, 0.3, 0.7, 0.7] },
  { id: "u-turn", cat: "arrows", name: S("U dönüşü", "U-turn arrow"), size: [140, 140], path: (w, h) => `M0 ${f(h)} V${f(h * 0.4)} A${f(w * 0.35)} ${f(h * 0.4)} 0 0 1 ${f(w * 0.7)} ${f(h * 0.4)} V${f(h * 0.6)} H${f(w)} L${f(w * 0.6)} ${f(h)} L${f(w * 0.2)} ${f(h * 0.6)} H${f(w * 0.5)} V${f(h * 0.4)} A${f(w * 0.15)} ${f(h * 0.2)} 0 0 0 ${f(w * 0.2)} ${f(h * 0.4)} V${f(h)} Z` },
  { id: "circular-arrow", cat: "arrows", name: S("Dairesel ok", "Circular arrow"), size: [140, 140], path: (w, h) => `M${f(w * 0.15)} ${f(h * 0.5)} A${f(w * 0.35)} ${f(h * 0.35)} 0 1 1 ${f(w * 0.5)} ${f(h * 0.85)} V${f(h)} L${f(w * 0.3)} ${f(h * 0.78)} L${f(w * 0.5)} ${f(h * 0.56)} V${f(h * 0.7)} A${f(w * 0.2)} ${f(h * 0.2)} 0 1 0 ${f(w * 0.3)} ${f(h * 0.5)} Z` },
  { id: "callout-arrow", cat: "arrows", name: S("Ok kutusu", "Arrow callout"), size: [170, 100], path: poly([0, 0], [0.6, 0], [0.6, 0.3], [0.8, 0.3], [0.8, 0.15], [1, 0.5], [0.8, 0.85], [0.8, 0.7], [0.6, 0.7], [0.6, 1], [0, 1]), text: [0.05, 0.1, 0.58, 0.9] },

  // --- Akış şeması ---
  { id: "fc-process", cat: "flowchart", name: S("İşlem", "Process"), path: (w, h) => rect(0, 0, w, h) },
  { id: "fc-alt-process", cat: "flowchart", name: S("Alternatif işlem", "Alternate process"), path: (w, h) => rrect(0, 0, w, h, Math.min(w, h) * 0.2) },
  { id: "fc-decision", cat: "flowchart", name: S("Karar", "Decision"), size: [150, 110], path: poly([0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]), text: [0.22, 0.22, 0.78, 0.78] },
  { id: "fc-data", cat: "flowchart", name: S("Veri (giriş/çıkış)", "Data (I/O)"), path: poly([0.18, 0], [1, 0], [0.82, 1], [0, 1]), text: [0.18, 0.05, 0.82, 0.95] },
  { id: "fc-predefined", cat: "flowchart", name: S("Önceden tanımlı işlem", "Predefined process"), path: (w, h) => rect(0, 0, w, h), detail: (w, h) => `${line(w * 0.1, 0, w * 0.1, h)} ${line(w * 0.9, 0, w * 0.9, h)}`, text: [0.12, 0.05, 0.88, 0.95] },
  { id: "fc-internal", cat: "flowchart", name: S("Dahili depolama", "Internal storage"), path: (w, h) => rect(0, 0, w, h), detail: (w, h) => `${line(w * 0.15, 0, w * 0.15, h)} ${line(0, h * 0.2, w, h * 0.2)}`, text: [0.17, 0.22, 0.95, 0.95] },
  { id: "fc-document", cat: "flowchart", name: S("Belge", "Document"), path: docPath, text: [0.05, 0.05, 0.95, 0.78] },
  { id: "fc-multidoc", cat: "flowchart", name: S("Çoklu belge", "Multiple documents"), path: (w, h) => `${docPath(w * 0.88, h * 0.88).replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_m, x, y) => `${f(Number(x))} ${f(Number(y) + h * 0.12)}`)}`, detail: (w, h) => `M${f(w * 0.06)} ${f(h * 0.12)} V${f(h * 0.06)} H${f(w * 0.94)} V${f(h * 0.8)} H${f(w * 0.88)} M${f(w * 0.12)} ${f(h * 0.06)} V0 H${f(w)} V${f(h * 0.74)} H${f(w * 0.94)}`, text: [0.05, 0.18, 0.85, 0.85] },
  { id: "fc-terminator", cat: "flowchart", name: S("Başla/Bitir", "Terminator"), size: [150, 70], path: (w, h) => rrect(0, 0, w, h, h / 2) },
  { id: "fc-preparation", cat: "flowchart", name: S("Hazırlık", "Preparation"), path: poly([0.15, 0], [0.85, 0], [1, 0.5], [0.85, 1], [0.15, 1], [0, 0.5]), text: [0.15, 0.05, 0.85, 0.95] },
  { id: "fc-manual-input", cat: "flowchart", name: S("El ile giriş", "Manual input"), path: poly([0, 0.3], [1, 0], [1, 1], [0, 1]), text: [0.05, 0.3, 0.95, 0.95] },
  { id: "fc-manual-op", cat: "flowchart", name: S("El ile işlem", "Manual operation"), path: poly([0, 0], [1, 0], [0.8, 1], [0.2, 1]), text: [0.2, 0.05, 0.8, 0.95] },
  { id: "fc-connector", cat: "flowchart", name: S("Bağlayıcı", "Connector"), size: [60, 60], path: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2), text: [0.1, 0.1, 0.9, 0.9] },
  { id: "fc-offpage", cat: "flowchart", name: S("Sayfa dışı bağlayıcı", "Off-page connector"), size: [80, 90], path: poly([0, 0], [1, 0], [1, 0.65], [0.5, 1], [0, 0.65]), text: [0.05, 0.05, 0.95, 0.65] },
  { id: "fc-card", cat: "flowchart", name: S("Kart", "Card"), path: poly([0.2, 0], [1, 0], [1, 1], [0, 1], [0, 0.25]) },
  { id: "fc-tape", cat: "flowchart", name: S("Delikli şerit", "Punched tape"), path: (w, h) => `M0 ${f(h * 0.1)} C${f(w * 0.25)} ${f(h * 0.25)} ${f(w * 0.25)} ${f(-h * 0.05)} ${f(w * 0.5)} ${f(h * 0.1)} C${f(w * 0.75)} ${f(h * 0.25)} ${f(w * 0.75)} ${f(-h * 0.05)} ${f(w)} ${f(h * 0.1)} V${f(h * 0.9)} C${f(w * 0.75)} ${f(h * 0.75)} ${f(w * 0.75)} ${f(h * 1.05)} ${f(w * 0.5)} ${f(h * 0.9)} C${f(w * 0.25)} ${f(h * 0.75)} ${f(w * 0.25)} ${f(h * 1.05)} 0 ${f(h * 0.9)} Z`, text: [0.05, 0.2, 0.95, 0.8] },
  { id: "fc-summing", cat: "flowchart", name: S("Toplama noktası", "Summing junction"), size: [70, 70], path: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2), detail: (w, h) => `${line(w * 0.15, h * 0.15, w * 0.85, h * 0.85)} ${line(w * 0.85, h * 0.15, w * 0.15, h * 0.85)}`, text: [0, 0, 0, 0] },
  { id: "fc-or", cat: "flowchart", name: S("Veya", "Or"), size: [70, 70], path: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2), detail: (w, h) => `${line(w / 2, 0, w / 2, h)} ${line(0, h / 2, w, h / 2)}`, text: [0, 0, 0, 0] },
  { id: "fc-collate", cat: "flowchart", name: S("Harmanla", "Collate"), size: [80, 100], path: (w, h) => `M0 0 H${f(w)} L0 ${f(h)} H${f(w)} Z`, text: [0, 0, 0, 0] },
  { id: "fc-sort", cat: "flowchart", name: S("Sırala", "Sort"), size: [80, 100], path: poly([0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]), detail: (w, h) => line(0, h / 2, w, h / 2), text: [0, 0, 0, 0] },
  { id: "fc-extract", cat: "flowchart", name: S("Ayıkla", "Extract"), size: [90, 80], path: poly([0.5, 0], [1, 1], [0, 1]), text: [0.25, 0.5, 0.75, 0.95] },
  { id: "fc-merge", cat: "flowchart", name: S("Birleştir", "Merge"), size: [90, 80], path: poly([0, 0], [1, 0], [0.5, 1]), text: [0.25, 0.05, 0.75, 0.5] },
  { id: "fc-stored", cat: "flowchart", name: S("Depolanmış veri", "Stored data"), path: (w, h) => `M${f(w * 0.15)} 0 H${f(w)} A${f(w * 0.15)} ${f(h / 2)} 0 0 0 ${f(w)} ${f(h)} H${f(w * 0.15)} A${f(w * 0.15)} ${f(h / 2)} 0 0 1 ${f(w * 0.15)} 0 Z`, text: [0.15, 0.05, 0.88, 0.95] },
  { id: "fc-delay", cat: "flowchart", name: S("Gecikme", "Delay"), path: (w, h) => `M0 0 H${f(w * 0.6)} A${f(w * 0.4)} ${f(h / 2)} 0 0 1 ${f(w * 0.6)} ${f(h)} H0 Z`, text: [0.05, 0.05, 0.8, 0.95] },
  { id: "fc-sequential", cat: "flowchart", name: S("Sıralı erişimli depo", "Sequential access storage"), size: [100, 100], path: (w, h) => `M${f(w / 2)} ${f(h)} A${f(w / 2)} ${f(h / 2)} 0 1 1 ${f(w)} ${f(h / 2)} V${f(h)} Z`, text: [0.15, 0.15, 0.85, 0.85] },
  { id: "fc-disk", cat: "flowchart", name: S("Manyetik disk (veritabanı)", "Magnetic disk (database)"), size: [110, 130], path: cylinder, detail: cylinderTop, text: [0.05, 0.25, 0.95, 0.9] },
  { id: "fc-direct", cat: "flowchart", name: S("Doğrudan erişimli depo", "Direct access storage"), size: [150, 80], path: hCylinder, detail: (w, h) => { const rx = Math.min(w * 0.12, h * 0.25); return `M${f(w - rx)} 0 A${f(rx)} ${f(h / 2)} 0 0 0 ${f(w - rx)} ${f(h)}`; }, text: [0.1, 0.05, 0.8, 0.95] },
  { id: "fc-display", cat: "flowchart", name: S("Ekran", "Display"), path: (w, h) => `M0 ${f(h / 2)} L${f(w * 0.18)} 0 H${f(w * 0.8)} A${f(w * 0.2)} ${f(h / 2)} 0 0 1 ${f(w * 0.8)} ${f(h)} H${f(w * 0.18)} Z`, text: [0.18, 0.05, 0.85, 0.95] },
  { id: "fc-loop-limit", cat: "flowchart", name: S("Döngü sınırı", "Loop limit"), path: poly([0.15, 0], [0.85, 0], [1, 0.3], [1, 1], [0, 1], [0, 0.3]), text: [0.05, 0.3, 0.95, 0.95] },
  { id: "fc-annotation", cat: "flowchart", name: S("Açıklama", "Annotation"), path: (w, h) => rect(0, 0, w, h), detail: (w, h) => `M${f(w * 0.15)} 0 H0 V${f(h)} H${f(w * 0.15)}` },

  // --- Süreç (BPMN) ---
  { id: "bpmn-start", cat: "process", name: S("Başlangıç olayı", "Start event"), size: [60, 60], path: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2), text: [0, 0, 0, 0] },
  { id: "bpmn-intermediate", cat: "process", name: S("Ara olay", "Intermediate event"), size: [60, 60], path: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2), detail: (w, h) => ellipse(w / 2, h / 2, w * 0.4, h * 0.4), text: [0, 0, 0, 0] },
  { id: "bpmn-end", cat: "process", name: S("Bitiş olayı", "End event"), size: [60, 60], path: (w, h) => `${ellipse(w / 2, h / 2, w / 2, h / 2)} ${ellipse(w / 2, h / 2, w * 0.4, h * 0.4)}`, text: [0, 0, 0, 0] },
  { id: "bpmn-task", cat: "process", name: S("Görev", "Task"), path: (w, h) => rrect(0, 0, w, h, Math.min(w, h) * 0.12) },
  { id: "bpmn-subprocess", cat: "process", name: S("Alt süreç", "Sub-process"), path: (w, h) => rrect(0, 0, w, h, Math.min(w, h) * 0.12), detail: (w, h) => `${rect(w / 2 - 8, h - 20, 16, 16)} ${line(w / 2 - 5, h - 12, w / 2 + 5, h - 12)} ${line(w / 2, h - 17, w / 2, h - 7)}`, text: [0.05, 0.05, 0.95, 0.75] },
  { id: "bpmn-gateway", cat: "process", name: S("Ayrıcalıklı geçit", "Exclusive gateway"), size: [70, 70], path: poly([0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]), detail: (w, h) => `${line(w * 0.35, h * 0.35, w * 0.65, h * 0.65)} ${line(w * 0.65, h * 0.35, w * 0.35, h * 0.65)}`, text: [0, 0, 0, 0] },
  { id: "bpmn-parallel", cat: "process", name: S("Paralel geçit", "Parallel gateway"), size: [70, 70], path: poly([0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]), detail: (w, h) => `${line(w / 2, h * 0.28, w / 2, h * 0.72)} ${line(w * 0.28, h / 2, w * 0.72, h / 2)}`, text: [0, 0, 0, 0] },
  { id: "bpmn-inclusive", cat: "process", name: S("Kapsayıcı geçit", "Inclusive gateway"), size: [70, 70], path: poly([0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]), detail: (w, h) => ellipse(w / 2, h / 2, w * 0.2, h * 0.2), text: [0, 0, 0, 0] },
  { id: "bpmn-data", cat: "process", name: S("Veri nesnesi", "Data object"), size: [80, 100], path: dogEar, detail: dogEarFold, text: [0.05, 0.3, 0.95, 0.95] },
  { id: "bpmn-store", cat: "process", name: S("Veri deposu", "Data store"), size: [100, 100], path: cylinder, detail: (w, h) => { const ry = Math.min(h * 0.12, w * 0.25); return `${cylinderTop(w, h)} M0 ${f(ry * 1.8)} A${f(w / 2)} ${f(ry)} 0 0 0 ${f(w)} ${f(ry * 1.8)}`; }, text: [0.05, 0.35, 0.95, 0.9] },
  { id: "bpmn-pool", cat: "process", name: S("Havuz / kulvar", "Pool / lane"), size: [420, 160], path: (w, h) => rect(0, 0, w, h), detail: (w, h) => line(Math.min(36, w * 0.12), 0, Math.min(36, w * 0.12), h), text: [0.1, 0.05, 0.98, 0.95] },

  // --- UML ve yazılım ---
  { id: "uml-class", cat: "uml", name: S("Sınıf", "Class"), size: [170, 150], path: (w, h) => rect(0, 0, w, h), detail: (w, h) => `${line(0, Math.min(34, h * 0.25), w, Math.min(34, h * 0.25))} ${line(0, h * 0.6, w, h * 0.6)}`, text: [0.04, 0.02, 0.96, 0.23] },
  { id: "uml-interface", cat: "uml", name: S("Arayüz", "Interface"), size: [60, 60], path: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2), text: [0, 0, 0, 0] },
  {
    id: "uml-actor",
    cat: "uml",
    name: S("Aktör", "Actor"),
    size: [60, 110],
    path: (w, h) => `${ellipse(w / 2, h * 0.12, w * 0.18, h * 0.1)} M${f(w * 0.45)} ${f(h * 0.22)} H${f(w * 0.55)} V${f(h * 0.6)} H${f(w * 0.45)} Z`,
    detail: (w, h) => `${line(w * 0.05, h * 0.36, w * 0.95, h * 0.36)} ${line(w / 2, h * 0.58, w * 0.12, h)} ${line(w / 2, h * 0.58, w * 0.88, h)} ${line(w / 2, h * 0.22, w / 2, h * 0.6)}`,
    text: [0, 0, 0, 0],
  },
  { id: "uml-component", cat: "uml", name: S("Bileşen", "Component"), path: (w, h) => rect(0, 0, w, h), detail: (w, h) => `${rect(w - 34, 8, 22, 16)} ${rect(w - 38, 11, 8, 4)} ${rect(w - 38, 17, 8, 4)}`, text: [0.05, 0.2, 0.75, 0.95] },
  { id: "uml-package", cat: "uml", name: S("Paket", "Package"), size: [170, 120], path: (w, h) => `M0 0 H${f(w * 0.4)} V${f(h * 0.18)} H${f(w)} V${f(h)} H0 Z`, detail: (w, h) => line(0, h * 0.18, w * 0.4, h * 0.18), text: [0.05, 0.22, 0.95, 0.95] },
  { id: "uml-note", cat: "uml", name: S("Not", "Note"), size: [150, 100], path: dogEar, detail: dogEarFold, text: [0.05, 0.08, 0.82, 0.95] },
  { id: "uml-state", cat: "uml", name: S("Durum", "State"), path: (w, h) => rrect(0, 0, w, h, Math.min(w, h) * 0.3) },
  { id: "uml-initial", cat: "uml", name: S("Başlangıç durumu", "Initial state"), size: [40, 40], path: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2), solidDetail: true, detail: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2), text: [0, 0, 0, 0] },
  { id: "uml-final", cat: "uml", name: S("Bitiş durumu", "Final state"), size: [44, 44], path: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2), solidDetail: true, detail: (w, h) => ellipse(w / 2, h / 2, w * 0.32, h * 0.32), text: [0, 0, 0, 0] },
  { id: "uml-usecase", cat: "uml", name: S("Kullanım durumu", "Use case"), size: [170, 80], path: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2), text: [0.12, 0.12, 0.88, 0.88] },
  { id: "uml-lifeline", cat: "uml", name: S("Yaşam çizgisi", "Lifeline"), size: [120, 260], path: (w) => rect(0, 0, w, 44), detail: (w, h) => `M${f(w / 2)} 44 V${f(h)}`, text: [0.05, 0, 0.95, 0.17] },
  { id: "uml-fork", cat: "uml", name: S("Çatal / birleşim", "Fork / join"), size: [160, 10], path: (w, h) => rect(0, 0, w, h), solidDetail: true, detail: (w, h) => rect(0, 0, w, h), text: [0, 0, 0, 0] },
  { id: "uml-entity", cat: "uml", name: S("Varlık (ER)", "Entity (ER)"), size: [170, 140], path: (w, h) => rect(0, 0, w, h), detail: (w, h) => line(0, Math.min(32, h * 0.25), w, Math.min(32, h * 0.25)), text: [0.04, 0.02, 0.96, 0.22] },
  { id: "uml-relationship", cat: "uml", name: S("İlişki (ER)", "Relationship (ER)"), size: [140, 90], path: poly([0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]), text: [0.22, 0.22, 0.78, 0.78] },

  // --- Ağ ve BT ---
  { id: "net-server", cat: "network", name: S("Sunucu", "Server"), size: [80, 110], path: (w, h) => rrect(w * 0.1, 0, w * 0.8, h, 6), detail: (w, h) => `${line(w * 0.1, h * 0.33, w * 0.9, h * 0.33)} ${line(w * 0.1, h * 0.66, w * 0.9, h * 0.66)} ${ellipse(w * 0.75, h * 0.17, 3, 3)} ${ellipse(w * 0.75, h * 0.5, 3, 3)} ${ellipse(w * 0.75, h * 0.83, 3, 3)} ${line(w * 0.2, h * 0.17, w * 0.55, h * 0.17)} ${line(w * 0.2, h * 0.5, w * 0.55, h * 0.5)}`, text: [0, 1.02, 1, 1.3] },
  { id: "net-desktop", cat: "network", name: S("Bilgisayar", "Desktop"), size: [110, 100], path: (w, h) => `${rrect(0, 0, w, h * 0.7, 5)} M${f(w * 0.4)} ${f(h * 0.7)} H${f(w * 0.6)} L${f(w * 0.65)} ${f(h * 0.92)} H${f(w * 0.35)} Z`, detail: (w, h) => `${rect(w * 0.06, h * 0.07, w * 0.88, h * 0.55)} ${line(w * 0.25, h * 0.98, w * 0.75, h * 0.98)}`, text: [0, 1.02, 1, 1.3] },
  { id: "net-laptop", cat: "network", name: S("Dizüstü", "Laptop"), size: [130, 90], path: (w, h) => `${rrect(w * 0.12, 0, w * 0.76, h * 0.72, 5)} M0 ${f(h * 0.78)} H${f(w)} L${f(w * 0.94)} ${f(h)} H${f(w * 0.06)} Z`, detail: (w, h) => rect(w * 0.17, h * 0.07, w * 0.66, h * 0.58), text: [0, 1.02, 1, 1.3] },
  { id: "net-phone", cat: "network", name: S("Telefon", "Phone"), size: [60, 110], path: (w, h) => rrect(0, 0, w, h, 10), detail: (w, h) => `${rect(w * 0.1, h * 0.1, w * 0.8, h * 0.76)} ${ellipse(w / 2, h * 0.93, 3, 3)}`, text: [0, 1.02, 1, 1.3] },
  { id: "net-tablet", cat: "network", name: S("Tablet", "Tablet"), size: [100, 130], path: (w, h) => rrect(0, 0, w, h, 10), detail: (w, h) => `${rect(w * 0.08, h * 0.07, w * 0.84, h * 0.82)} ${ellipse(w / 2, h * 0.945, 3, 3)}`, text: [0, 1.02, 1, 1.3] },
  { id: "net-router", cat: "network", name: S("Yönlendirici", "Router"), size: [110, 110], path: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2), detail: (w, h) => `M${f(w * 0.5)} ${f(h * 0.12)} L${f(w * 0.42)} ${f(h * 0.25)} M${f(w * 0.5)} ${f(h * 0.12)} L${f(w * 0.58)} ${f(h * 0.25)} M${f(w * 0.5)} ${f(h * 0.12)} V${f(h * 0.4)} M${f(w * 0.5)} ${f(h * 0.88)} L${f(w * 0.42)} ${f(h * 0.75)} M${f(w * 0.5)} ${f(h * 0.88)} L${f(w * 0.58)} ${f(h * 0.75)} M${f(w * 0.5)} ${f(h * 0.88)} V${f(h * 0.6)} M${f(w * 0.12)} ${f(h * 0.5)} L${f(w * 0.25)} ${f(h * 0.42)} M${f(w * 0.12)} ${f(h * 0.5)} L${f(w * 0.25)} ${f(h * 0.58)} M${f(w * 0.12)} ${f(h * 0.5)} H${f(w * 0.4)} M${f(w * 0.88)} ${f(h * 0.5)} L${f(w * 0.75)} ${f(h * 0.42)} M${f(w * 0.88)} ${f(h * 0.5)} L${f(w * 0.75)} ${f(h * 0.58)} M${f(w * 0.88)} ${f(h * 0.5)} H${f(w * 0.6)}`, text: [0, 1.02, 1, 1.3] },
  { id: "net-switch", cat: "network", name: S("Anahtar (switch)", "Switch"), size: [140, 60], path: (w, h) => rrect(0, 0, w, h, 6), detail: (w, h) => `M${f(w * 0.2)} ${f(h * 0.33)} H${f(w * 0.8)} L${f(w * 0.72)} ${f(h * 0.2)} M${f(w * 0.8)} ${f(h * 0.67)} H${f(w * 0.2)} L${f(w * 0.28)} ${f(h * 0.8)}`, text: [0, 1.05, 1, 1.6] },
  { id: "net-firewall", cat: "network", name: S("Güvenlik duvarı", "Firewall"), size: [120, 90], path: (w, h) => rect(0, 0, w, h), detail: (w, h) => `${line(0, h / 3, w, h / 3)} ${line(0, (h * 2) / 3, w, (h * 2) / 3)} ${line(w / 2, 0, w / 2, h / 3)} ${line(w / 4, h / 3, w / 4, (h * 2) / 3)} ${line((w * 3) / 4, h / 3, (w * 3) / 4, (h * 2) / 3)} ${line(w / 2, (h * 2) / 3, w / 2, h)}`, text: [0, 1.02, 1, 1.35] },
  { id: "net-database", cat: "network", name: S("Veritabanı", "Database"), size: [90, 110], path: cylinder, detail: (w, h) => { const ry = Math.min(h * 0.12, w * 0.25); return `${cylinderTop(w, h)} M0 ${f(h * 0.4)} A${f(w / 2)} ${f(ry)} 0 0 0 ${f(w)} ${f(h * 0.4)} M0 ${f(h * 0.65)} A${f(w / 2)} ${f(ry)} 0 0 0 ${f(w)} ${f(h * 0.65)}`; }, text: [0, 1.02, 1, 1.3] },
  { id: "net-cloud", cat: "network", name: S("İnternet / bulut", "Internet / cloud"), size: [160, 100], path: cloudPath, text: [0.2, 0.35, 0.8, 0.8] },
  { id: "net-user", cat: "network", name: S("Kullanıcı", "User"), size: [80, 90], path: (w, h) => `${ellipse(w / 2, h * 0.25, w * 0.22, h * 0.22)} M0 ${f(h)} C0 ${f(h * 0.55)} ${f(w)} ${f(h * 0.55)} ${f(w)} ${f(h)} Z`, text: [0, 1.02, 1, 1.35] },
  { id: "net-users", cat: "network", name: S("Kullanıcı grubu", "Users"), size: [110, 90], path: (w, h) => `${ellipse(w * 0.35, h * 0.28, w * 0.15, h * 0.2)} ${ellipse(w * 0.68, h * 0.22, w * 0.13, h * 0.18)} M${f(w * 0.05)} ${f(h)} C${f(w * 0.05)} ${f(h * 0.55)} ${f(w * 0.65)} ${f(h * 0.55)} ${f(w * 0.65)} ${f(h)} Z M${f(w * 0.6)} ${f(h * 0.5)} C${f(w * 0.85)} ${f(h * 0.4)} ${f(w)} ${f(h * 0.6)} ${f(w)} ${f(h * 0.85)} H${f(w * 0.7)} Z`, text: [0, 1.02, 1, 1.35] },
  { id: "net-printer", cat: "network", name: S("Yazıcı", "Printer"), size: [110, 90], path: (w, h) => `${rrect(0, h * 0.3, w, h * 0.45, 6)} ${rect(w * 0.2, 0, w * 0.6, h * 0.3)} ${rect(w * 0.2, h * 0.75, w * 0.6, h * 0.25)}`, detail: (w, h) => ellipse(w * 0.85, h * 0.45, 3, 3), text: [0, 1.02, 1, 1.35] },
  { id: "net-wifi", cat: "network", name: S("Kablosuz erişim noktası", "Wireless access point"), size: [100, 90], path: (w, h) => rrect(w * 0.15, h * 0.65, w * 0.7, h * 0.35, 6), detail: (w, h) => `M${f(w * 0.2)} ${f(h * 0.35)} Q${f(w / 2)} ${f(h * 0.05)} ${f(w * 0.8)} ${f(h * 0.35)} M${f(w * 0.32)} ${f(h * 0.46)} Q${f(w / 2)} ${f(h * 0.25)} ${f(w * 0.68)} ${f(h * 0.46)} ${ellipse(w / 2, h * 0.55, 3, 3)}`, text: [0, 1.02, 1, 1.35] },
  { id: "net-storage", cat: "network", name: S("Depolama", "Storage"), size: [110, 70], path: (w, h) => rrect(0, 0, w, h, 6), detail: (w, h) => `${line(w * 0.1, h * 0.5, w * 0.6, h * 0.5)} ${ellipse(w * 0.8, h * 0.5, 4, 4)}`, text: [0, 1.05, 1, 1.5] },
  { id: "net-lock", cat: "network", name: S("Güvenlik", "Security"), size: [80, 100], path: (w, h) => rrect(0, h * 0.42, w, h * 0.58, 8), detail: (w, h) => `M${f(w * 0.22)} ${f(h * 0.42)} V${f(h * 0.28)} A${f(w * 0.28)} ${f(h * 0.25)} 0 0 1 ${f(w * 0.78)} ${f(h * 0.28)} V${f(h * 0.42)} ${line(w / 2, h * 0.62, w / 2, h * 0.8)}`, text: [0, 1.02, 1, 1.3] },
  { id: "net-mail", cat: "network", name: S("E-posta", "Email"), size: [120, 80], path: (w, h) => rect(0, 0, w, h), detail: (w, h) => `M0 0 L${f(w / 2)} ${f(h * 0.55)} L${f(w)} 0`, text: [0, 1.05, 1, 1.5] },

  // --- Balonlar ---
  { id: "co-rect", cat: "callouts", name: S("Konuşma balonu", "Speech bubble"), size: [170, 110], path: (w, h) => `M0 0 H${f(w)} V${f(h * 0.75)} H${f(w * 0.4)} L${f(w * 0.18)} ${f(h)} L${f(w * 0.22)} ${f(h * 0.75)} H0 Z`, text: [0.04, 0.05, 0.96, 0.72] },
  { id: "co-round", cat: "callouts", name: S("Yuvarlak balon", "Rounded bubble"), size: [170, 110], path: (w, h) => { const r = Math.min(w, h) * 0.18; const b = h * 0.75; return `M${f(r)} 0 H${f(w - r)} A${f(r)} ${f(r)} 0 0 1 ${f(w)} ${f(r)} V${f(b - r)} A${f(r)} ${f(r)} 0 0 1 ${f(w - r)} ${f(b)} H${f(w * 0.4)} L${f(w * 0.18)} ${f(h)} L${f(w * 0.24)} ${f(b)} H${f(r)} A${f(r)} ${f(r)} 0 0 1 0 ${f(b - r)} V${f(r)} A${f(r)} ${f(r)} 0 0 1 ${f(r)} 0 Z`; }, text: [0.06, 0.06, 0.94, 0.7] },
  { id: "co-oval", cat: "callouts", name: S("Oval balon", "Oval bubble"), size: [170, 110], path: (w, h) => `M${f(w * 0.3)} ${f(h * 0.76)} A${f(w / 2)} ${f(h * 0.38)} 0 1 1 ${f(w * 0.42)} ${f(h * 0.79)} L${f(w * 0.12)} ${f(h)} Z`, text: [0.14, 0.12, 0.86, 0.66] },
  { id: "co-thought", cat: "callouts", name: S("Düşünce balonu", "Thought bubble"), size: [170, 120], path: (w, h) => `${cloudPath(w, h * 0.8)} ${ellipse(w * 0.2, h * 0.88, w * 0.05, h * 0.05)} ${ellipse(w * 0.1, h * 0.96, w * 0.03, h * 0.03)}`, text: [0.2, 0.28, 0.8, 0.65] },
  { id: "co-line", cat: "callouts", name: S("Çizgili açıklama", "Line callout"), size: [170, 110], path: (w, h) => rect(w * 0.25, 0, w * 0.75, h * 0.6), detail: (w, h) => `M${f(w * 0.25)} ${f(h * 0.6)} L0 ${f(h)}`, text: [0.28, 0.04, 0.97, 0.56] },
  { id: "co-banner", cat: "callouts", name: S("Afiş", "Banner"), size: [200, 80], path: poly([0, 0.15], [0.12, 0.15], [0.12, 0], [0.88, 0], [0.88, 0.15], [1, 0.15], [0.92, 0.5], [1, 0.85], [0.88, 0.85], [0.88, 1], [0.12, 1], [0.12, 0.85], [0, 0.85], [0.08, 0.5]), text: [0.14, 0.05, 0.86, 0.95] },
  { id: "co-ribbon", cat: "callouts", name: S("Kurdele", "Ribbon"), size: [200, 70], path: poly([0, 0], [1, 0], [0.92, 0.5], [1, 1], [0, 1], [0.08, 0.5]), text: [0.1, 0.05, 0.9, 0.95] },
  { id: "co-tag", cat: "callouts", name: S("Etiket", "Tag"), size: [150, 70], path: poly([0.2, 0], [1, 0], [1, 1], [0.2, 1], [0, 0.5]), detail: (w, h) => ellipse(w * 0.16, h * 0.5, 4, 4), text: [0.24, 0.05, 0.97, 0.95] },

  // --- Semboller ---
  { id: "sym-minus", cat: "symbols", name: S("Eksi", "Minus"), size: [100, 40], path: (w, h) => rect(0, h * 0.25, w, h * 0.5), text: [0, 0, 0, 0] },
  { id: "sym-multiply", cat: "symbols", name: S("Çarpı", "Multiply"), size: [90, 90], path: poly([0.15, 0], [0.5, 0.35], [0.85, 0], [1, 0.15], [0.65, 0.5], [1, 0.85], [0.85, 1], [0.5, 0.65], [0.15, 1], [0, 0.85], [0.35, 0.5], [0, 0.15]), text: [0, 0, 0, 0] },
  { id: "sym-divide", cat: "symbols", name: S("Bölü", "Divide"), size: [100, 100], path: (w, h) => `${rect(0, h * 0.42, w, h * 0.16)} ${ellipse(w / 2, h * 0.17, w * 0.12, h * 0.12)} ${ellipse(w / 2, h * 0.83, w * 0.12, h * 0.12)}`, text: [0, 0, 0, 0] },
  { id: "sym-equal", cat: "symbols", name: S("Eşittir", "Equal"), size: [100, 70], path: (w, h) => `${rect(0, h * 0.1, w, h * 0.28)} ${rect(0, h * 0.62, w, h * 0.28)}`, text: [0, 0, 0, 0] },
  { id: "sym-not-equal", cat: "symbols", name: S("Eşit değil", "Not equal"), size: [100, 80], path: (w, h) => `${rect(0, h * 0.18, w, h * 0.2)} ${rect(0, h * 0.62, w, h * 0.2)} ${poly([0.62, 0], [0.75, 0], [0.38, 1], [0.25, 1])(w, h)}`, text: [0, 0, 0, 0] },
  { id: "sym-check", cat: "symbols", name: S("Onay işareti", "Check mark"), size: [100, 80], path: poly([0, 0.55], [0.14, 0.42], [0.38, 0.66], [0.86, 0], [1, 0.12], [0.38, 1]), text: [0, 0, 0, 0] },
  { id: "sym-x", cat: "symbols", name: S("Çarpı işareti", "X mark"), size: [80, 80], path: poly([0.1, 0], [0.5, 0.4], [0.9, 0], [1, 0.1], [0.6, 0.5], [1, 0.9], [0.9, 1], [0.5, 0.6], [0.1, 1], [0, 0.9], [0.4, 0.5], [0, 0.1]), text: [0, 0, 0, 0] },
  { id: "sym-question", cat: "symbols", name: S("Soru", "Question"), size: [90, 90], path: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2), text: [0.1, 0.1, 0.9, 0.9] },
  { id: "sym-no", cat: "symbols", name: S("Yasak", "Prohibited"), size: [100, 100], path: (w, h) => `${ellipse(w / 2, h / 2, w / 2, h / 2)} ${ellipse(w / 2, h / 2, w * 0.38, h * 0.38)}`, detail: (w, h) => line(w * 0.24, h * 0.24, w * 0.76, h * 0.76), text: [0, 0, 0, 0] },
  { id: "sym-flag", cat: "symbols", name: S("Bayrak", "Flag"), size: [90, 110], path: (w, h) => `${rect(0, 0, w * 0.08, h)} M${f(w * 0.08)} ${f(h * 0.05)} C${f(w * 0.4)} ${f(-h * 0.05)} ${f(w * 0.6)} ${f(h * 0.2)} ${f(w)} ${f(h * 0.08)} V${f(h * 0.5)} C${f(w * 0.6)} ${f(h * 0.62)} ${f(w * 0.4)} ${f(h * 0.38)} ${f(w * 0.08)} ${f(h * 0.48)} Z`, text: [0.12, 0.08, 0.95, 0.45] },
  { id: "sym-pin", cat: "symbols", name: S("Konum", "Location pin"), size: [80, 110], path: (w, h) => `M${f(w / 2)} ${f(h)} C${f(w * 0.2)} ${f(h * 0.6)} 0 ${f(h * 0.5)} 0 ${f(h * 0.35)} A${f(w / 2)} ${f(h * 0.35)} 0 1 1 ${f(w)} ${f(h * 0.35)} C${f(w)} ${f(h * 0.5)} ${f(w * 0.8)} ${f(h * 0.6)} ${f(w / 2)} ${f(h)} Z`, detail: (w, h) => ellipse(w / 2, h * 0.35, w * 0.17, h * 0.12), text: [0, 1.02, 1, 1.3] },
  { id: "sym-lightbulb", cat: "symbols", name: S("Fikir", "Idea"), size: [80, 110], path: (w, h) => `M${f(w * 0.3)} ${f(h * 0.72)} C${f(w * 0.3)} ${f(h * 0.6)} 0 ${f(h * 0.5)} 0 ${f(h * 0.33)} A${f(w / 2)} ${f(h * 0.33)} 0 1 1 ${f(w)} ${f(h * 0.33)} C${f(w)} ${f(h * 0.5)} ${f(w * 0.7)} ${f(h * 0.6)} ${f(w * 0.7)} ${f(h * 0.72)} Z ${rect(w * 0.3, h * 0.76, w * 0.4, h * 0.1)} ${rect(w * 0.36, h * 0.9, w * 0.28, h * 0.1)}`, text: [0, 1.02, 1, 1.3] },
  { id: "sym-clock", cat: "symbols", name: S("Saat", "Clock"), size: [100, 100], path: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2), detail: (w, h) => `M${f(w / 2)} ${f(h * 0.18)} V${f(h / 2)} L${f(w * 0.72)} ${f(h * 0.62)}`, text: [0, 1.02, 1, 1.3] },
  { id: "sym-calendar", cat: "symbols", name: S("Takvim", "Calendar"), size: [100, 100], path: (w, h) => rrect(0, h * 0.1, w, h * 0.9, 8), detail: (w, h) => `${line(0, h * 0.32, w, h * 0.32)} ${line(w * 0.28, 0, w * 0.28, h * 0.2)} ${line(w * 0.72, 0, w * 0.72, h * 0.2)}`, text: [0.05, 0.36, 0.95, 0.95] },
];

export const SHAPE_BY_ID = new Map(SHAPES.map((s) => [s.id, s]));
