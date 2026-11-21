# Nularche web version: architecture

Goal: open your Nularche notes from any computer's browser at `https://nularche.verseofac.com/app`, with no Nularche
server. You sign in with Google, unlock your end-to-end encrypted Drive copy with your passphrase, and the app works on
the notes in the browser's memory while syncing with Google Drive.

## One core, two platforms

The desktop app and the web version share the same core (`packages/core`) and interface (`packages/web`). The core
only touches the outside world through a few Node modules: `node:fs/promises`, `node:path`, `node:crypto`,
`node:zlib` and the `Buffer` global. In the browser these are replaced by `packages/web-platform`:

| Node module | Web replacement | Notes |
| --- | --- | --- |
| `node:fs/promises` | `fs.ts` over `vfs.ts` | In-memory POSIX file system with Node's error codes and change events (used for Drive sync). |
| `node:crypto` | `crypto.ts` | SHA-256/512, MD5, HMAC, AES-256-GCM, PBKDF2 via `@noble/hashes` and `@noble/ciphers` (MIT); randomness from `crypto.getRandomValues`. Byte-for-byte equal to Node. |
| `node:path` | `path.ts` | `path-browserify` (Node's `path.posix`, MIT). |
| `node:zlib` | `zlib.ts` | gzip via `fflate`. |
| `Buffer` | `buffer.ts`, `globals.ts` | `buffer` (MIT) plus `base64url`. |

The replacement is done with module aliases (`aliases.ts`, the single list used by every web build). The desktop
app keeps using Node itself, so nothing changes there.

## How it is verified

- `npm run test:web-platform` runs the core test suite with the web platform swapped in by a Node loader hook
  (`scripts/web-platform/`): notes, links, databases, Drive sync with end-to-end encryption, citations, flashcards and
  the rest run on the in-memory file system and the browser crypto. `security.test.ts` is skipped because it tests the
  Node HTTP server, which the browser doesn't use.
- `packages/web-platform/test/crypto-parity.test.ts` checks that hashes, HMAC, AES-256-GCM, PBKDF2 and `base64url`
  produce the same bytes as Node, so files encrypted on the desktop open on the web and the other way round.
- `npm run check:web-platform` builds `core-entry.ts` for the browser and fails if any Node module is left in the bundle.

## One API, two transports

`packages/server/src/api.ts` handles every `/api/…` and `/files/…` route as a standard `Request` → `Response`
function, with live updates (`/api/events`, Server-Sent Events) from an `EventHub`. On the desktop,
`packages/server/src/app.ts` is a thin Node HTTP adapter: it checks Host, Origin and the session secret, serves the
built interface, watches the Origin folder and forwards everything else to the handler. In the browser the same handler
will run in the page, fed by the in-memory file system. `packages/core/test/api-handler.test.ts` runs on both platforms.

In the browser there is no server. A service worker (`packages/web-platform/src/service-worker.ts`) catches the
page's own `/api/…` and `/files/…` requests and hands each one, over a `MessageChannel`, to the page that made it
(`bridge.ts`, `host.ts`). The page runs the handler on the in-memory files and streams the response back in chunks, so
`fetch`, uploads, `EventSource("/api/events")`, `<img src="/files/…">` and pdf.js work exactly as on the desktop. The
service worker touches nothing else, caches nothing and stores nothing; notes live only in the page's memory. Page
navigations (opening a `/files/…` address directly) are left to the network. Until the Origin is unlocked, or after
it locks, the page answers `503`.

- `packages/web-platform/test/bridge.test.ts` covers the protocol: JSON and binary bodies, a 5 MB upload, `204`,
  errors, the `503` lock answer, a timeout when the page does not answer, live events and cancellation reaching the
  handler.
- `npm run check:web-bridge` (also in CI) builds the service worker and a small page, opens it in headless Chrome and
  checks the whole path: notes API, live events, an image attachment, a 4 MB round trip, that no `/api` or `/files`
  request reaches the network, and that navigations do.

## Signing in and opening notes

`packages/web/app.html` is the web version's page (`npm run build:web` builds it with the service worker into
`packages/web/dist-web`, served at `/app/`). It opens a Nularche sign-in window (`packages/web/src/web/signin.ts`):

