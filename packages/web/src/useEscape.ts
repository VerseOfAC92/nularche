// Pencereler Esc ile kapanır (yalnızca en üstteki pencere: açık bir alt menü önce kendi Esc'ini işler).

import { useEffect, useRef } from "react";

export function useEscape(onClose: () => void): void {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      ref.current();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
}
