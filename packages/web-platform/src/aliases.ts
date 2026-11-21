// Web sürümünün Vite takma adları: çekirdeğin Node modülleri tarayıcıdaki karşılıklarına bağlanır. Web uygulamasının
// derleme yapılandırması ve scripts/web-platform/check-bundle.ts bu listeyi kullanır (tek kaynak).

import { fileURLToPath } from "node:url";

const here = (f: string) => fileURLToPath(new URL(`./${f}`, import.meta.url));

export const WEB_PLATFORM_ALIASES = [
  { find: /^(node:)?fs\/promises$/, replacement: here("fs.ts") },
  { find: /^node:fs$/, replacement: here("fs-sync.ts") },
  { find: /^(node:)?crypto$/, replacement: here("crypto.ts") },
  { find: /^(node:)?path$/, replacement: here("path.ts") },
  { find: /^node:zlib$/, replacement: here("zlib.ts") },
];

/** Web sürümünün çekirdekten kullanabileceği modüller: tarayıcı derlemesi bunlardan başlar. */
export const WEB_CORE_ENTRY = here("core-entry.ts");
