import { defineConfig } from "vitest/config";

export default defineConfig({ test: { include: ["packages/web/test/**/*.test.ts"] } });
