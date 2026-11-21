// `node:fs` yerine geçen küçük modül (web sürümü): çekirdeğin ve testlerinin kullandığı eşzamanlı işlevler.

import { vfs } from "./vfs.ts";

export const existsSync = (p: string): boolean => !!vfs.get(p);
export default { existsSync };