1. **Continue with Google.** One Google sign-in connects both Google Drive and Google Calendar. Google Identity
   Services gives a short-lived access token for `drive.file` (only Nularche's own folder) and the two Calendar
   scopes the desktop app uses (events, calendar list) (`google-auth.ts`). Drive is required; if the user unticks
   Calendar on Google's consent screen, the notes still open and Calendar can be allowed later from Settings. There is no refresh token and no client secret; the token lives in memory. The Drive client
   (`core/src/drive-google.ts`) takes it as `{ accessToken }` and asks for a fresh one once when Google answers `401`.
2. **Find the Origin.** The newest Nularche root folder in Drive, the same choice the desktop app makes.
3. **Passphrase.** For an end-to-end encrypted root the passphrase is checked against the root's key check before
   anything is downloaded; a wrong passphrase is refused without touching any file.
4. **Load.** `web-platform/src/session.ts` downloads and decrypts the notes into the in-memory file system, starts the
   shared API on them and connects it to the service worker. The app interface loads only then. Edits are sent back
   to Drive two seconds after the last change (encrypted for an encrypted root); Drive is checked for changes every
   minute. Closing the session sends pending changes and wipes the memory.

**Google Calendar.** When Calendar was allowed, the account is connected right after the notes open and the
primary calendar is shown on the Calendar page (`web/calendar-web.ts`). The calendar logic is shared with the desktop
app (`server/src/calendar-service.ts`); only where the account is kept differs: the desktop keeps it in the system
keychain, the web version only in memory. Calendar links are per device (`.nularche/calendar.json` is not synced), so
the web version starts each session with the primary calendar. Apple Calendar (CalDAV) cannot be reached from a
browser and stays in the desktop app. Settings → Notes and Origin shows the Drive connection, its encryption and the
last sync, with a Sync now button.

**Nularche AI.** The web version uses the same Gemini automatic mode as the desktop app
(`server/src/auto-service.ts`, shared with the desktop's IPC): the user pastes their own Gemini API key under
Settings → AI, requests are processed in the browser and the reply appears in the Nularche AI window. The key is kept
only in the tab's memory and is entered again in the next session. AI apps that need a desktop launcher (Claude,
ChatGPT, Codex) are not offered on the web. Which file change notifies the interface ("ai", "comments", "change") is
decided by one shared rule (`api.ts` `changeEventFor`) for both the desktop file watcher and the in-memory files.

**Lock and sign out.** The sidebar has Lock and Sign out. Both send pending changes to Drive, wipe the tab's memory
and return to the sign-in window; Sign out also revokes the Google grant. The session locks itself after a period of
inactivity (15 minutes by default, 5 to 240 in Settings → Security). Closing the tab while changes are not yet in
Drive asks for confirmation.

**Headers.** `site/_headers` is generated from `scripts/site-headers.ts`. The homepage keeps its strict policy; `/app`
gets its own Content Security Policy that allows only Google sign-in, the Drive and Calendar APIs, the Gemini API and
YouTube embeds, plus `Cross-Origin-Opener-Policy: same-origin-allow-popups` for the sign-in popup.

Nothing is written to the computer: no notes, keys or tokens in local storage, IndexedDB or caches. Only the
interface language is remembered.

- `packages/web-platform/test-web/session.test.ts` (run by `npm run test:web-platform`) covers the session with a fake
  Drive: passphrase required, wrong and right passphrase, notes arriving in memory, a web edit uploaded encrypted,
  a change made elsewhere arriving, and the memory being empty after closing.
- `npm run check:web-app` (also in CI) builds the real web version with a fake Drive in place of Google, opens it in
  headless Chrome and goes through the sign-in window, a wrong and a right passphrase, the app showing a note written
  on the desktop, Google Calendar connected by the same sign-in with an event on the Calendar page and a new event
  written back, Drive shown as connected in Settings, a new note reaching Drive encrypted, no `/api` or `/files` request reaching the network and nothing
  stored in the browser.

## Next steps

1. Publishing at `/app` (the build is not part of the static site yet) and an "Open in browser" button on the homepage.
2. A real Google sign-in check after publishing (the automated checks use fake Google services).
