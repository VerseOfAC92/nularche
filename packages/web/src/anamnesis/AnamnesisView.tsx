// Anamnesis: bilgi kartlarını tekrar ekranı (bkz. core/src/anamnesis.ts). Kart önce sorusuyla gösterilir; cevap
// açılınca dört değerlendirmeden biri seçilir (1 Tekrar, 2 Zor, 3 İyi, 4 Kolay — klavyeden de). Düğmelerde kartın
// bir sonraki soruluş zamanı yazar. Kartlar notlardaki `Soru :: Cevap` satırlarıdır.

import { useCallback, useEffect, useState } from "react";
import type { Grade, AnamnesisQueue } from "../../../core/src/anamnesis.ts";
import type { NodeMeta } from "../api.ts";
import { safeHtml } from "../editor/linked-nodes.tsx";
import { t } from "../i18n/index.ts";
import { usePref } from "../prefs.ts";
import { Icon } from "../ui/Icon.tsx";

const GRADES: { g: Grade; key: "mn.again" | "mn.hard" | "mn.good" | "mn.easy"; cls: string }[] = [
  { g: 1, key: "mn.again", cls: "again" },
  { g: 2, key: "mn.hard", cls: "hard" },
  { g: 3, key: "mn.good", cls: "good" },
  { g: 4, key: "mn.easy", cls: "easy" },
];

/** Süreyi kısa yazar: 10 dk, 3 g, 2 ay, 1,5 yıl. */
export function spanText(ms: number): string {
  const min = ms / 60_000;
  if (min < 60) return t("mn.min", { n: Math.max(1, Math.round(min)) });
  const h = min / 60;
  if (h < 24) return t("mn.hour", { n: Math.round(h) });
  const d = h / 24;
  if (d < 31) return t("mn.day", { n: Math.round(d) });
  if (d < 365) return t("mn.month", { n: Math.round(d / 30) });
  return t("mn.year", { n: (Math.round((d / 365) * 10) / 10).toLocaleString() });
}

export function AnamnesisView({ nodes, changeTick, onOpen }: { nodes: NodeMeta[]; changeTick: number; onOpen: (id: string) => void }) {
  const [arche, setArche] = usePref<string>("anamnesisArche", "");
  const [newPerDay, setNewPerDay] = usePref<number>("anamnesisNewPerDay", 20);
  const [data, setData] = useState<AnamnesisQueue | null>(null);
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/anamnesis${arche ? `?arche=${encodeURIComponent(arche)}` : ""}`)
      .then((r) => r.json() as Promise<AnamnesisQueue>)
      .then((d) => (setData(d), setIndex(0), setShown(false)))
      .catch(() => undefined);
  }, [arche]);
  useEffect(load, [load, newPerDay]);
  // Notlar değişince (yeni kart eklenince) yalnızca tekrar başlamadıysa yenile.
  useEffect(() => {
    if (changeTick && index === 0 && !shown) load();
  }, [changeTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const card = data?.queue[index];

  const grade = async (g: Grade) => {
    if (!card || busy) return;
    setBusy(true);
    await fetch("/api/anamnesis/grade", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: card.id, grade: g }) }).catch(() => undefined);
    setBusy(false);
    setShown(false);
    // "Tekrar" denen kart bu oturumun sonunda yeniden sorulur.
    if (g === 1 && data) setData({ ...data, queue: [...data.queue, { ...card, next: card.next }] });
    setIndex((i) => i + 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]")) return;
      if (!card) return;
      if (!shown && (e.key === " " || e.key === "Enter")) return (e.preventDefault(), setShown(true));
      if (shown && ["1", "2", "3", "4"].includes(e.key)) return (e.preventDefault(), void grade(Number(e.key) as Grade));
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  const arches = nodes.filter((n) => n.parentNodeId === null && n.archeId === n.id && !n.template);
  const remaining = data ? data.queue.length - index : 0;
  return (
    <div className="page anamnesis" data-testid="anamnesis">
      <div className="note-list-head">
        <h1>
          <span className="note-list-icon">
            <Icon name="cards" size={26} />
          </span>
          Anamnesis
          {data && <span className="note-count">{remaining}</span>}
        </h1>
        <div className="row">
          <select value={arche} onChange={(e) => setArche(e.target.value)} aria-label={t("mn.deck")}>
            <option value="">{t("mn.allArches")}</option>
            {arches.map((a) => (
              <option key={a.id} value={a.id}>
                {a.icon ? `${a.icon} ` : ""}
                {a.title}
              </option>
            ))}
            <option value="shadow">Shadow</option>
          </select>
          <label className="muted small row">
            {t("mn.newPerDay")}
            <input type="number" min={0} max={500} value={newPerDay} style={{ width: 64 }} onChange={(e) => setNewPerDay(Math.max(0, Math.min(500, Number(e.target.value) || 0)))} />
          </label>
        </div>
      </div>
      <p className="muted small">{t("mn.hint")}</p>
      {data && (
        <p className="muted small" data-testid="mn-counts">
          {t("mn.counts", { due: data.counts.due, fresh: data.counts.new, total: data.counts.total, today: data.counts.reviewedToday })}
        </p>
      )}
      {data && !card && (
        <div className="mn-done">
          <Icon name="circle-check" size={40} />
          <h2>{data.counts.total ? t("mn.doneTitle") : t("mn.emptyTitle")}</h2>
          <p className="muted">{data.counts.total ? t("mn.doneText") : t("mn.emptyText")}</p>
        </div>
      )}
      {card && (
        <div className="mn-card" data-testid="mn-card">
          <div className="mn-front" dangerouslySetInnerHTML={{ __html: safeHtml(card.front) }} />
          {shown ? (
            <>
              <hr />
              <div className="mn-back" data-testid="mn-back" dangerouslySetInnerHTML={{ __html: safeHtml(card.back) }} />
              <div className="mn-grades">
                {GRADES.map(({ g, key, cls }) => (
                  <button key={g} className={`mn-grade ${cls}`} disabled={busy} onClick={() => void grade(g)} data-testid={`mn-grade-${g}`}>
                    <strong>{t(key)}</strong>
                    <span className="muted small">{spanText(card.next[g])}</span>
                    <kbd>{g}</kbd>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <button className="primary mn-show" onClick={() => setShown(true)} data-testid="mn-show">
              {t("mn.show")} <kbd>␣</kbd>
            </button>
          )}
          <button className="link-btn mn-source" onClick={() => onOpen(card.noteId)}>
            <Icon name="file-text" size={13} /> {card.noteTitle}
          </button>
        </div>
      )}
    </div>
  );
}
