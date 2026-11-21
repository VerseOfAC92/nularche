// Google Drive bağdaştırıcısı (REST v3): drive-sync.ts'teki DriveApi sözleşmesini uygular. Yalnızca `drive.file`
// izniyle çalışır: Nularche, Drive'da yalnızca kendi oluşturduğu klasör ve dosyaları görür ve değiştirir.
// Her öğeye `nularcheRoot` uygulama özelliği yazılır; böylece bir Origin'in bütün ağacı tek sorguyla listelenir.

import { randomUUID } from "node:crypto";
import type { DriveApi, RemoteEntry, RootInfo } from "./drive-sync.ts";

type Fetch = typeof fetch;

export const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file"];
export const DRIVE_API = "https://www.googleapis.com/drive/v3";
export const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FOLDER = "application/vnd.google-apps.folder";
/** Bu boyutun üstündeki dosyalar sürdürülebilir (resumable) yüklemeyle gönderilir. */
const MULTIPART_LIMIT = 5 * 1024 * 1024;

export type DriveErrorCode = "auth" | "not_found" | "network" | "quota" | "invalid";

export class DriveError extends Error {
  readonly code: DriveErrorCode;
  readonly status?: number;
  constructor(code: DriveErrorCode, message: string, status?: number) {
    super(message);
    this.name = "DriveError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Masaüstü: yenileme belirteciyle kendi erişim belirtecini alır. Web: erişim belirtecini tarayıcıdaki Google oturum
 * açma penceresi verir (yenileme belirteci ve istemci sırrı yoktur); `force` süresi dolan belirtecin yenisini ister.
 */
export type DriveCredentials = { clientId: string; clientSecret: string; refreshToken: string } | { accessToken: (force?: boolean) => Promise<string> };

export interface DriveEndpoints {
  token?: string;
  api?: string;
  upload?: string;
  fetch?: Fetch;
}

async function request(f: Fetch, url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await f(url, init);
  } catch (e) {
    throw new DriveError("network", (e as Error).message);
  }
  if (res.ok) return res;
  const text = (await res.text().catch(() => "")).slice(0, 300);
  const code: DriveErrorCode =
    res.status === 401
      ? "auth"
      : res.status === 403 && /storageQuota|quotaExceeded/i.test(text)
        ? "quota"
        : res.status === 403
          ? "auth"
          : res.status === 404
            ? "not_found"
            : res.status === 429 || res.status >= 500
              ? "network"
              : "invalid";
  throw new DriveError(code, `HTTP ${res.status}${text ? `: ${text}` : ""}`, res.status);
}

interface GFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  md5Checksum?: string;
  size?: string;
  modifiedTime?: string;
  trashed?: boolean;
  appProperties?: Record<string, string>;
}

/** Kök klasörün uygulama özelliklerinden şifreleme bilgisi. */
const rootOf = (f: GFile): RootInfo => ({
  trashed: !!f.trashed,
  encrypted: f.appProperties?.nularcheEnc === "1",
  ...(f.appProperties?.nularcheSalt ? { salt: f.appProperties.nularcheSalt } : {}),
  ...(f.appProperties?.nularcheCheck ? { check: f.appProperties.nularcheCheck } : {}),
});

