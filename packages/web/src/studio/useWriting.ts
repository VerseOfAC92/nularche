// Yazma sayfalarının (manuskript, taslak, kartlar) ortak durum kancası: gövdedeki JSON bloğu bir kez ayrıştırılır;
// her değişiklik bloğa yazılıp NodeView'in kaydetme kuyruğuna verilir (NodeView kısa bir gecikmeyle ve sayfadan
// ayrılırken kaydeder). Blok bozuksa üzerine yazılmaz.

import { useCallback, useMemo, useRef, useState } from "react";
import { parseWriting, serializeWriting, type WritingDataMap, type WritingKind } from "../../../core/src/writing.ts";

export function useWriting<K extends WritingKind>(kind: K, body: string, onChange: (body: string) => void) {
  const parsed = useMemo(() => parseWriting(kind, body), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [data, setState] = useState<WritingDataMap[K]>(parsed.data);
  const bodyRef = useRef(body);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const update = useCallback(
    (fn: (d: WritingDataMap[K]) => WritingDataMap[K]) => {
      setState((cur) => {
        const next = fn(structuredClone(cur));
        if (!parsed.broken) {
          bodyRef.current = serializeWriting(kind, bodyRef.current, next);
          onChangeRef.current(bodyRef.current);
        }
        return next;
      });
    },
    [kind, parsed.broken],
  );
  return { data, update, broken: parsed.broken };
}

/** Renk etiketleri (kart, bölüm, satır). Değerler tema değişkenlerine bağlı değil; iki temada da okunur. */
export const LABEL_COLORS: { id: string; value: string }[] = [
  { id: "red", value: "#e5534b" },
  { id: "orange", value: "#e0823d" },
  { id: "yellow", value: "#c69026" },
  { id: "green", value: "#57ab5a" },
  { id: "teal", value: "#39a4a8" },
  { id: "blue", value: "#539bf5" },
  { id: "purple", value: "#986ee2" },
  { id: "pink", value: "#e275ad" },
  { id: "gray", value: "#8b949e" },
];

export const colorOf = (id: string | undefined) => LABEL_COLORS.find((c) => c.id === id)?.value;

/** Dizideki öğeyi başka bir konuma taşır. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const out = [...list];
  const [x] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, x);
  return out;
}
