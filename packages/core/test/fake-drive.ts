// Testler ve uçtan uca senaryolar için Google Drive v3 ve OAuth belirteç uç noktalarının küçük bir taklidi.
// Yalnızca Nularche'nin kullandığı istekleri anlar: about, files list (appProperties sorguları), oluşturma,
// multipart ve resumable yükleme, içerik indirme ve çöpe taşıma.

import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";

export interface FakeFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  appProperties: Record<string, string>;
  data: Buffer;
  trashed: boolean;
  modifiedTime: string;
}

const FOLDER = "application/vnd.google-apps.folder";

export interface FakeDrive {
  url: string;
  files: Map<string, FakeFile>;
  /** Kalıcı olarak silinen dosyaların adları. */
  removed: string[];
  /** Drive'da (başka bir cihazdan) bir dosyanın içeriğini değiştirir. */
  edit(id: string, text: string): void;
  /** Kökten itibaren yol ile dosya bulur ("Notes/A.md"). */
  byPath(rootId: string, rel: string): FakeFile | undefined;
  close(): Promise<void>;
}

export async function startFakeDrive(account = "alex@gmail.com"): Promise<FakeDrive> {
  const files = new Map<string, FakeFile>();
  let n = 0;
  const now = () => new Date(Date.now() + n++).toISOString();
  const view = (f: FakeFile) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    parents: f.parents,
    modifiedTime: f.modifiedTime,
    trashed: f.trashed,
    appProperties: f.appProperties,
    ...(f.mimeType === FOLDER ? {} : { md5Checksum: createHash("md5").update(f.data).digest("hex"), size: String(f.data.length) }),
  });
  const create = (meta: Record<string, unknown>, data = Buffer.alloc(0)) => {
    const f: FakeFile = {
      id: `f${randomUUID().slice(0, 8)}`,
      name: String(meta.name ?? "untitled"),
      mimeType: String(meta.mimeType ?? "application/octet-stream"),
      parents: (meta.parents as string[]) ?? [],
      appProperties: (meta.appProperties as Record<string, string>) ?? {},
      data,
      trashed: false,
      modifiedTime: now(),
    };
    files.set(f.id, f);
    return f;
  };
  /** multipart/related gövdesinden üst bilgi ve içerik. */
  const multipart = (body: Buffer, type: string) => {
    const boundary = /boundary=([^;]+)/.exec(type)?.[1] ?? "";
    const sep = Buffer.from(`--${boundary}`);
    const first = body.indexOf(sep);
    const second = body.indexOf(sep, first + sep.length);
    const third = body.indexOf(sep, second + sep.length);
    const part = (from: number, to: number) => {
      const chunk = body.subarray(from + sep.length, to);
      const split = chunk.indexOf("\r\n\r\n");
      return chunk.subarray(split + 4, chunk.length - 2);
    };
    return { meta: JSON.parse(part(first, second).toString("utf8") || "{}"), data: Buffer.from(part(second, third)) };
  };
  const sessions = new Map<string, { id?: string; meta: Record<string, unknown> }>();
  /** Kalıcı olarak silinen dosyaların adları (testlerde doğrulamak için). */
  const removedLog: string[] = [];

  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url ?? "/", "http://x");
    const json = (v: unknown, status = 200) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(v));
    // Google girişi: izin verilmiş gibi hemen geri dönüş adresine yönlendirir.
    if (url.pathname === "/auth") {
      const back = new URL(url.searchParams.get("redirect_uri") ?? "http://127.0.0.1/");
      back.searchParams.set("code", "fake-code");
      back.searchParams.set("state", url.searchParams.get("state") ?? "");
      return res.writeHead(302, { location: back.toString() }).end();
    }
    if (url.pathname === "/token") {
      const grant = new URLSearchParams(body.toString("utf8")).get("grant_type");
      return json({ access_token: "at", expires_in: 3600, ...(grant === "authorization_code" ? { refresh_token: "rt" } : {}) });
    }
    if (url.pathname === "/drive/v3/about") return json({ user: { emailAddress: account, displayName: "Alex" } });
    if (url.pathname === "/drive/v3/files" && req.method === "GET") {
      const q = url.searchParams.get("q") ?? "";
      const root = /key='nularcheRoot' and value='([^']+)'/.exec(q)?.[1];
      const list = [...files.values()].filter((f) => {
        if (f.trashed) return false;
        if (q.includes("nularcheOrigin")) return f.appProperties.nularcheOrigin === "1";
        if (root) return f.appProperties.nularcheRoot === root;
        return false;
      });
      return json({ files: list.map(view) });
    }
    if (url.pathname === "/drive/v3/files" && req.method === "POST") return json(view(create(JSON.parse(body.toString("utf8")))));
    const fileId = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname)?.[1];
    if (fileId) {
      const f = files.get(decodeURIComponent(fileId));
      if (!f) return json({ error: "notFound" }, 404);
      removedLog.push(...(req.method === "DELETE" ? [f.name] : []));
      if (req.method === "GET" && url.searchParams.get("alt") === "media") return res.writeHead(200).end(f.data);
      if (req.method === "DELETE") {
        files.delete(f.id);
        return res.writeHead(204).end();
      }
      if (req.method === "PATCH") {
        const patch = JSON.parse(body.toString("utf8") || "{}");
        if (patch.trashed) f.trashed = true;
        f.modifiedTime = now();
        return json(view(f));
      }
      return json(view(f));
    }
    const up = /^\/upload\/drive\/v3\/files(?:\/([^/]+))?$/.exec(url.pathname);
    if (up) {
      const id = up[1] ? decodeURIComponent(up[1]) : undefined;
      const type = url.searchParams.get("uploadType");
      if (type === "multipart") {
        const { meta, data } = multipart(body, String(req.headers["content-type"]));
        if (id) {
          const f = files.get(id);
          if (!f) return json({ error: "notFound" }, 404);
          f.data = data;
          f.modifiedTime = now();
          return json(view(f));
        }
        return json(view(create(meta, data)));
      }
      if (type === "resumable") {
        const sid = randomUUID();
        sessions.set(sid, { id, meta: JSON.parse(body.toString("utf8") || "{}") });
        return res.writeHead(200, { location: `${base}/session/${sid}` }).end();
      }
    }
    const sess = /^\/session\/(.+)$/.exec(url.pathname)?.[1];
    if (sess && sessions.has(sess)) {
      const s = sessions.get(sess)!;
      sessions.delete(sess);
      if (s.id) {
        const f = files.get(s.id)!;
        f.data = body;
        f.modifiedTime = now();
        return json(view(f));
      }
      return json(view(create(s.meta, body)));
    }
    json({ error: "unsupported", path: url.pathname, method: req.method }, 400);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    url: base,
    files,
    removed: removedLog,
    edit(id, text) {
      const f = files.get(id)!;
      f.data = Buffer.from(text);
      f.modifiedTime = now();
    },
    byPath(rootId, rel) {
      let parent = rootId;
      const parts = rel.split("/");
      for (let i = 0; i < parts.length; i++) {
        const hit = [...files.values()].find((f) => !f.trashed && f.parents[0] === parent && f.name === parts[i]);
        if (!hit) return undefined;
        if (i === parts.length - 1) return hit;
        parent = hit.id;
      }
      return undefined;
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
