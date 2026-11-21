// Web sürümü (nularche.verseofac.com/app) metinleri: tarayıcıdaki takvim ve Google Drive durumu. strings.ts
// sözlüğüne katılır; her iki dili de yazın.

export const STRINGS_22 = {
  "cal.untitled": { tr: "Adsız etkinlik", en: "Untitled event" },
  "cal.localCalendar": { tr: "Nularche", en: "Nularche" },
  "cal.eventGone": { tr: "Etkinlik takvimde artık yok.", en: "The event is no longer in the calendar." },
  "cal.notConnected": { tr: "Takvim hesabı bağlı değil.", en: "The calendar account isn't connected." },
  "cal.webAppleOnly": { tr: "Apple Takvim masaüstü uygulamasında bağlanır.", en: "Apple Calendar is connected in the desktop app." },
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
  "web.lock": { tr: "Kilitle", en: "Lock" },
  "web.lockHint": { tr: "Değişiklikleri gönderir ve notları bu sekmenin belleğinden siler", en: "Sends your changes and removes your notes from this tab's memory" },
  "web.signOut": { tr: "Çıkış yap", en: "Sign out" },
  "web.signOutConfirm": { tr: "Çıkış yapılsın mı? Değişiklikler gönderilir, notlar bu tarayıcıdan silinir ve Google oturumu kapanır.", en: "Sign out? Your changes are sent, your notes are removed from this browser and the Google session ends." },
  "web.idleTitle": { tr: "Bu tarayıcıda kilitle", en: "Lock in this browser" },
  "web.idleHint": { tr: "Bu süre hareketsiz kalınca web oturumu kilitlenir: değişiklikler gönderilir, notlar bellekten silinir.", en: "After this much inactivity the web session locks: changes are sent and your notes are removed from memory." },
} as const;
