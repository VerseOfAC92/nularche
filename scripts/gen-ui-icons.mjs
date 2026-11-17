// Arayüz simgelerini Tabler Icons'tan (MIT) seçip packages/web/src/ui/icon-data.ts dosyasına yazar.
// Tek tip çizgi simgeler: kenar çubuğu, menüler, ayarlar, Atrium ve araç çubukları bunları kullanır.
// Yeni simge için NAMES listesine Tabler adını ekleyip `node scripts/gen-ui-icons.mjs` çalıştırın.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const NAMES = `
building-bank search circle-half-2 plus calendar-event template sparkles notes clock paperclip trash info-circle settings
folder-cog hash stack-2 diamond file chevron-right chevron-down list pencil x check arrow-back-up message-circle flag
layout-columns hourglass music dots star pin lock lock-open target typography sun list-check volume app-window copy
table download world file-type-pdf printer package-export photo mood-smile arrows-exchange notebook book list-tree
layout-grid books chalkboard checkbox circle-dot palette bolt database keyboard calendar folders link signature mail
volume-off cloud-rain moon flame microphone movie external-link restore arrows-diff backspace refresh arrow-up
align-left align-center align-right bold italic underline strikethrough arrow-bar-to-up arrow-bar-to-down arrow-down
layout-align-left layout-align-center layout-align-right layout-align-top layout-align-middle layout-align-bottom
layout-distribute-horizontal layout-distribute-vertical inbox folder-open eraser minus file-text player-play
player-pause player-skip-forward rotate maximize brush flip-horizontal flip-vertical box-multiple box-off upload filter arrows-sort eye-off alert-triangle square layout-kanban timeline selector tags progress phone arrow-up-right clock-hour-4 letter-t calculator clock-edit circle-check grip-vertical home graph puzzle numbers math-function sum bulb alert-circle alert-octagon archive arrow-right quote mountain arrows-vertical align-justified wand circle-x help-circle map-pin video bell repeat
`.trim().split(/\s+/);

const root = fileURLToPath(new URL("..", import.meta.url));
const nodes = JSON.parse(readFileSync(root + "node_modules/@tabler/icons/tabler-nodes-outline.json", "utf8"));
const missing = NAMES.filter((n) => !nodes[n]);
if (missing.length) throw new Error(`Tabler'da yok: ${missing.join(", ")}`);
const data = Object.fromEntries(NAMES.sort().map((n) => [n, nodes[n].map(([tag, attrs]) => [tag, Object.fromEntries(Object.entries(attrs).filter(([k]) => k !== "key"))])]));
const out = `// Bu dosya scripts/gen-ui-icons.mjs ile üretilir; elle düzenlemeyin.
// Simgeler: Tabler Icons (MIT lisansı, © Paweł Kuna, https://tabler.io/icons).

export type IconNode = [string, Record<string, string>];
export const ICONS = ${JSON.stringify(data)} as const satisfies Record<string, IconNode[]>;
export type IconName = keyof typeof ICONS;
`;
writeFileSync(root + "packages/web/src/ui/icon-data.ts", out);
console.log(`${NAMES.length} simge yazıldı`);
