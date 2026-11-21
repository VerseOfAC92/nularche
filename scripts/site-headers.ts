// nularche.verseofac.com güvenlik başlıkları: tanıtım sitesi ve web sürümü (/app). build-site.ts bunlardan
// site/_headers dosyasını üretir (Cloudflare Pages biçimi); web sürümünün uçtan uca denetimi (check-web-app.ts) aynı
// başlıklarla sunar, böylece Google girişi, Drive, Takvim ve service worker bu kurallar altında sınanır.

/** Tanıtım sitesi: dış kaynak yok, ağ isteği yok. */
export const SITE_CSP = "default-src 'none'; script-src 'self'; img-src 'self' data:; style-src 'self'; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/**
 * Web sürümü: masaüstü arayüzünün kuralları (server/src/app.ts APP_CSP) ve Google'a giden yollar: oturum açma
 * (accounts.google.com, GIS betiği ve penceresi), Drive ve Takvim API'leri (www.googleapis.com, Drive yüklemeleri de).
 * Notlardaki görseller ve ekler /files üzerinden service worker'dan gelir ('self').
 */
export const APP_CSP = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com/gsi/client",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://www.googleapis.com https://accounts.google.com/gsi/",
  "worker-src 'self' blob:",
  "frame-src https://accounts.google.com/gsi/ https://www.youtube-nocookie.com https://www.youtube.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/** Ortak başlıklar (her iki bölüm). */
const COMMON: [string, string][] = [
  ["X-Content-Type-Options", "nosniff"],
  ["Referrer-Policy", "no-referrer"],
  ["Strict-Transport-Security", "max-age=31536000"],
];
const SITE_PERMISSIONS = "camera=(), microphone=(), geolocation=()";
/** Web sürümünde ses kaydı (not içine) mikrofon ister; kamera ve konum kapalı. */
const APP_PERMISSIONS = "camera=(), microphone=(self), geolocation=()";

/** Web sürümünün sayfa başlıkları; Google'ın oturum açma penceresi açılır pencereyle konuşabilsin diye COOP. */
export const APP_HEADERS: [string, string][] = [
  ["Content-Security-Policy", APP_CSP],
  ["Permissions-Policy", APP_PERMISSIONS],
  ["Cross-Origin-Opener-Policy", "same-origin-allow-popups"],
  ...COMMON,
];

/** site/_headers: `/app/*` sitenin katı CSP'sini ve izinlerini kaldırıp kendininkileri koyar (`! Ad` Cloudflare'de
 *  önceki kuralın başlığını siler; ortak başlıklar `/*` kuralından gelir). */
export function headersFile(): string {
  const block = (path: string, lines: string[]) => `${path}\n${lines.map((l) => `  ${l}`).join("\n")}\n`;
  return [
    block("/*", [`Content-Security-Policy: ${SITE_CSP}`, ...COMMON.map(([k, v]) => `${k}: ${v}`), `Permissions-Policy: ${SITE_PERMISSIONS}`]),
    block("/app/*", [
      "! Content-Security-Policy",
      "! Permissions-Policy",
      ...APP_HEADERS.filter(([k]) => !COMMON.some(([c]) => c === k)).map(([k, v]) => `${k}: ${v}`),
    ]),
  ].join("\n");
}
