// Çekirdek hataları: her hata bir neden kodu (reason) ve yer tutucu değerleri (vars) taşır; metnin iki dili de
// burada tek yerde durur. Sunucu nedeni ve değerleri API cevabına koyar, arayüz kullanıcının seçtiği dilde gösterir.
// `message` Türkçedir; yapay zekâ araçları (MCP, Nularche AI) ve günlükler onu okur.

type V = Record<string, string | number>;
type Text = { tr: (v: V) => string; en: (v: V) => string };

export const NODE_ERROR_TEXT = {
  // İstek
  invalid_json: { tr: () => "Geçersiz JSON", en: () => "Invalid JSON" },
  body_too_large: { tr: () => "İstek gövdesi çok büyük", en: () => "The request body is too large" },
  unknown_endpoint: { tr: () => "Bilinmeyen uç nokta", en: () => "Unknown endpoint" },
  snapshots_unavailable: { tr: () => "Anlık görüntüler bu sürümde yok.", en: () => "Snapshots aren't available in this version." },
  pdf_not_found: { tr: () => "PDF bulunamadı", en: () => "PDF not found" },
  // Node ve yollar
  node_not_found: { tr: (v) => `Node bulunamadı: ${v.ref}`, en: (v) => `Node not found: ${v.ref}` },
  invalid_id: { tr: (v) => `Geçersiz id: ${v.id}`, en: (v) => `Invalid id: ${v.id}` },
  invalid_path: { tr: (v) => `Geçersiz yol: ${v.path}`, en: (v) => `Invalid path: ${v.path}` },
  path_outside_vault: { tr: (v) => `Yol vault dışında: ${v.path}`, en: (v) => `The path is outside the vault: ${v.path}` },
  hidden_path: { tr: (v) => `Gizli yol kullanılamaz: ${v.path}`, en: (v) => `Hidden paths can't be used: ${v.path}` },
  title_empty: { tr: () => "Başlık boş olamaz", en: () => "The title can't be empty" },
  name_empty: { tr: () => "Ad boş olamaz", en: () => "The name can't be empty" },
  stale_revision: {
    tr: () => "Node siz okuduktan sonra değişmiş; yeniden okuyup tekrar deneyin.",
    en: () => "The Node changed after you read it; read it again and retry.",
  },
  target_exists: { tr: (v) => `Hedef zaten var: ${v.path}`, en: (v) => `The target already exists: ${v.path}` },
  file_exists: { tr: (v) => `Dosya zaten var: ${v.path}`, en: (v) => `The file already exists: ${v.path}` },
  property_name_invalid: { tr: (v) => `Bu özellik adı kullanılamaz: ${v.name}`, en: (v) => `This property name can't be used: ${v.name}` },
  unknown_field: { tr: (v) => `Bilinmeyen alan: ${v.name}`, en: (v) => `Unknown field: ${v.name}` },
  move_into_self: { tr: () => "Bir Node kendi altına taşınamaz", en: () => "A Node can't be moved under itself" },
  invalid_trash_entry: { tr: (v) => `Geçersiz çöp öğesi: ${v.entry}`, en: (v) => `Invalid trash item: ${v.entry}` },
  trash_not_found: { tr: (v) => `Çöpte bulunamadı: ${v.entry}`, en: (v) => `Not found in the trash: ${v.entry}` },
  mention_not_found: { tr: () => "Bağlantısız anılış bulunamadı.", en: () => "The unlinked mention wasn't found." },
  merge_self: { tr: () => "Bir not kendisiyle birleştirilemez.", en: () => "A note can't be merged with itself." },
  merge_locked: { tr: () => "Kilitli notlar birleştirilemez.", en: () => "Locked notes can't be merged." },
  merge_has_children: { tr: () => "Alt sayfası olan bir not birleştirilemez.", en: () => "A note with subpages can't be merged." },
  checkpoint_limit: {
    tr: (v) => `En fazla ${v.max} Epoch saklanır; önce birini silin.`,
    en: (v) => `At most ${v.max} Epochs are kept; delete one first.`,
  },
  invalid_time: { tr: () => "Geçersiz zaman.", en: () => "Invalid time." },
  snapshot_not_found: { tr: () => "Anlık görüntü bulunamadı.", en: () => "The snapshot wasn't found." },
  not_wiki: { tr: () => "Bu sayfa bir Lore değil.", en: () => "This page isn't a Lore." },
  not_manuscript: { tr: () => "Bu sayfa bir Codex değil.", en: () => "This page isn't a Codex." },
  manuscript_broken: { tr: () => "Codex verisi bozuk.", en: () => "The Codex data is damaged." },
  invalid_tag: { tr: (v) => `Geçersiz etiket: ${v.tag}`, en: (v) => `Invalid tag: ${v.tag}` },
  attachment_not_found: { tr: (v) => `Ek bulunamadı: ${v.path}`, en: (v) => `Attachment not found: ${v.path}` },
  // Strata (anlık görüntüler)
  strata_key_size: { tr: () => "Anlık görüntü anahtarı 32 bayt olmalı.", en: () => "The snapshot key must be 32 bytes." },
  strata_unknown_data: { tr: () => "Tanınmayan anlık görüntü verisi.", en: () => "Unrecognised snapshot data." },
  strata_no_key: {
    tr: () => "Bu anlık görüntü şifreli; anahtarı bu bilgisayarda yok.",
    en: () => "This snapshot is encrypted; its key isn't on this computer.",
  },
  strata_wrong_key: {
    tr: () => "Anlık görüntü bu bilgisayarın anahtarıyla açılamadı.",
    en: () => "The snapshot couldn't be opened with this computer's key.",
  },
  strata_bad_object: { tr: () => "Geçersiz nesne adı.", en: () => "Invalid object name." },
  strata_part_missing: { tr: () => "Anlık görüntünün bir parçası eksik.", en: () => "Part of the snapshot is missing." },
  strata_invalid_id: { tr: (v) => `Geçersiz anlık görüntü: ${v.id}`, en: (v) => `Invalid snapshot: ${v.id}` },
  strata_not_found: { tr: (v) => `Anlık görüntü bulunamadı: ${v.id}`, en: (v) => `Snapshot not found: ${v.id}` },
  strata_bad_list: { tr: () => "Bozuk anlık görüntü listesi.", en: () => "Damaged snapshot list." },
  strata_file_missing: { tr: (v) => `Bu anlık görüntüde yok: ${v.path}`, en: (v) => `Not in this snapshot: ${v.path}` },
  // Crypta (tam şifreli Arche)
  crypta_not_full: { tr: () => "Bu Arche tam şifreli değil.", en: () => "This Arche isn't fully encrypted." },
  crypta_locked: { tr: () => "Şifreli Arche kilitli; önce parolasıyla açın.", en: () => "The encrypted Arche is locked; open it with its password first." },
  // Marginalia
  comment_needs_quote: { tr: () => "Yorum için metin seçilmeli.", en: () => "Select some text to comment on." },
  comment_locked: { tr: () => "Kilitli notlara yorum eklenemez ve okunamaz.", en: () => "Comments on locked notes can't be added or read." },
  comment_empty: { tr: () => "Yorum boş olamaz.", en: () => "The comment can't be empty." },
  comment_limit: { tr: (v) => `Bir notta en fazla ${v.max} yorum olabilir.`, en: (v) => `A note can have at most ${v.max} comments.` },
  comment_not_found: { tr: () => "Yorum bulunamadı.", en: () => "The comment wasn't found." },
  reply_empty: { tr: () => "Yanıt boş olamaz.", en: () => "The reply can't be empty." },
  reply_limit: { tr: () => "Bu yoruma daha fazla yanıt eklenemez.", en: () => "No more replies can be added to this comment." },
  quote_not_in_note: { tr: () => "Alıntı notta birebir geçmeli.", en: () => "The quote must appear in the note exactly." },
  // Ark (arşiv)
  archive_too_large: { tr: () => "Arşiv çok büyük", en: () => "The archive is too large" },
  archive_unreadable: {
    tr: () => "Geçerli bir Nularche arşivi değil (ZIP okunamadı)",
    en: () => "Not a valid Nularche archive (the ZIP couldn't be read)",
  },
  archive_no_manifest: { tr: () => "Arşivde manifest.json yok ya da bozuk", en: () => "The archive's manifest.json is missing or damaged" },
  archive_invalid: { tr: () => "Geçerli bir Nularche arşivi değil", en: () => "Not a valid Nularche archive" },
  archive_newer: {
    tr: (v) => `Bu arşiv daha yeni bir Nularche sürümüyle oluşturulmuş (biçim ${v.version})`,
    en: (v) => `This archive was made by a newer Nularche version (format ${v.version})`,
  },
  archive_empty: { tr: () => "Arşivde Node yok", en: () => "The archive has no Nodes" },
  // Conduit (yakalama)
  capture_not_accepted: { tr: () => "Bu sayfa bu tür bir yakalamayı kabul etmiyor.", en: () => "This page doesn't accept this kind of capture." },
  cards_broken: { tr: () => "Mosaic verisi bozuk; önce düzeltin.", en: () => "The Mosaic data is damaged; fix it first." },
  outline_broken: { tr: () => "Axis verisi bozuk; önce düzeltin.", en: () => "The Axis data is damaged; fix it first." },
  only_shadow_notes: { tr: () => "Yalnızca Shadow'daki notlar taşınabilir.", en: () => "Only notes in Shadow can be moved." },
  move_locked: { tr: () => "Kilitli not taşınamaz.", en: () => "A locked note can't be moved." },
  capture_kind_required: { tr: () => "Yakalama türü seçilmeli.", en: () => "Choose a capture type." },
  capture_target_missing: { tr: () => "Hedef sayfa bulunamadı; bir hedef seçin.", en: () => "The target page wasn't found; choose a target." },
  // Takvim
  calendar_view_link: { tr: () => "Görüntüleme bağlantısı veritabanıyla eşitlenmez.", en: () => "A view-only link isn't synced with a database." },
  date_property_missing: { tr: (v) => `Tarih özelliği bulunamadı: ${v.name}`, en: (v) => `Date property not found: ${v.name}` },
  // Veritabanı
  not_database: { tr: (v) => `Bu Node bir veritabanı değil: ${v.title}`, en: (v) => `This Node isn't a database: ${v.title}` },
  not_database_row: { tr: () => "Bu Node bir veritabanı satırı değil", en: () => "This Node isn't a database row" },
  unknown_property: { tr: (v) => `Bilinmeyen özellik: ${v.name}`, en: (v) => `Unknown property: ${v.name}` },
  expects_number: { tr: (v) => `“${v.name}” bir sayı bekliyor`, en: (v) => `“${v.name}” expects a number` },
  expects_date: { tr: (v) => `“${v.name}” 2026-10-17 gibi bir tarih bekliyor`, en: (v) => `“${v.name}” expects a date like 2026-10-17` },
  computed_property: { tr: (v) => `“${v.name}” hesaplanır, elle değiştirilemez`, en: (v) => `“${v.name}” is computed and can't be set` },
  // Nularche AI
  request_id_invalid: { tr: (v) => `Geçersiz istek kimliği: ${v.id}`, en: (v) => `Invalid request id: ${v.id}` },
  request_empty: { tr: () => "İstek boş olamaz", en: () => "The request can't be empty" },
  request_not_found: { tr: () => "İstek bulunamadı", en: () => "The request wasn't found" },
  request_done: { tr: () => "Tamamlanmış istek yeniden denenemez", en: () => "A finished request can't be retried" },
  ai_note_locked: {
    tr: () => "Bu not kilitli; yapay zekâ kilitli notları okuyamaz ve değiştiremez.",
    en: () => "This note is locked; AI can't read or change locked notes.",
  },
  ai_read_only: {
    tr: () => "Bu istek yalnızca cevap istiyor; notlar değiştirilemez.",
    en: () => "This request only asks for an answer; notes can't be changed.",
  },
  ai_note_changed: {
    tr: () => "Not bu arada değişti; read_node ile yeniden oku (blok numaraları değişmiş olabilir).",
    en: () => "The note changed meanwhile; read it again with read_node (block numbers may have changed).",
  },
  ai_rearrange: { tr: (v) => `Bloklar yeniden düzenlenemedi: ${v.detail}`, en: (v) => `The blocks couldn't be rearranged: ${v.detail}` },
  unknown_tool: { tr: (v) => `Bilinmeyen araç: ${v.name}`, en: (v) => `Unknown tool: ${v.name}` },
  argument_required: { tr: (v) => `${v.name} gerekli.`, en: (v) => `${v.name} is required.` },
  // Yapay zekâ uygulaması bağlantısı (masaüstü)
  config_bad_json: {
    tr: (v) => `Yapılandırma dosyası okunamadı (geçerli JSON değil): ${v.file}. Dosyayı düzeltmeden bağlantı yazılmaz.`,
    en: (v) => `The configuration file couldn't be read (not valid JSON): ${v.file}. The connection isn't written until the file is fixed.`,
  },
  config_bad_toml: {
    tr: (v) => `Yapılandırma dosyası okunamadı (geçerli TOML değil): ${v.file}. Dosyayı düzeltmeden bağlantı yazılmaz. (${v.detail})`,
    en: (v) =>
      `The configuration file couldn't be read (not valid TOML): ${v.file}. The connection isn't written until the file is fixed. (${v.detail})`,
  },
  app_must_close: {
    tr: (v) => `${v.name} açık. Ayarlarını kapanışta yeniden yazdığı için önce tamamen kapatın (macOS: ⌘Q), sonra tekrar deneyin.`,
    en: (v) => `${v.name} is open. It rewrites its settings when it quits, so quit it completely first (macOS: ⌘Q), then try again.`,
  },
  claude_code_missing: {
    tr: () => "Claude Code bulunamadı. Önce Claude Code'u kurun ya da gösterilen komutu terminalde çalıştırın.",
    en: () => "Claude Code wasn't found. Install Claude Code first, or run the command shown in a terminal.",
  },
  config_entry_differs: {
    tr: (v) => `${v.file} dosyasında "${v.name}" farklı bir biçimde tanımlı; lütfen o satırları elle kaldırıp tekrar deneyin.`,
    en: (v) => `"${v.name}" is defined differently in ${v.file}; remove those lines by hand and try again.`,
  },
  toml_verify_failed: {
    tr: () => "TOML yazımı doğrulanamadı; dosyaya dokunulmadı.",
    en: () => "The TOML write couldn't be verified; the file wasn't touched.",
  },
  no_terminal: {
    tr: () => "Terminal bulunamadı. İstem panoya kopyalandı; aracı kendi terminalinizde açıp yapıştırın.",
    en: () => "No terminal was found. The prompt was copied to the clipboard; open the tool in your own terminal and paste it.",
  },
  // Anamnesis
  invalid_grade: { tr: () => "Geçersiz kart ya da değerlendirme", en: () => "Invalid card or grade" },
  // Dışa aktarma
  export_locked: {
    tr: () => "Kilitli not dışa aktarılamaz; önce kilidi kaldırın.",
    en: () => "A locked note can't be exported; remove the lock first.",
  },
  nothing_to_publish: {
    tr: () => "Yayınlanacak sayfa yok: bir sayfanın ⋯ menüsünden “Web'de yayınla”yı açın.",
    en: () => "Nothing to publish: turn on “Publish to web” in a page's ⋯ menu.",
  },
} satisfies Record<string, Text>;

