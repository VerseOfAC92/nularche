// Sayfa ve Tabula yazı tipi yığınları: genel aileler ve sık bulunan sistem yazı tipleri (arayüzden bağımsız).

export const FONT_STACKS: Record<string, string> = {
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif',
  sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  mono: '"JetBrains Mono", "SF Mono", Menlo, Consolas, "Courier New", monospace',
};

/** Sık bulunan sistem yazı tipleri; yüklü değilse tarayıcı bir sonrakine geçer. */
export const SYSTEM_FONTS = [
  "Georgia",
  "Palatino",
  "Baskerville",
  "Charter",
  "Times New Roman",
  "Helvetica Neue",
  "Avenir Next",
  "Arial",
  "Verdana",
  "Gill Sans",
  "Optima",
  "Menlo",
  "Courier New",
  "American Typewriter",
  "Noteworthy",
  "Segoe UI",
  "Calibri",
  "Cambria",
  "Ubuntu",
  "Noto Serif",
  "Noto Sans",
];

export const DEFAULT_FONT_SIZE = 16;

export function fontStack(font: string | undefined): string | undefined {
  if (!font) return undefined;
  return FONT_STACKS[font] ?? `"${font.replace(/"/g, "")}", ${FONT_STACKS.sans}`;
}
