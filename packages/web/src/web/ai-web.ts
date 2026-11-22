// Web sürümünde Nularche AI: masaüstündeki otomatik modla aynı Gemini işlemleri (server/src/auto-service.ts).
// Kullanıcının Gemini API anahtarı yalnızca bu sekmenin belleğinde tutulur; sekme kapanınca, kilitlenince ya da
// çıkış yapılınca silinir ve bir sonraki girişte yeniden girilir. Model tercihleri de bellektedir.

import { createAutoService, type AutoSettings } from "../../../server/src/auto-service.ts";
import type { AutoBridge } from "../desktop.ts";
import { getLang, t } from "../i18n/index.ts";

export interface WebAi {
  bridge: AutoBridge;
  close(): void;
}

export function createWebAi(options: { originRoot(): string | null; api?: string }): WebAi {
  let key: string | null = null;
  let settings: AutoSettings = {};
  const service = createAutoService({
    originRoot: options.originRoot,
    settings: () => settings,
    save: async (patch) => void (settings = { ...settings, ...patch }),
    text: (k) => t(k),
    lang: getLang,
    api: options.api,
    key: {
      available: () => true,
      read: async () => key,
      write: async (k) => void (key = k),
      remove: async () => void (key = null),
    },
  });
  return {
    bridge: {
      autoStatus: () => service.status(),
      autoSetKey: (k) => service.setKey(k),
      autoClear: () => service.clear(),
      autoEnable: (on) => service.enable(on),
      autoRun: (id) => service.run(id),
      autoRetry: (id) => service.retry(id),
      autoCancel: (id, reply) => service.cancel(id, reply),
      transcribe: (path, mode, language) => service.transcribe(path, mode, language),
    },
    close() {
      key = null;
      settings = {};
    },
  };
}