export type NodeErrorReason = keyof typeof NODE_ERROR_TEXT;
export type NodeErrorCode = "not_found" | "conflict" | "invalid";
export type ErrorLang = "tr" | "en";

/** Bilinen bir neden kodunun metni; bilinmeyen kodlarda undefined (çağıran ham metne düşer). */
export function nodeErrorText(reason: unknown, vars: unknown, lang: ErrorLang): string | undefined {
  if (typeof reason !== "string" || !Object.hasOwn(NODE_ERROR_TEXT, reason)) return undefined;
  const v = vars && typeof vars === "object" && !Array.isArray(vars) ? (vars as V) : {};
  return (NODE_ERROR_TEXT as Record<string, Text>)[reason][lang](v);
}

export class NodeError extends Error {
  readonly code: NodeErrorCode;
  readonly reason: NodeErrorReason;
  readonly vars: V;
  readonly details?: Record<string, unknown>;
  constructor(code: NodeErrorCode, reason: NodeErrorReason, vars: V = {}, details?: Record<string, unknown>) {
    super(NODE_ERROR_TEXT[reason].tr(vars));
    this.name = "NodeError";
    this.code = code;
    this.reason = reason;
    this.vars = vars;
    this.details = details;
  }
}

/** Kullanıcıya gösterilecek hata metni, verilen dilde. Neden kodu taşıyan her hata (NodeError, SnapshotError,
 *  ConnectionError, API cevabından kurulan istemci hatası) çevrilir; diğerlerinde ham metin gösterilir. */
export function describeError(err: unknown, lang: ErrorLang): string {
  if (err && typeof err === "object") {
    const text = nodeErrorText((err as { reason?: unknown }).reason, (err as { vars?: unknown }).vars, lang);
    if (text !== undefined) return text;
  }
  return err instanceof Error ? err.message : String(err);
}
