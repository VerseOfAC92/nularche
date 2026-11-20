// Depolama (bu bilgisayar ya da Google Drive) ve tek tıkla Google girişi metinleri. strings.ts sözlüğüne katılır;
// her iki dili de yazın.

export const STRINGS_19 = {
  "storage.step": { tr: "Depolama", en: "Storage" },
  "storage.title": { tr: "Notlarınız nerede saklansın?", en: "Where should Nularche keep your notes?" },
  "storage.intro": {
    tr: "Notlarınız, ekleriniz ve ayarlarınız her zaman düz dosyalar olarak sizde kalır. Bu seçimi istediğiniz zaman Ayarlar → Notlar ve Origin bölümünden değiştirebilirsiniz.",
    en: "Your notes, attachments and settings always stay with you as plain files. You can change this any time in Settings → Notes and Origin.",
  },
  "storage.cardTitle": { tr: "Depolama", en: "Storage" },
  "storage.cardHint": { tr: "Notların, eklerin ve ayarların durduğu yer.", en: "Where your notes, attachments and settings are kept." },
  "storage.local": { tr: "Bu bilgisayar", en: "This computer" },
  "storage.localText": {
    tr: "Her şey bu bilgisayardaki bir klasörde durur. İnternet bağlantısı gerekmez.",
    en: "Everything lives in a folder on this computer. No internet connection needed.",
  },
  "storage.drive": { tr: "Google Drive", en: "Google Drive" },
  "storage.driveText": {
    tr: "Her şey bu bilgisayarda hızlıca çalışır ve Google Drive'ınızdaki Nularche klasörüyle eşitlenir. Başka bir bilgisayarda Google ile giriş yapınca aynı notlar gelir.",
    en: "Everything runs quickly on this computer and stays in sync with a Nularche folder in your Google Drive. Sign in with Google on another computer and the same notes are there.",
  },
  "storage.selected": { tr: "Seçili", en: "Selected" },
  "storage.folder": { tr: "Klasör", en: "Folder" },
  "storage.changeFolder": { tr: "Başka klasör seç…", en: "Choose another folder…" },
  "storage.reveal": { tr: "Klasörü göster", en: "Show folder" },
  "storage.connectDrive": { tr: "Google ile bağlan", en: "Continue with Google" },
  "storage.driveOnly": {
    tr: "Nularche, Drive'ınızda yalnızca kendi oluşturduğu Nularche klasörünü görür; diğer dosyalarınıza erişmez.",
    en: "Nularche only sees the Nularche folder it creates in your Drive, never your other files.",
  },
  "storage.connected": { tr: "Bağlı", en: "Connected" },
  "storage.syncing": { tr: "Eşitleniyor…", en: "Syncing…" },
  "storage.lastSync": { tr: "Son eşitleme: {time}", en: "Last synced {time}" },
  "storage.neverSynced": { tr: "Henüz eşitlenmedi", en: "Not synced yet" },
  "storage.syncNow": { tr: "Şimdi eşitle", en: "Sync now" },
  "storage.stopDrive": { tr: "Google Drive eşitlemesini kapat", en: "Stop syncing with Google Drive" },
  "storage.stopConfirm": {
    tr: "Google Drive eşitlemesi kapatılsın mı? Notlarınız bu bilgisayarda ve Google Drive'da olduğu gibi kalır; yalnızca birbirleriyle eşitlenmez.",
    en: "Stop syncing with Google Drive? Your notes stay as they are on this computer and in Google Drive; they just won't sync with each other any more.",
  },
  "storage.useLocal": { tr: "Bu bilgisayarı kullan", en: "Use this computer" },
  "storage.unavailable": {
    tr: "Bu derlemede Google bağlantısı yapılandırılmamış.",
    en: "Google sign-in isn't configured in this build.",
  },
  "storage.linkedNew": { tr: "Google Drive'a bağlandı: notlarınız Drive'daki Nularche klasörüne eşitleniyor.", en: "Connected to Google Drive: your notes are syncing to the Nularche folder in your Drive." },
  "storage.linkedExisting": { tr: "Google Drive'a bağlandı: Drive'daki Nularche notlarınız bu bilgisayara getirildi.", en: "Connected to Google Drive: your Nularche notes from Drive are now on this computer." },
  "storage.stopped": { tr: "Google Drive eşitlemesi kapatıldı.", en: "Stopped syncing with Google Drive." },
  "storage.synced": { tr: "Google Drive ile eşitlendi.", en: "Synced with Google Drive." },
  "storage.syncError": { tr: "Eşitlenemedi: {error}", en: "Couldn't sync: {error}" },
  "storage.conflicts": {
    tr: "{n} not iki yerde birden değişmişti; diğer hâli adında “conflict” geçen bir kopya olarak saklandı.",
    en: "{n} note(s) changed in two places; the other version was kept as a copy with “conflict” in its name.",
  },
  "storage.browserOnly": { tr: "Depolama seçimi masaüstü uygulamasında yapılır.", en: "Storage is chosen in the desktop app." },
  "google.browserHint": {
    tr: "Tarayıcınızda Google girişi açıldı. Hesabınızı seçip izin verin, sonra buraya dönün.",
    en: "Google sign-in opened in your browser. Pick your account, allow access, then come back here.",
  },
  "cal.googleOneClick": { tr: "Google ile bağlan", en: "Continue with Google" },
} as const;
