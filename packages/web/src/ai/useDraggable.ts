// Sabit konumlu bir pencereyi başlığından sürükletir. Konum görüş alanına sıkıştırılır ve
// localStorage'da saklanır; kayıtlı konum yoksa pencere CSS'teki varsayılan yerinde (sağ alt) durur.

import { type CSSProperties, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";

interface Pos {
  x: number;
  y: number;
}

const MARGIN = 8;

function load(key: string): Pos | null {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "null") as unknown;
    if (raw && typeof raw === "object" && Number.isFinite((raw as Pos).x) && Number.isFinite((raw as Pos).y)) return raw as Pos;
  } catch {
    // Bozuk ya da erişilemeyen kayıt: varsayılan konum.
  }
  return null;
}

function clamp(pos: Pos, el: HTMLElement | null): Pos {
  const w = el?.offsetWidth ?? 0;
  const h = el?.offsetHeight ?? 0;
  return {
    x: Math.min(Math.max(MARGIN, pos.x), Math.max(MARGIN, window.innerWidth - w - MARGIN)),
    y: Math.min(Math.max(MARGIN, pos.y), Math.max(MARGIN, window.innerHeight - h - MARGIN)),
  };
}

export function useDraggable(key: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(() => load(key));
  const [dragging, setDragging] = useState(false);

  const save = useCallback(
    (p: Pos | null) => {
      try {
        if (p) localStorage.setItem(key, JSON.stringify(p));
        else localStorage.removeItem(key);
      } catch {
        // Kayıt yapılamazsa konum yalnızca bu oturumda kalır.
      }
    },
    [key],
  );

  // Pencere küçülünce paneli görünür alanda tut.
  useEffect(() => {
    if (!pos) return;
    const fit = () => setPos((p) => (p ? clamp(p, ref.current) : p));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [pos === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest("button, input, textarea, a, select")) return;
      const el = ref.current;
      if (!el) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const dx = e.clientX - rect.left;
      const dy = e.clientY - rect.top;
      let last: Pos = { x: rect.left, y: rect.top };
      setDragging(true);
      const move = (ev: PointerEvent) => {
        last = clamp({ x: ev.clientX - dx, y: ev.clientY - dy }, el);
        setPos(last);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        setDragging(false);
        save(last);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    },
    [save],
  );

  const reset = useCallback(
    (e?: { target: EventTarget }) => {
      if (e && (e.target as HTMLElement).closest("button")) return;
      setPos(null);
      save(null);
    },
    [save],
  );

  const style: CSSProperties | undefined = pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined;
  return { ref, style, dragging, onPointerDown, reset };
}
