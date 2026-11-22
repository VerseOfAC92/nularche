// Web sürümü (nularche.verseofac.com/app) metinleri: tarayıcıdaki takvim ve Google Drive durumu. strings.ts
// sözlüğüne katılır; her iki dili de yazın.

export const STRINGS_22 = {
  "cal.untitled": { tr: "Adsız etkinlik", en: "Untitled event" },
  "cal.localCalendar": { tr: "Nularche", en: "Nularche" },
  "cal.eventGone": { tr: "Etkinlik takvimde artık yok.", en: "The event is no longer in the calendar." },
  "cal.notConnected": { tr: "Takvim hesabı bağlı değil.", en: "The calendar account isn't connected." },
  "cal.webAppleOnly": { tr: "Apple Takvim masaüstü uygulamasında bağlanır.", en: "Apple Calendar is connected in the desktop app." },
  "cal.webAppleExplain": {
    tr: "Apple Takvim web sürümünde kullanılamıyor: Apple, tarayıcıların iCloud takvim sunucusuna doğrudan bağlanmasına izin vermiyor ve Nularche'nin araya girecek bir sunucusu yok. Apple takvimlerinizi masaüstü uygulamasında bağlayın; web için ayrı bir uygulamaya özel parola gerekmez.",
    en: "Apple Calendar isn't available in the web version: Apple doesn't let browsers connect to iCloud's calendar server directly, and Nularche has no server in between. Connect your Apple calendars in the desktop app; the web version needs no separate app-specific password.",
  },
  "cal.webGoogleHint": {
    tr: "Google ile giriş yaptığınızda Google Takvim de bağlanır. Bağlı değilse aşağıdaki düğmeyle izin verin.",
    en: "Google Calendar is connected when you sign in with Google. If it isn't, allow it with the button below.",
  },
  "web.drive.title": { tr: "Google Drive", en: "Google Drive" },
  "web.drive.connected": { tr: "{account} hesabıyla bağlı. Notlar bu sekmenin belleğinde açık; değişiklikler Drive'a gönderiliyor.", en: "Connected as {account}. Your notes are open in this tab's memory; changes are sent to Drive." },
  "web.drive.encrypted": { tr: "Uçtan uca şifreli", en: "End-to-end encrypted" },
  "web.drive.plain": { tr: "Şifresiz", en: "Not encrypted" },
  "web.drive.syncing": { tr: "Eşitleniyor…", en: "Syncing…" },
  "web.drive.synced": { tr: "Son eşitleme: {time}", en: "Last synced: {time}" },
  "web.drive.error": { tr: "Eşitleme hatası: {error}", en: "Sync error: {error}" },
  "web.drive.syncNow": { tr: "Şimdi eşitle", en: "Sync now" },
  "auto.webKeyNote": {
    tr: "Web sürümünde anahtar yalnızca bu sekmenin belleğinde tutulur; kilitlediğinizde, çıkış yaptığınızda ya da sekmeyi kapattığınızda silinir.",
    en: "In the web version the key is kept only in this tab's memory and is removed when you lock, sign out or close the tab.",
  },
  "ai.emptyKey": { tr: "Anahtar boş.", en: "The key is empty." },
  "ai.noEncryption": { tr: "Anahtar saklanamıyor.", en: "The key can't be stored." },
  "ai.noOrigin": { tr: "Notlar açık değil.", en: "No notes are open." },
  "ai.keyMissingReply": {
    tr: "Gemini anahtarı bulunamadı. Ayarlar → Yapay zekâ bölümünden anahtarı yeniden girin.",
    en: "The Gemini key wasn't found. Enter it again under Settings → AI.",
  },
  "ai.noKey": { tr: "Gemini anahtarı yok.", en: "No Gemini key." },
  "ai.badRequest": { tr: "Geçersiz istek.", en: "Invalid request." },
  "ai.audioTooLarge": { tr: "Ses dosyası çok büyük (en çok 18 MB). Daha kısa bir kayıt deneyin.", en: "The audio file is too large (18 MB max). Try a shorter recording." },
  "sync.err.auth": { tr: "Google Drive erişimi sona erdi ya da geri alındı. Yeniden bağlanın.", en: "Google Drive access expired or was revoked. Connect again." },
  "sync.err.network": { tr: "Google Drive'a ulaşılamadı. İnternet bağlantınızı kontrol edin; eşitleme bağlantı gelince sürer.", en: "Google Drive could not be reached. Check your internet connection; syncing resumes when you are back online." },
  "sync.err.quota": { tr: "Google Drive'da yer kalmadı.", en: "Your Google Drive is full." },
  "sync.err.invalid": { tr: "Google Drive isteği reddetti. Bir süre sonra yeniden deneyin.", en: "Google Drive refused the request. Try again later." },
  "sync.err.empty_remote": {
    tr: "Google Drive'daki Nularche klasörü bulunamadı ya da boş görünüyor; hiçbir notunuz silinmesin diye eşitleme durduruldu.",
    en: "The Nularche folder in Google Drive can't be found or looks empty; syncing stopped so that none of your notes is removed.",
  },
  "sync.err.wrong_key": { tr: "Google Drive'daki bir dosya bu parolayla çözülemedi.", en: "A file in Google Drive could not be decrypted with this passphrase." },
  "sync.err.mass_delete": {
    tr: "Bu cihazda {n} dosya silindi; onay verilene kadar Google Drive'dan silinmedi.",
    en: "{n} files were deleted on this device; they were not deleted from Google Drive until you confirm.",
  },
  "web.lock": { tr: "Kilitle", en: "Lock" },
  "web.lockHint": { tr: "Değişiklikleri gönderir ve notları bu sekmenin belleğinden siler", en: "Sends your changes and removes your notes from this tab's memory" },
  "web.signOut": { tr: "Çıkış yap", en: "Sign out" },
  "web.signOutConfirm": { tr: "Çıkış yapılsın mı? Değişiklikler gönderilir, notlar bu tarayıcıdan silinir ve Google oturumu kapanır.", en: "Sign out? Your changes are sent, your notes are removed from this browser and the Google session ends." },
  "web.idleTitle": { tr: "Bu tarayıcıda kilitle", en: "Lock in this browser" },
  "web.idleHint": { tr: "Bu süre hareketsiz kalınca web oturumu kilitlenir: değişiklikler gönderilir, notlar bellekten silinir.", en: "After this much inactivity the web session locks: changes are sent and your notes are removed from memory." },
} as const;
