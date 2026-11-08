// Uygulamayla gelen yazı tipleri (2.0): hepsi açık lisanslıdır (SIL OFL 1.1 ya da Apache 2.0) ve çevrimdışı çalışır.
// Türkçe karakterler için latin-ext alt kümeleri de yüklenir; tarayıcı yalnızca kullanılan karakter aralıklarını indirir.

import "@fontsource/atkinson-hyperlegible/latin-400.css";
import "@fontsource/atkinson-hyperlegible/latin-ext-400.css";
import "@fontsource/atkinson-hyperlegible/latin-700.css";
import "@fontsource/atkinson-hyperlegible/latin-ext-700.css";
import "@fontsource/atkinson-hyperlegible/latin-400-italic.css";
import "@fontsource/atkinson-hyperlegible/latin-ext-400-italic.css";
import "@fontsource/courier-prime/latin-400.css";
import "@fontsource/courier-prime/latin-ext-400.css";
import "@fontsource/courier-prime/latin-700.css";
import "@fontsource/courier-prime/latin-ext-700.css";
import "@fontsource/courier-prime/latin-400-italic.css";
import "@fontsource/courier-prime/latin-ext-400-italic.css";
import "@fontsource/literata/latin-400.css";
import "@fontsource/literata/latin-ext-400.css";
import "@fontsource/literata/latin-700.css";
import "@fontsource/literata/latin-ext-700.css";
import "@fontsource/literata/latin-400-italic.css";
import "@fontsource/literata/latin-ext-400-italic.css";
import "@fontsource/lora/latin-400.css";
import "@fontsource/lora/latin-ext-400.css";
import "@fontsource/lora/latin-700.css";
import "@fontsource/lora/latin-ext-700.css";
import "@fontsource/lora/latin-400-italic.css";
import "@fontsource/lora/latin-ext-400-italic.css";
import "@fontsource/crimson-pro/latin-400.css";
import "@fontsource/crimson-pro/latin-ext-400.css";
import "@fontsource/crimson-pro/latin-700.css";
import "@fontsource/crimson-pro/latin-ext-700.css";
import "@fontsource/crimson-pro/latin-400-italic.css";
import "@fontsource/crimson-pro/latin-ext-400-italic.css";
import "@fontsource/special-elite/latin-400.css";
import "@fontsource/special-elite/latin-ext-400.css";

export interface BundledFont {
  family: string;
  kind: "serif" | "sans" | "mono" | "typewriter";
  /** Kısa açıklama için i18n anahtarının son parçası. */
  note: "legible" | "screenplay" | "book" | "classic" | "elegant" | "typewriter";
}

export const BUNDLED_FONTS: BundledFont[] = [
  { family: "Atkinson Hyperlegible", kind: "sans", note: "legible" },
  { family: "Literata", kind: "serif", note: "book" },
  { family: "Lora", kind: "serif", note: "classic" },
  { family: "Crimson Pro", kind: "serif", note: "elegant" },
  { family: "Courier Prime", kind: "mono", note: "screenplay" },
  { family: "Special Elite", kind: "typewriter", note: "typewriter" },
];

export const isBundledFont = (family: string | undefined) => !!family && BUNDLED_FONTS.some((f) => f.family === family);
