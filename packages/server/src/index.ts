// CLI girişi: `npm start` ile yerel sunucuyu tarayıcı için başlatır.
import path from "node:path";
import { projectRoot, resolveOriginDir } from "../../core/src/index.ts";
import { startServer } from "./app.ts";

const server = await startServer({
  originDir: resolveOriginDir(),
  webDist: path.join(projectRoot(), "packages/web/dist"),
  port: Number(process.env.NULARCHE_PORT || 5178),
  extraOrigins: ["http://localhost:5173"],
});
console.log(`Nularche: http://localhost:${server.port}  (Origin: ${server.store.root})`);
