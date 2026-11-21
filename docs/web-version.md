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

## Next steps

1. A service worker that forwards the page's `/api` and `/files` requests to the handler running in the page.
2. Sign-in window (Google Identity Services, `drive.file`), passphrase unlock, Drive sync into the in-memory files.
3. Security in the browser: nothing persisted unless "Trust this device" is on, idle lock, sign-out that clears
   everything, strict CSP.
4. Feature coverage, then publishing at `/app`.