const FIELDS = "id,name,mimeType,parents,md5Checksum,size,modifiedTime";
const escapeQ = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export class GoogleDrive implements DriveApi {
  private access: { token: string; until: number } | null = null;
  private readonly f: Fetch;
  private readonly api: string;
  private readonly uploadApi: string;
  private readonly tokenUrl: string;
  private readonly creds: DriveCredentials;

  constructor(creds: DriveCredentials, endpoints: DriveEndpoints = {}) {
    this.creds = creds;
    this.f = endpoints.fetch ?? fetch;
    this.api = endpoints.api ?? DRIVE_API;
    this.uploadApi = endpoints.upload ?? DRIVE_UPLOAD;
    this.tokenUrl = endpoints.token ?? TOKEN_URL;
  }

  private async token(force = false): Promise<string> {
    if ("accessToken" in this.creds) return this.creds.accessToken(force);
    if (this.access && this.access.until > Date.now()) return this.access.token;
    let res: Response;
    try {
      res = await request(this.f, this.tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: this.creds.refreshToken,
          client_id: this.creds.clientId,
          client_secret: this.creds.clientSecret,
        }),
      });
    } catch (e) {
      // Geri alınmış ya da süresi dolmuş yenileme belirteci: yeniden bağlanmak gerekir.
      if (e instanceof DriveError && (e.status === 400 || e.status === 401)) throw new DriveError("auth", e.message, e.status);
      throw e;
    }
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new DriveError("auth", "Google did not return an access token");
    this.access = { token: body.access_token, until: Date.now() + Math.max(60, (body.expires_in ?? 3600) - 60) * 1000 };
    return body.access_token;
  }

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    const send = async (force: boolean) => request(this.f, url, { ...init, headers: { authorization: `Bearer ${await this.token(force)}`, ...(init.headers as Record<string, string>) } });
    try {
      return await send(false);
    } catch (e) {
      // Web: erişim belirtecinin süresi dolmuş olabilir; bir kez yenisiyle denenir.
      if ("accessToken" in this.creds && e instanceof DriveError && e.status === 401) return send(true);
      throw e;
    }
  }

  private async json<T>(url: string, init: RequestInit = {}): Promise<T> {
    return (await (await this.call(url, init)).json()) as T;
  }

  private async list(q: string, fields = FIELDS): Promise<GFile[]> {
    const out: GFile[] = [];
    let page: string | undefined;
    do {
      const params = new URLSearchParams({ q, fields: `nextPageToken,files(${fields})`, pageSize: "1000", spaces: "drive" });
      if (page) params.set("pageToken", page);
      const res = await this.json<{ files?: GFile[]; nextPageToken?: string }>(`${this.api}/files?${params}`);
      out.push(...(res.files ?? []));
      page = res.nextPageToken;
    } while (page);
    return out;
  }

  private entry(g: GFile): RemoteEntry {
    return {
      id: g.id,
      name: g.name,
      parent: g.parents?.[0] ?? null,
      folder: g.mimeType === FOLDER,
      ...(g.md5Checksum ? { md5: g.md5Checksum } : {}),
      ...(g.size ? { size: Number(g.size) } : {}),
    };
  }

  async account(): Promise<string> {
    const res = await this.json<{ user?: { emailAddress?: string; displayName?: string } }>(`${this.api}/about?fields=user(emailAddress,displayName)`);
    return res.user?.emailAddress || res.user?.displayName || "Google Drive";
  }

  async findRoots(): Promise<({ id: string; name: string; modified: number } & RootInfo)[]> {
    const files = await this.list(`mimeType='${FOLDER}' and trashed=false and appProperties has { key='nularcheOrigin' and value='1' }`, `${FIELDS},appProperties,trashed`);
    return files
      .map((f) => ({ id: f.id, name: f.name, modified: Date.parse(f.modifiedTime ?? "") || 0, ...rootOf(f) }))
      .sort((a, b) => b.modified - a.modified);
  }

  async createRoot(name: string, crypto?: { salt: string; check: string }): Promise<string> {
    const appProperties: Record<string, string> = { nularcheOrigin: "1", ...(crypto ? { nularcheEnc: "1", nularcheSalt: crypto.salt, nularcheCheck: crypto.check } : {}) };
    const res = await this.json<GFile>(`${this.api}/files?fields=${FIELDS}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER, appProperties }),
    });
    return res.id;
  }

  async rootInfo(rootId: string): Promise<RootInfo | null> {
    try {
      return rootOf(await this.json<GFile>(`${this.api}/files/${encodeURIComponent(rootId)}?fields=id,trashed,appProperties`));
    } catch (e) {
      if (e instanceof DriveError && e.code === "not_found") return null;
      throw e;
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await this.call(`${this.api}/files/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch (e) {
      if (!(e instanceof DriveError && e.code === "not_found")) throw e;
    }
  }

  async listTree(rootId: string): Promise<RemoteEntry[]> {
    const files = await this.list(`trashed=false and appProperties has { key='nularcheRoot' and value='${escapeQ(rootId)}' }`);
    return files.map((f) => this.entry(f));
  }

  async createFolder(rootId: string, parent: string, name: string): Promise<RemoteEntry> {
    const res = await this.json<GFile>(`${this.api}/files?fields=${FIELDS}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent], appProperties: { nularcheRoot: rootId } }),
    });
    return this.entry(res);
  }

  async upload(rootId: string, input: { id?: string; parent: string; name: string; data: Uint8Array }): Promise<RemoteEntry> {
    const meta = input.id ? {} : { name: input.name, parents: [input.parent], appProperties: { nularcheRoot: rootId } };
    const target = input.id ? `${this.uploadApi}/files/${encodeURIComponent(input.id)}` : `${this.uploadApi}/files`;
    const method = input.id ? "PATCH" : "POST";
    if (input.data.byteLength <= MULTIPART_LIMIT) {
      const boundary = `nularche-${randomUUID()}`;
      const head = `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\ncontent-type: application/octet-stream\r\n\r\n`;
      const tail = `\r\n--${boundary}--`;
      const body = new Uint8Array([...new TextEncoder().encode(head), ...input.data, ...new TextEncoder().encode(tail)]);
      const res = await this.json<GFile>(`${target}?uploadType=multipart&fields=${FIELDS}`, {
        method,
        headers: { "content-type": `multipart/related; boundary=${boundary}` },
        body,
      });
      return this.entry(res);
    }
    // Büyük dosyalar: oturum açılır, içerik tek istekte gönderilir.
    const start = await this.call(`${target}?uploadType=resumable&fields=${FIELDS}`, {
      method,
      headers: { "content-type": "application/json; charset=UTF-8", "x-upload-content-length": String(input.data.byteLength) },
      body: JSON.stringify(meta),
    });
    const session = start.headers.get("location");
    if (!session) throw new DriveError("invalid", "Drive did not return an upload session");
    const res = await request(this.f, session, { method: "PUT", body: input.data as Uint8Array<ArrayBuffer>, headers: { "content-length": String(input.data.byteLength) } });
    return this.entry((await res.json()) as GFile);
  }

  async download(id: string): Promise<Uint8Array> {
    const res = await this.call(`${this.api}/files/${encodeURIComponent(id)}?alt=media`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async trash(id: string): Promise<void> {
    try {
      await this.call(`${this.api}/files/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trashed: true }),
      });
    } catch (e) {
      if (!(e instanceof DriveError && e.code === "not_found")) throw e;
    }
  }
}
