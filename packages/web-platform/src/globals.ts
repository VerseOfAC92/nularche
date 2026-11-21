// Web sürümünde çekirdeğin beklediği Node genel değerleri: `Buffer` (bkz. buffer.ts). Uygulamanın en başında
// bir kez içe aktarılır.

import { Buffer } from "./buffer.ts";

(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
