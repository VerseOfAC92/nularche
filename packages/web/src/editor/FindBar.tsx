// Sayfa içi bul ve değiştir çubuğu (⌘F / ⌥⌘F). Eşleşmeler editörde vurgulanır; Türkçe büyük/küçük harf kuralları geçerlidir.

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { t } from "../i18n/index.ts";
import { findKey, replaceMatches, setFind } from "./notes-extensions.ts";

export function FindBar({ editor, replace: showReplace, onClose, onToast }: { editor: Editor; replace: boolean; onClose: () => void; onToast?: (m: string) => void }) {
  const initial = findKey.getState(editor.state);
  const sel = editor.state.selection;
  const [query, setQuery] = useState(() => (sel.empty ? (initial?.query ?? "") : editor.state.doc.textBetween(sel.from, sel.to, " ").slice(0, 200)));
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCase] = useState(initial?.caseSensitive ?? false);
  const [ignoreAccents, setAccents] = useState(initial?.ignoreAccents ?? false);
  const [replaceOpen, setReplaceOpen] = useState(showReplace);
  const [state, setState] = useState(() => findKey.getState(editor.state)!);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => setReplaceOpen((v) => v || showReplace), [showReplace]);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [showReplace]);

  useEffect(() => {
    setState(setFind(editor, { query, caseSensitive, ignoreAccents, index: 0 }, query.length > 0));
  }, [editor, query, caseSensitive, ignoreAccents]);

  // Esc, odak editördeyken de çubuğu kapatır (açık bir pencere yoksa).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector(".overlay")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [onClose]);

  useEffect(() => {
    const update = () => setState(findKey.getState(editor.state)!);
    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
      editor.view.dispatch(editor.state.tr.setMeta(findKey, { query: "" }));
    };
  }, [editor]);

  const go = (delta: number) => {
    const s = findKey.getState(editor.state)!;
    if (!s.matches.length) return;
    setState(setFind(editor, { index: (s.index + delta + s.matches.length) % s.matches.length }));
  };

  const doReplace = (all: boolean) => {
    const n = replaceMatches(editor, replacement, all);
    if (all && n) onToast?.(t("find.replaced", { n }));
    setState(setFind(editor, {}, true));
  };

  const close = () => {
    onClose();
    editor.commands.focus();
  };

  return (
    <div className="find-bar" onKeyDown={(e) => e.key === "Escape" && (e.preventDefault(), close())}>
      <div className="find-row">
        <button className="icon-btn" onClick={() => setReplaceOpen((v) => !v)} title={t("cmd.findReplace")}>
          {replaceOpen ? "▾" : "▸"}
        </button>
        <input
          ref={input}
          value={query}
          placeholder={t("find.placeholder")}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              go(e.shiftKey ? -1 : 1);
            }
          }}
        />
        <span className="find-count">{query ? (state.matches.length ? t("find.count", { i: state.index + 1, n: state.matches.length }) : t("find.none")) : ""}</span>
        <button className="icon-btn" onClick={() => go(-1)} title={t("cmd.findPrev")} disabled={!state.matches.length}>
          ↑
        </button>
        <button className="icon-btn" onClick={() => go(1)} title={t("cmd.findNext")} disabled={!state.matches.length}>
          ↓
        </button>
        <button className={`icon-btn ${caseSensitive ? "on" : ""}`} onClick={() => setCase((v) => !v)} title={t("find.case")}>
          Aa
        </button>
        <button className={`icon-btn ${ignoreAccents ? "on" : ""}`} onClick={() => setAccents((v) => !v)} title={t("find.accents")}>
          ç=c
        </button>
        <button className="icon-btn" onClick={close} title={t("find.close")}>
          ✕
        </button>
      </div>
      {replaceOpen && (
        <div className="find-row">
          <span className="find-spacer" />
          <input
            value={replacement}
            placeholder={t("find.replacePlaceholder")}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                doReplace(e.metaKey || e.ctrlKey);
              }
            }}
          />
          <button className="secondary" onClick={() => doReplace(false)} disabled={!state.matches.length}>
            {t("find.replace")}
          </button>
          <button className="secondary" onClick={() => doReplace(true)} disabled={!state.matches.length}>
            {t("find.replaceAll")}
          </button>
        </div>
      )}
    </div>
  );
}

export { findKey };
