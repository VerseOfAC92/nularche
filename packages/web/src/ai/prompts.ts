// Nularche AI hazır eylemleri ve AI aracına yapıştırılan istem metni (seçili arayüz dilinde).

import { getLang, t } from "../i18n/index.ts";

export interface AiAction {
  label: string;
  icon: string;
  instruction: string;
}

const ACTIONS = [
  ["fix", "✓"],
  ["summarize", "≡"],
  ["expand", "↕"],
  ["todos", "☑"],
  ["link", "↗"],
  ["toEnglish", "EN"],
  ["toTurkish", "TR"],
] as const;

export function aiActions(): AiAction[] {
  return ACTIONS.map(([key, icon]) => ({ label: t(`action.${key}`), icon, instruction: t(`action.${key}.do`) }));
}

export const PROVIDER_LABEL: Record<string, string> = { claude: "Claude", chatgpt: "ChatGPT", gemini: "Gemini" };

/** AI aracına yapıştırılacak istem: AI, ayrıntıları get_nularche_request ile Nularche'den alır. */
export function requestPrompt(req: { id: string; label: string; instruction: string; nodeTitle?: string; selection?: string }): string {
  const lines = [
    t("prompt.intro", { id: req.id }),
    t("prompt.step1", { id: req.id }),
    t("prompt.step2"),
    t("prompt.step3", { language: getLang() === "tr" ? "Türkçe" : "English" }),
    "",
    t("prompt.request", { text: req.label === req.instruction ? req.instruction : `${req.label}: ${req.instruction}` }),
  ];
  if (req.nodeTitle) lines.push(t("prompt.node", { title: req.nodeTitle }));
  if (req.selection) lines.push(t("prompt.selection"));
  return lines.join("\n");
}
