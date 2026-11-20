# Nularche Privacy Policy

*Last updated: 20 November 2026*

Nularche is a free, open-source notes app that runs on your own computer. It is made by VerseOfAC
(verseofac@gmail.com). This policy explains what happens to your data when you use Nularche, including
when you connect Google Drive or Google Calendar.

## The short version

- Nularche has **no servers, no accounts and no analytics**. We never receive your notes, files,
  calendars, passwords or Google data.
- Everything Nularche stores is on **your computer**, in the folder you choose, as ordinary files.
- When you connect Google Drive, Google Calendar, Apple iCloud Calendar or an AI service, Nularche on your
  computer talks **directly** to that service. Nothing passes through us.

## Data stored on your computer

- **Notes, attachments and settings** are plain files in your Nularche folder (your "Origin").
- **Sign-in tokens** for Google and app-specific passwords for Apple are encrypted with your operating
  system's credential store (Keychain on macOS, DPAPI on Windows, libsecret on Linux) and stay on that
  computer. They are never written to your notes folder or sent anywhere except to the service they belong to.
- **AI keys** you enter (for example a Gemini API key) are stored the same way.

You can delete all of this at any time by disconnecting the account in Settings and deleting your Nularche
folder.

## Google Drive

If you choose Google Drive as storage, Nularche asks for the `drive.file` permission only. With it,
Nularche can see and change **only the Nularche folder and the files it creates** in your Drive. It cannot
see any other file in your Drive.

Nularche uses this access solely to keep your Nularche folder on your computer and the Nularche folder in your
Drive in sync, so that the same notes appear on your other computers. Files you delete in Nularche are moved
to your Drive trash; you can restore them from there.

## Google Calendar

If you connect Google Calendar, Nularche asks for permission to read your calendar list and to read and change
events. Nularche uses this access solely to show your calendars on its Calendar page and to create, edit or
delete events when you do so in Nularche. If you choose to sync a Nularche table with a calendar, dated rows
and events are kept in step. Event data stays on your computer (in your Nularche folder) and in your Google
Calendar.

## Use of Google user data

Nularche's use and transfer of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements. In particular:

- Google user data is used only to provide the Drive and Calendar features you turn on, inside the app on your
  computer.
- Google user data is **not** transferred to us or to anyone else, **not** used for advertising, **not** sold,
  and **not** used to train AI models.
- No person reads your Google data. Nularche has no servers, so there is no one at Nularche who could.

## Apple iCloud Calendar

If you connect an Apple iCloud calendar, Nularche uses the app-specific password you create to talk to
Apple's calendar server (CalDAV) directly from your computer, for the same purposes as Google Calendar above.

## AI features

Nularche AI works with the AI service you choose. In automatic mode, the text of your request and the
notes involved are sent from your computer to Google's Gemini API with your own key. In subscription mode,
your Claude, ChatGPT or Gemini app reads and edits notes through a local connection on your computer. Those
services handle data under their own privacy policies. Nularche never sends your notes to an AI service unless
you make a request.

## Other connections

- Nularche checks GitHub for new versions of the app. This request contains no personal data.
- YouTube videos you embed in a note are loaded from YouTube's privacy-enhanced domain when you view the note.

## Children

Nularche is not directed at children under 13 and does not knowingly collect their data. Nularche does not
collect anyone's data.

## Changes and contact

Changes to this policy are published in this file, with the date at the top. Questions: verseofac@gmail.com.

---

## Nularche Gizlilik Politikası (Türkçe özet)

- Nularche'nin **sunucusu, hesabı ve analitiği yoktur**. Notlarınız, dosyalarınız, takvimleriniz, parolalarınız
  ve Google verileriniz bize hiçbir zaman gelmez.
- Nularche her şeyi **kendi bilgisayarınızda**, seçtiğiniz klasörde, düz dosyalar olarak tutar.
- Google ve Apple giriş bilgileri işletim sisteminizin parola deposunda şifreli olarak yalnızca o bilgisayarda
  durur.
- **Google Drive:** Nularche yalnızca `drive.file` iznini ister; Drive'ınızda yalnızca kendi oluşturduğu
  Nularche klasörünü görür, diğer dosyalarınıza erişemez. Bu erişimi yalnızca notlarınızı bilgisayarlarınız
  arasında eşitlemek için kullanır.
- **Google Takvim:** Takvimlerinizi Nularche'nin Takvim ekranında göstermek ve sizin oluşturduğunuz, düzenlediğiniz
  ya da sildiğiniz etkinlikleri takviminize yazmak için kullanılır.
- Google'dan alınan veriler, Google API Hizmetleri Kullanıcı Verileri Politikası'na (Sınırlı Kullanım
  koşulları dahil) uygun olarak yalnızca bu özellikler için kullanılır; kimseye aktarılmaz, reklam için
  kullanılmaz, satılmaz ve yapay zekâ eğitiminde kullanılmaz.
- Sorularınız için: verseofac@gmail.com
