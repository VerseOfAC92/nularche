// check-bridge.ts için tarayıcıda çalışan küçük sayfa: bellek içi Origin üzerinde ortak API işleyicisini kurar ve
// service worker'ı bağlar. Web uygulamasının açılış sırasının en küçük hâli (oturum açma ve Drive hariç).

import { AiActivity, Anamnesis, CommentStore, createApi, EventHub, NodeStore, vfs } from "../../packages/web-platform/src/core-entry.ts";
import { setApiHandler, startHost } from "../../packages/web-platform/src/host.ts";

declare global {
  interface Window {
    harness: Promise<string>;
  }
}

window.harness = (async () => {
  const store = new NodeStore("/origin");
  await store.ensureRoot();
  const events = new EventHub();
  vfs.onChange(() => events.emit("change"));
  const api = createApi({ store, activity: new AiActivity(store.root), comments: new CommentStore(store), anamnesis: new Anamnesis(store), events });
  setApiHandler((request) => api.handle(request));
  await startHost("/app/sw.js", "/app/");
  return "ready";
})();
