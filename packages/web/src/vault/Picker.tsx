// Ortak seçici penceresi: komut paleti, hızlı geçiş ve not seçimi (birleştirme, tuvale not ekleme) aynı bileşeni kullanır.
// Bulanık eşleşme: sorgunun harfleri sırayla geçmeli; ardışık ve kelime başı eşleşmeler daha yüksek puan alır.

import { useEffect, useMemo, useRef, useState } from "react";

export interface PickItem {
  id: string;
  label: string;
  /** Aramada etiketle birlikte eşleşen ek metinler (takma adlar, yol). */
  aliases?: string[];
  detail?: string;
  icon?: string;
  hint?: string;
}

/** Türkçe büyük/küçük harf duyarsız bulanık puan; eşleşmezse -1. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLocaleLowerCase("tr").replace(/\s+/g, "");
  const s = text.toLocaleLowerCase("tr");
  if (!q) return 0;
  if (s.includes(q)) return 1000 - s.indexOf(q) * 2 - s.length / 100;
  let score = 0;
  let at = -1;
  let run = 0;
  for (const ch of q) {
    const next = s.indexOf(ch, at + 1);
    if (next < 0) return -1;
    run = next === at + 1 ? run + 1 : 0;
    score += 10 + run * 5 + (next === 0 || /[\s/_-]/.test(s[next - 1]) ? 8 : 0);
    at = next;
  }
  return score - s.length / 100;
}

export function Picker({
  items,
  placeholder,
  empty,
  onPick,
  onClose,
  extra,
  limit = 60,
}: {
  items: PickItem[];
  placeholder: string;
  empty?: string;
  onPick: (item: PickItem, query: string, e: { shift: boolean; mod: boolean }) => void;
  onClose: () => void;
  /** Sorgu doluyken listenin sonuna eklenen satır (ör. "Yeni not oluştur: …"). */
  extra?: (query: string) => PickItem | null;
  limit?: number;
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const filter = (query: string): PickItem[] => {
    const scored = query.trim()
      ? items
          .map((it) => ({ it, s: Math.max(fuzzyScore(query, it.label), ...(it.aliases ?? []).map((a) => fuzzyScore(query, a) - 5)) }))
          .filter((x) => x.s >= 0)
          .sort((a, b) => b.s - a.s)
          .map((x) => x.it)
      : items;
    const out = scored.slice(0, limit);
    const more = query.trim() ? extra?.(query.trim()) : null;
    return more ? [...out, more] : out;
  };
  const shown = useMemo(() => filter(q), [q, items, extra, limit]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setActive(0), [q]);
  // Yeni Chromium'da scrollIntoView bir Promise döndürür; etki temizleme işlevi sanılmasın diye gövde süslü parantezde.
  useEffect(() => {
    list.current?.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (it: PickItem | undefined, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => it && onPick(it, q.trim(), { shift: e.shiftKey, mod: e.metaKey || e.ctrlKey });

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="search picker" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          placeholder={placeholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") (e.preventDefault(), onClose());
            else if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(a + 1, shown.length - 1)));
            else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
            // Sonuçlar alanın o anki metninden hesaplanır: hızlı yazıp Enter'a basınca liste henüz yeniden çizilmemiş olabilir.
            else if (e.key === "Enter") {
              e.preventDefault();
              const query = e.currentTarget.value;
              const list = query === q ? shown : filter(query);
              const it = list[query === q ? active : 0];
              if (it) onPick(it, query.trim(), { shift: e.shiftKey, mod: e.metaKey || e.ctrlKey });
            }
          }}
        />
        <div className="results" ref={list}>
          {shown.map((it, i) => (
            <button key={it.id} className={i === active ? "active" : ""} onMouseEnter={() => setActive(i)} onClick={(e) => pick(it, e)}>
              {it.icon !== undefined && <span className="pick-icon">{it.icon}</span>}
              <span className="grow">
                <strong>{it.label}</strong>
                {it.detail && <small>{it.detail}</small>}
              </span>
              {it.hint && <kbd className="pick-hint">{it.hint}</kbd>}
            </button>
          ))}
          {shown.length === 0 && empty && <p className="empty">{empty}</p>}
        </div>
      </div>
    </div>
  );
}
