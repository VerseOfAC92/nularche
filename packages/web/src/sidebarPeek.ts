// Gizlenmiş kenar çubuğunun "göz atma" durumu: küçültme düğmesinin üzerine gelince kenar çubuğu açılır panel
// olarak belirir; fare düğmeden ve panelden çıkınca kısa bir gecikmeyle kaybolur (aradaki boşluğu geçerken kapanmasın).

import { useSyncExternalStore } from "react";

let open = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const set = (v: boolean) => {
  clearTimeout(timer);
  if (open !== v) {
    open = v;
    emit();
  }
};

/** Fare düğmeye ya da panele girdi. */
export const peekEnter = () => set(true);
/** Fare çıktı: kısa gecikmeyle kapanır; bu sürede panele/düğmeye girilirse açık kalır. */
export const peekLeave = () => {
  clearTimeout(timer);
  timer = setTimeout(() => set(false), 280);
};
export const peekClose = () => set(false);

export function usePeek(): boolean {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => open,
  );
}
