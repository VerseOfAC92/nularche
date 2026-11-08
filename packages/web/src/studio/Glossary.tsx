// Nularche dili (sözlük): uygulamanın kendi adlarının anlamları. İlk açılış sihirbazında, boş Origin'deki karşılama
// ekranında ve "Nularche dili" komutuyla açılan pencerede aynı liste gösterilir.

import { useEffect } from "react";
import { t, type StringKey } from "../i18n/index.ts";

type Term = [name: string, icon: string, meaning: StringKey];

export const GLOSSARY: { group: StringKey; terms: Term[] }[] = [
  {
    group: "gloss.groupBase",
    terms: [
      ["Origin", "⊙", "term.origin"],
      ["Arche", "◈", "term.arche"],
      ["Node", "◇", "term.node"],
      ["Shard", "▱", "term.shard"],
      ["Shadow", "◐", "term.shadow"],
      ["Atrium", "🏛", "gloss.atrium"],
    ],
  },
  {
    group: "gloss.groupStudio",
    terms: [
      ["Codex", "📕", "gloss.codex"],
      ["Axis", "🗂", "gloss.axis"],
      ["Mosaic", "🗃", "gloss.mosaic"],
      ["Lore", "📚", "gloss.lore"],
      ["Marginalia", "✎", "gloss.marginalia"],
      ["Epoch", "⚑", "gloss.epoch"],
      ["Diptych", "◫", "gloss.diptych"],
    ],
  },
  {
    group: "gloss.groupTools",
    terms: [
      ["Clepsydra", "⧗", "gloss.clepsydra"],
      ["Aura", "♪", "gloss.aura"],
      ["Sigil", "⌁", "gloss.sigil"],
      ["Rite", "★", "gloss.rite"],
      ["Conduit", "⇢", "gloss.conduit"],
      ["Ark", "⛵", "gloss.ark"],
    ],
  },
];

export function Glossary({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`glossary ${compact ? "compact" : ""}`}>
      {GLOSSARY.map((g) => (
        <section key={g.group}>
          <h4>{t(g.group)}</h4>
          <dl>
            {g.terms.map(([name, icon, meaning]) => (
              <div key={name} className="gloss-row">
                <dt>
                  <span aria-hidden>{icon}</span> {name}
                </dt>
                <dd>{t(meaning)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

export function GlossaryDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={t("gloss.title")}>
        <header>
          <h2>{t("gloss.title")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("common.close")}>
            ✕
          </button>
        </header>
        <p className="muted">{t("gloss.intro")}</p>
        <Glossary />
      </div>
    </div>
  );
}
