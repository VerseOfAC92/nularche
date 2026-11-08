// Sürüm karşılaştırma (2.0): bir anlık görüntü ya da kontrol noktası ile notun şimdiki hali, satır satır.

import { useMemo, useState } from "react";
import { diffLines } from "../../../core/src/writing.ts";
import { t } from "../i18n/index.ts";

export function DiffView({ before, after }: { before: string; after: string }) {
  const ops = useMemo(() => diffLines(before.replace(/\r\n/g, "\n").trimEnd(), after.replace(/\r\n/g, "\n").trimEnd()), [before, after]);
  const [onlyChanges, setOnlyChanges] = useState(true);
  const added = ops.filter((o) => o.kind === "add").length;
  const removed = ops.filter((o) => o.kind === "del").length;
  // Yalnızca değişiklikler: değişen satırların çevresindeki iki satır bağlam olarak kalır.
  const keep = new Set<number>();
  ops.forEach((o, i) => {
    if (o.kind !== "same") for (let j = i - 2; j <= i + 2; j++) keep.add(j);
  });
  return (
    <div className="diff-view">
      <div className="row">
        <span className="diff-add small">+{added}</span>
        <span className="diff-del small">−{removed}</span>
        <span className="grow" />
        <label className="check small">
          <input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} /> {t("ws.onlyChanges")}
        </label>
      </div>
      {!added && !removed ? (
        <p className="muted small">{t("ws.noDifference")}</p>
      ) : (
        <pre>
          {ops.map((o, i) =>
            onlyChanges && !keep.has(i) ? (
              keep.has(i - 1) ? (
                <div key={i} className="diff-gap">
                  ⋯
                </div>
              ) : null
            ) : (
              <div key={i} className={`diff-line ${o.kind}`}>
                <span className="diff-sign">{o.kind === "add" ? "+" : o.kind === "del" ? "−" : " "}</span>
                {o.text || " "}
              </div>
            ),
          )}
        </pre>
      )}
    </div>
  );
}
