// `node:zlib` yerine geçen modül (web sürümü): yalnızca çekirdeğin kullandığı gzip işlevleri (fflate, MIT).

import { gunzipSync as gunzip, gzipSync as gzip } from "fflate";
import { Buffer } from "./buffer.ts";

export const gzipSync = (data: Uint8Array): Buffer => Buffer.from(gzip(data));
export const gunzipSync = (data: Uint8Array): Buffer => Buffer.from(gunzip(data));
export default { gzipSync, gunzipSync };
