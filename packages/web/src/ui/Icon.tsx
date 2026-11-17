// Arayüzün tek simge bileşeni: aynı çizgi kalınlığı, boyut ve hizayla çizilen Tabler simgeleri.
// Renkli emoji ve yazı tipi karakterleri yerine kenar çubuğu, menüler, ayarlar ve araç çubukları bunu kullanır.
// Kullanıcının notlara verdiği simgeler (emoji) içeriktir ve olduğu gibi kalır.

import { createElement } from "react";
import { ICONS, type IconName } from "./icon-data.ts";

export type { IconName };

export function Icon({ name, size = 16, filled = false, className = "" }: { name: IconName; size?: number; filled?: boolean; className?: string }) {
  return (
    <svg
      className={`ui-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {(ICONS[name] as readonly (readonly [string, Record<string, string>])[]).map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}

/** Simge adı ise çizgi simge, değilse metin (kullanıcının emojisi ya da "H1", "EN" gibi kısa etiket) çizer. */
export function Glyph({ icon, size = 16 }: { icon: string | undefined; size?: number }) {
  if (!icon) return null;
  return icon in ICONS ? <Icon name={icon as IconName} size={size} /> : <>{icon}</>;
}
