// Masaüstü süreci metinleri (menüler, iletişim kutuları, AI köprüsü mesajları). Dil, Ayarlar'da
// seçilene göre değişir; seçilmemişse sistem dili Türkçe ise Türkçe, değilse İngilizce kullanılır.

export type Lang = "tr" | "en";

const STRINGS = {
  "menu.file": { tr: "Dosya", en: "File" },
  "menu.openOrigin": { tr: "Başka Origin aç…", en: "Open Another Origin…" },
  "menu.revealOrigin": { tr: "Origin klasörünü göster", en: "Show Origin Folder" },
  "menu.importArchive": { tr: "Arşiv içe aktar (.nla / .nlc)…", en: "Import Archive (.nla / .nlc)…" },
  "menu.exportOrigin": { tr: "Origin'i dışa aktar (.nla)…", en: "Export Origin (.nla)…" },
  "menu.closeWindow": { tr: "Pencereyi kapat", en: "Close Window" },
  "menu.quit": { tr: "Çık", en: "Quit" },
  "menu.edit": { tr: "Düzen", en: "Edit" },
  "menu.view": { tr: "Görünüm", en: "View" },
  "menu.go": { tr: "Git", en: "Go" },
  "menu.window": { tr: "Pencere", en: "Window" },
  "menu.help": { tr: "Yardım", en: "Help" },
  "menu.github": { tr: "GitHub sayfası", en: "GitHub Page" },
  "menu.issue": { tr: "Sorun bildir", en: "Report an Issue" },
  "warn.rosetta": {
    tr: "Bu Mac Apple Silicon işlemcili ama Nularche'nin Intel sürümü kurulu. Daha hızlı çalışması ve gelecekteki macOS sürümlerinde açılabilmesi için Apple Silicon sürümünü kurun.",
    en: "This Mac has an Apple Silicon chip, but the Intel version of Nularche is installed. Install the Apple Silicon version so it runs faster and keeps opening on future macOS versions.",
  },
  "warn.translocated": {
    tr: "Nularche disk görüntüsünden ya da karantinadaki bir konumdan çalışıyor. Yapay zekâ bağlantısının kalıcı olması için önce uygulamayı Uygulamalar klasörüne taşıyıp oradan açın.",
    en: "Nularche is running from a disk image or a quarantined location. For the AI connection to last, first move the app to the Applications folder and open it from there.",
  },
  "origin.useDefault": { tr: "Varsayılan Origin'i kullan", en: "Use Default Origin" },
  "origin.pick": { tr: "Klasör seç…", en: "Choose Folder…" },
  "origin.useLegacy": { tr: "Mevcut notları kullan", en: "Use Existing Notes" },
  "origin.question": { tr: "Origin'iniz nerede olsun?", en: "Where should your Origin be?" },
  "origin.detail": {
    tr: "Origin, tüm Node'larınızın düz Markdown (.md) dosyaları olarak durduğu ana veri kasasıdır.\n\nVarsayılan: {dir}",
    en: "The Origin is the main vault where all your Nodes live as plain Markdown (.md) files.\n\nDefault: {dir}",
  },
  "origin.legacy": { tr: "\nMevcut notlar: {dir}", en: "\nExisting notes: {dir}" },
  "origin.notOrigin": { tr: "Bu klasör bir Nularche Origin'i gibi görünmüyor.", en: "This folder doesn't look like a Nularche Origin." },
  "origin.notOriginDetail": {
    tr: "{dir}\n\nKlasörde {files} gibi başka dosyalar var. Nularche buradaki .md dosyalarını Node olarak gösterir ve uygulamada düzenlediğiniz dosyaların başına kimlik bilgisi (frontmatter) ekler. Notlarınız için boş ya da yalnızca notlardan oluşan bir klasör seçmeniz önerilir.",
    en: "{dir}\n\nThe folder contains other files such as {files}. Nularche shows the .md files here as Nodes and adds identity metadata (frontmatter) to the top of files you edit in the app. Choosing an empty folder, or one that only holds notes, is recommended.",
  },
  "origin.pickOther": { tr: "Başka klasör seç", en: "Choose Another Folder" },
  "origin.useAnyway": { tr: "Yine de kullan", en: "Use Anyway" },
  "common.cancel": { tr: "Vazgeç", en: "Cancel" },
  "origin.pickTitle": { tr: "Origin klasörünü seçin", en: "Choose the Origin folder" },
  "link.otherOrigin": { tr: "Bu bağlantı başka bir Origin'e ait.", en: "This link belongs to another Origin." },
  "link.otherOriginDetail": {
    tr: "Bağlantının ait olduğu Origin'i Dosya → Başka Origin aç ile açın.",
    en: "Open the Origin it belongs to with File → Open Another Origin.",
  },
  "archive.importQuestion": { tr: "“{name}” içe aktarılsın mı?", en: "Import “{name}”?" },
  "archive.importDetail": {
    tr: "Arşivdeki Node'lar Shadow gelen kutusuna eklenir; mevcut Node'lara dokunulmaz.",
    en: "The archive's Nodes are added to the Shadow inbox; existing Nodes are left untouched.",
  },
  "archive.import": { tr: "İçe aktar", en: "Import" },
  "archive.pickTitle": { tr: "Arşiv seçin", en: "Choose an archive" },
  "archive.filter": { tr: "Nularche arşivi", en: "Nularche archive" },
  "rosetta.message": { tr: "Bu Mac için doğru sürüm kurulu değil", en: "The right version for this Mac isn't installed" },
  "rosetta.detail": {
    tr: "Mac'iniz Apple Silicon (M serisi) işlemcili, ancak Nularche'nin Intel sürümü kurulu ve Rosetta ile çalışıyor. macOS'un gelecek sürümleri Intel uygulamalarını açmayacak. Lütfen “Apple Silicon” sürümünü indirip kurun; notlarınız ve ayarlarınız korunur.",
    en: "Your Mac has an Apple Silicon (M-series) chip, but the Intel version of Nularche is installed and running under Rosetta. Future macOS versions won't open Intel apps. Please download and install the “Apple Silicon” version; your notes and settings are kept.",
  },
  "rosetta.download": { tr: "Apple Silicon sürümünü indir", en: "Download Apple Silicon Version" },
  "rosetta.later": { tr: "Şimdilik devam et", en: "Continue for Now" },
  "export.siteFolder": { tr: "Sitenin yazılacağı klasörü seçin", en: "Choose a folder for the website" },
  "export.siteButton": { tr: "Siteyi buraya oluştur", en: "Create site here" },
  "start.failed": { tr: "Nularche başlatılamadı", en: "Nularche couldn't start" },
  "cal.untitled": { tr: "Adsız etkinlik", en: "Untitled event" },
  "cal.notConnected": { tr: "Takvim hesabı bu bilgisayarda bağlı değil.", en: "The calendar account isn't connected on this computer." },
  "cal.missingClient": { tr: "İstemci kimliği ve istemci gizli anahtarını girin.", en: "Enter the client ID and client secret." },
  "cal.missingApple": { tr: "Apple Kimliği ve uygulamaya özel parolayı girin.", en: "Enter your Apple ID and app-specific password." },
  "cal.authDone": { tr: "Nularche Google Takvim'e bağlandı.", en: "Nularche is connected to Google Calendar." },
  "cal.authFailed": { tr: "Google Takvim bağlantısı kurulamadı.", en: "Couldn't connect to Google Calendar." },
  "cal.authTimeout": { tr: "Google girişi zaman aşımına uğradı; yeniden deneyin.", en: "Google sign-in timed out; try again." },
  "cal.closeTab": { tr: "Bu sekmeyi kapatıp Nularche'ye dönebilirsiniz.", en: "You can close this tab and return to Nularche." },
  "ai.notInstalled": { tr: "{name} kurulu değil; indirme sayfası açıldı.", en: "{name} isn't installed; the download page was opened." },
  "ai.cantOpen": {
    tr: "{name} bu sistemde otomatik açılamıyor; uygulamayı kendiniz açın (istem panoya kopyalandı).",
    en: "{name} can't be opened automatically on this system; open the app yourself (the prompt was copied to the clipboard).",
  },
  "ai.notFound": { tr: "{name} bulunamadı; kurulum sayfası açıldı.", en: "{name} wasn't found; the install page was opened." },
  "ai.unknownConnection": { tr: "Bilinmeyen bağlantı", en: "Unknown connection" },
  "ai.isOpen": { tr: "{name} açık.", en: "{name} is open." },
  "ai.cantQuit": {
    tr: "{name} kapatılamadı; lütfen kendiniz kapatıp tekrar deneyin.",
    en: "Couldn't quit {name}; please quit it yourself and try again.",
  },
  "ai.unknownTool": { tr: "Bilinmeyen araç", en: "Unknown app" },
  "ai.cantQuitClaude": {
    tr: "Claude Desktop kapatılamadı; lütfen kendiniz kapatıp yeniden açın.",
    en: "Couldn't quit Claude Desktop; please quit and reopen it yourself.",
  },
  "ai.emptyKey": { tr: "Anahtar boş.", en: "The key is empty." },
  "ai.noEncryption": { tr: "Bu sistemde güvenli anahtar saklama kullanılamıyor.", en: "Secure key storage isn't available on this system." },
  "ai.noOrigin": { tr: "Origin açık değil.", en: "No Origin is open." },
  "ai.keyMissingReply": {
    tr: "Gemini anahtarı bulunamadı. Ayarlar → Yapay zekâ → Otomatik mod bölümünden anahtarı yeniden girin.",
    en: "The Gemini key wasn't found. Enter it again under Settings → AI → Automatic mode.",
  },
  "ai.noKey": { tr: "Gemini anahtarı yok.", en: "No Gemini key." },
  "ai.badRequest": { tr: "Geçersiz istek.", en: "Invalid request." },
  "ai.audioTooLarge": { tr: "Ses dosyası çok büyük (en çok 18 MB). Daha kısa bir kayıt deneyin.", en: "The audio file is too large (18 MB max). Try a shorter recording." },
  "menu.format": { tr: "Biçim", en: "Format" },
  "menu.keepOnTop": { tr: "En üstte tut", en: "Keep on Top" },
  "import.filesTitle": { tr: "İçe aktarılacak notları seçin", en: "Choose notes to import" },
  "import.folderTitle": { tr: "İçe aktarılacak klasörü seçin", en: "Choose a folder to import" },
  "import.filter": { tr: "Notlar (Markdown, metin, HTML, RTF)", en: "Notes (Markdown, text, HTML, RTF)" },
  "import.tooMany": { tr: "Klasör çok büyük (en çok 3000 dosya / 300 MB).", en: "The folder is too large (3000 files / 300 MB max)." },
} as const satisfies Record<string, Record<Lang, string>>;

export type DesktopStringKey = keyof typeof STRINGS;

let current: Lang = "en";

export function setDesktopLang(lang: Lang): void {
  current = lang;
}

export function desktopLang(): Lang {
  return current;
}

export function systemLang(locale: string): Lang {
  return locale.toLowerCase().startsWith("tr") ? "tr" : "en";
}

export function isLang(value: unknown): value is Lang {
  return value === "tr" || value === "en";
}

export function d(key: DesktopStringKey, vars?: Record<string, string | number>): string {
  let s: string = STRINGS[key][current];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
