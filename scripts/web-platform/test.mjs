// Çekirdek testlerini web platform katmanıyla (bellek içi dosya sistemi, tarayıcı şifrelemesi) çalıştırır.
// security.test.ts Node'un HTTP sunucusunu sınar; o sunucu tarayıcıda çalışmadığı için dışarıda kalır.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const SKIP = new Set(["security.test.ts"]);
const files = readdirSync("packages/core/test").filter((f) => f.endsWith(".test.ts") && !SKIP.has(f)).map((f) => `packages/core/test/${f}`);
const r = spawnSync(process.execPath, ["--import", "./scripts/web-platform/register.mjs", "--test", ...files], { stdio: "inherit" });
process.exit(r.status ?? 1);
