// `node --import ./scripts/web-platform/register.mjs`: web platform katmanını devreye alır (bkz. hooks.mjs).
import { register } from "node:module";

const { Buffer } = await import("../../packages/web-platform/src/buffer.ts");
globalThis.Buffer = Buffer;
register("./hooks.mjs", import.meta.url);
