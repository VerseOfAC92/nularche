// Bir öğeye bağlı açılır pencere: öğenin altında açılır, ekrana sığdırılır, dışarı tıklayınca ya da Esc ile kapanır.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function Popover({
  anchor,
  onClose,
  children,
  width,
  className = "",
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const a = anchor.getBoundingClientRect();
    const box = ref.current.getBoundingClientRect();
    let top = a.bottom + 4;
    if (top + box.height > innerHeight - 8) top = Math.max(8, a.top - box.height - 4);
    const left = Math.min(Math.max(8, a.left), innerWidth - box.width - 8);
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      // İç içe açılır pencereler (ör. seçenek rengi) kendi portalındadır.
      if ((t as HTMLElement).closest?.(".db-pop")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      className={`db-pop ${className}`}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, ...(width ? { width } : {}) }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}
