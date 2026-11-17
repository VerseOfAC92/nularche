// Nularche dili (sözlük): uygulamanın kendi adlarının anlamları. İlk açılış sihirbazında, boş Origin'deki karşılama
// ekranında ve "Nularche dili" komutuyla açılan pencerede aynı liste gösterilir.

import { useEffect } from "react";
import { t, type StringKey } from "../i18n/index.ts";
import { Icon, type IconName } from "../ui/Icon.tsx";

type Term = [name: string, icon: IconName, meaning: StringKey];

export const GLOSSARY: { group: StringKey; terms: Term[] }[] = [
  {
    group: "gloss.groupBase",
    terms: [
      ["Origin", "circle-dot", "term.origin"],
      ["Arche", "diamond", "term.arche"],
      ["Archipelago", "stack-2", "gloss.archipelago"],
      ["Node", "file", "term.node"],
      ["Shard", "square", "term.shard"],
      ["Shadow", "circle-half-2", "term.shadow"],
      ["Atrium", "building-bank", "gloss.atrium"],
    ],
  },
  {
    group: "gloss.groupStudio",
    terms: [
      ["Codex", "book", "gloss.codex"],
      ["Axis", "list-tree", "gloss.axis"],
      ["Mosaic", "layout-grid", "gloss.mosaic"],
      ["Lore", "books", "gloss.lore"],
      ["Marginalia", "message-circle", "gloss.marginalia"],
      ["Epoch", "flag", "gloss.epoch"],
      ["Diptych", "layout-columns", "gloss.diptych"],
      ["Tabula", "chalkboard", "gloss.tabula"],
    ],
  },
  {
    group: "gloss.groupTools",
    terms: [
      ["Clepsydra", "hourglass", "gloss.clepsydra"],
      ["Aura", "music", "gloss.aura"],
      ["Sigil", "signature", "gloss.sigil"],
      ["Rite", "star", "gloss.rite"],
      ["Conduit", "arrow-right", "gloss.conduit"],
      ["Ark", "archive", "gloss.ark"],
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
                  <span className="gloss-icon" aria-hidden><Icon name={icon} size={15} /></span> {name}
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
            <Icon name="x" />
          </button>
        </header>
        <p className="muted">{t("gloss.intro")}</p>
        <Glossary />
      </div>
    </div>
  );
}
