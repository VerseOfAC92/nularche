// Web sürümünün çekirdekten kullandığı modüller (tarayıcı derlemesinin giriş noktası). Bir modül buraya
// eklendiğinde scripts/web-platform/check-bundle.ts onun tarayıcıda derlenebildiğini denetler.

import "./globals.ts";

export { NodeStore, SHADOW } from "../../core/src/node-store.ts";
export { runQuery } from "../../core/src/query.ts";
export { Anamnesis } from "../../core/src/anamnesis.ts";
export { readAnnotations, writeAnnotations } from "../../core/src/annotations.ts";
export { readPrefs, writePrefs } from "../../core/src/prefs.ts";
export { syncOrigin, deriveKeys, encryptFile, decryptFile, keyCheck } from "../../core/src/drive-sync.ts";
export { GoogleDrive } from "../../core/src/drive-google.ts";
export { loadLibrary, citationSettings } from "../../core/src/citations-store.ts";
export { exportPageHtml } from "../../core/src/export.ts";
export { compileManuscript } from "../../core/src/manuscript.ts";
export { CommentStore } from "../../core/src/comments.ts";
export { AiActivity } from "../../core/src/ai-activity.ts";
export { vfs } from "./vfs.ts";
export { createApi, EventHub } from "../../server/src/api.ts";
