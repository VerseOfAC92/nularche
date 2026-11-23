// Sayfa ikonu seçicisi: işletim sisteminin çizebildiği bütün emojiler, kategorilere ayrılmış; Türkçe ya da İngilizce
// arama, ten rengi ve son kullanılanlar (Origin tercihlerinde, cihazlar arasında ortak).

import { useEffect, useMemo, useRef, useState } from "react";
import { getLang, hasString, t } from "../i18n/index.ts";
import { getPref, setPref } from "../prefs.ts";
import { loadEmoji, searchEmoji, withTone, type EmojiData, type EmojiItem } from "./data.ts";

const RECENT_KEY = "recentEmoji";
const TONE_KEY = "emojiTone";
const RECENT_MAX = 24;
/** Kategori sekmelerinin simgeleri (gruplarla aynı sırada). */
const GROUP_ICON: Record<string, string> = {
  "smileys-emotion": "😀",
  "people-body": "👋",
  "animals-nature": "🐻",
  "food-drink": "🍔",
  "travel-places": "✈️",
  activities: "⚽",
  objects: "💡",
  symbols: "💠",
  flags: "🏁",
};
const TONE_SWATCH = ["✋", "✋🏻", "✋🏼", "✋🏽", "✋🏾", "✋🏿"];

export function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const [data, setData] = useState<EmojiData | null>(null);
  const [query, setQuery] = useState("");
  const [tone, setTone] = useState(() => getPref<number>(TONE_KEY, 0));
  const [toneOpen, setToneOpen] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const tr = getLang() === "tr";

  // Dışarı tıklayınca kapanır (seçicinin kutusu, ör. "İkonu kaldır" düğmesi, içeride sayılır).
  useEffect(() => {
    const away = (e: MouseEvent) => {
      const box = root.current?.parentElement;
      if (box && !box.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [onClose]);

  useEffect(() => {
    let live = true;
    void loadEmoji().then((d) => live && setData(d));
    return () => void (live = false);
  }, []);

  const recent = useMemo(() => getPref<string[]>(RECENT_KEY, []).filter((x) => typeof x === "string"), []);
  const results = useMemo(() => (data && query.trim() ? searchEmoji(data.items, query) : null), [data, query]);
  const byGroup = useMemo(() => data?.groups.map((g, i) => ({ key: g, items: data.items.filter((x) => x.group === i) })) ?? [], [data]);

  function pick(emoji: string) {
    setPref(RECENT_KEY, [emoji, ...recent.filter((x) => x !== emoji)].slice(0, RECENT_MAX));
    onPick(emoji);
  }

  const name = (x: EmojiItem) => (tr ? x.tr : x.en);
  const button = (x: EmojiItem) => {
    const e = withTone(x, tone);
    return (
      <button key={x.emoji} type="button" title={name(x)} aria-label={name(x)} onClick={() => pick(e)}>
        {e}
      </button>
    );
  };
  const groupLabel = (key: string) => {
    const k = `emoji.g.${key}`;
    return hasString(k) ? t(k) : key;
  };

  return (
    <div className="emoji-picker" data-testid="emoji-picker" ref={root} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onClose())}>
      <div className="emoji-top">
        <input
          autoFocus
          className="emoji-search"
          placeholder={t("emoji.search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results?.length) pick(withTone(results[0], tone));
          }}
        />
        <div className="emoji-tone">
          <button type="button" title={t("emoji.tone")} aria-label={t("emoji.tone")} onClick={() => setToneOpen(!toneOpen)}>
            {TONE_SWATCH[tone]}
          </button>
          {toneOpen && (
            <div className="emoji-tone-menu">
              {TONE_SWATCH.map((s, i) => (
                <button key={s} type="button" className={i === tone ? "on" : ""} onClick={() => (setTone(i), setPref(TONE_KEY, i), setToneOpen(false))}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {!results && data && (
        <div className="emoji-tabs">
          {byGroup.map((g) => (
            <button
              key={g.key}
              type="button"
              title={groupLabel(g.key)}
              aria-label={groupLabel(g.key)}
              onClick={() => {
                // Yalnızca liste kayar (scrollIntoView sayfayı da kaydırırdı).
                const box = list.current;
                const section = box?.querySelector<HTMLElement>(`[data-group="${g.key}"]`);
                if (box && section) box.scrollTop = section.offsetTop;
              }}
            >
              {GROUP_ICON[g.key] ?? g.items[0]?.emoji}
            </button>
          ))}
        </div>
      )}
      <div className="emoji-list" ref={list}>
        {!data && <p className="muted small emoji-note">{t("emoji.loading")}</p>}
        {results &&
          (results.length ? <div className="emoji-grid">{results.map(button)}</div> : <p className="muted small emoji-note">{t("emoji.none")}</p>)}
        {!results && data && (
          <>
            {recent.length > 0 && (
              <section>
                <h4>{t("emoji.recent")}</h4>
                <div className="emoji-grid">
                  {recent.map((e) => (
                    <button key={e} type="button" onClick={() => pick(e)}>
                      {e}
                    </button>
                  ))}
                </div>
              </section>
            )}
            {byGroup.map((g) =>
              g.items.length ? (
                <section key={g.key} data-group={g.key}>
                  <h4>{groupLabel(g.key)}</h4>
                  <div className="emoji-grid">{g.items.map(button)}</div>
                </section>
              ) : null,
            )}
          </>
        )}
      </div>
    </div>
  );
}
