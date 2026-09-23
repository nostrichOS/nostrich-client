<div align="center">

<img src="apps/web/public/logo.svg" alt="" width="96" height="96">

# Nostrich

**Nostrich is a free and open-source Nostr client.**

Your keys are your account. Your notes live on relays anyone can run.

[**nostrich.org**](https://nostrich.org)

[![License: MIT](https://img.shields.io/badge/License-MIT-000000.svg?style=flat-square)](LICENSE)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-000000?style=flat-square&logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/tests-2%2C500%2B-2ea043?style=flat-square)](#testing)

</div>

---

## What this is

Nostr is a protocol, not a platform. There are no accounts to create and no
company in the middle: a keypair **is** the identity, and posts live on
independent relays. That has one consequence which shapes this whole codebase.

> **Almost nothing happens on the server.** The browser talks to relays directly
> over websockets, signs everything locally, and keeps nothing of yours here.

No user table exists in this project, and there never will be. The one thing
stored server-side is a ranked list of already-public notes, rebuilt on a timer
so every reader is not ranking the network in their own browser.

---

## Features

<table>
<tr>
<td width="33%" valign="top">

### Reading
- Following, trending and latest feeds
- Custom feeds by hashtag and author
- Threads with reply collapsing
- Long-form articles (NIP-23)
- Profiles, followers, hashtag pages
- Full-text search (NIP-50)
- Link previews and media galleries
- Inline video and audio players
- Custom emoji rendering (NIP-30)
- Content warnings honoured (NIP-36)

</td>
<td width="33%" valign="top">

### Writing
- Notes, replies, quotes and reposts
- Long-form editor with markdown
- Image and video upload to Blossom
- Drafts that survive a reload
- Mentions with live search
- Emoji picker
- Bookmarks, public or encrypted
- Deletion requests (NIP-09)

</td>
<td width="33%" valign="top">

### Identity & money
- Browser extension (NIP-07)
- Remote signer / bunker (NIP-46)
- Encrypted local key (NIP-49)
- Read-only from any npub
- Zaps (NIP-57) and nutzaps (NIP-61)
- Wallet over NWC (NIP-47)
- Private chat (NIP-17)
- Mutes, filters, spam rules

</td>
</tr>
</table>

**Signed out works.** Paste an npub, or use none at all. A client that demands a
keypair at the door loses everyone who has never heard of Nostr.

---

## Quick start

```bash
pnpm install
pnpm --filter @nostrich/api db:generate
pnpm --filter web dev
```

Open <http://localhost:3400>. The feed reads from public relays straight away,
signed in or not.

<details>
<summary><strong>Full setup, with the server half</strong></summary>

The web app runs on its own. Postgres and the trending worker are only needed
if you want the ranked charts.

```bash
# 1. Dependencies
pnpm install

# 2. Configure
cp .env.example .env        # then edit it

# 3. Database (only the trending snapshot table)
pnpm --filter @nostrich/api db:generate
pnpm --filter @nostrich/api db:deploy

# 4. The app
pnpm --filter web dev       # or: pnpm --filter web build && pnpm --filter web start

# 5. Optional: the trending worker, a separate long-lived process
TRENDING_INDEX_URL=... pnpm --filter @nostrich/api trending
```

</details>

<details>
<summary><strong>Docker</strong></summary>

```bash
docker build -t nostrich .
docker run -p 3400:3400 \
  -e DATABASE_URL=postgresql://user:pass@host:5432/nostrich \
  -e NEXT_PUBLIC_APP_URL=http://localhost:3400 \
  nostrich
```

</details>

---

## Project layout

```
apps/
  web/                Next.js 15 App Router, the client itself
packages/
  nostr/              Protocol core: relay pool, signers, NIP implementations
  app/                Shared UI, rendered through react-native-web
  ui/                 Design tokens as plain data, plus the CSS theme
  api/                Server-only: Prisma, the trending builder and its worker
  types/              Zod contracts
  hooks/              Small shared React hooks
```

Workspace packages ship **raw TypeScript**. There is no build step for them:
`main` points at `src/index.ts` and Next compiles them through
`transpilePackages`. One less thing to be stale.

### The protocol core

`packages/nostr` is the part worth reading first. It has no React in it and no
DOM, so it runs anywhere.

| | |
|---|---|
| `pool.ts` | Relay pool: connection lifecycle, dedup, EOSE handling, backoff |
| `signers/` | Four signers behind one async interface |
| `content.ts` | The note tokenizer: links, mentions, hashtags, emoji, invoices |
| `zap.ts` | Zap requests and receipt validation |
| `dm.ts` | NIP-17 gift-wrapped private messages |
| `blossom.ts` | Media upload, mirroring and retry |
| `spam-rules.ts` | Pure spam heuristics, shared by client and server |

---

## Two rules worth knowing before you change anything

**Hex internally, bech32 only at the edges.** Pubkeys and event ids are
lowercase hex everywhere in this codebase. `npub` / `note` / `nevent` / `naddr`
are a presentation format: decode on input, encode for display, never in
between. A bech32 string in a relay filter matches nothing and fails silently,
which is the single most common bug in Nostr clients.

**Private keys are touched only through `Signer`.** Four implementations, and
the UI must work identically on all of them, because a large share of people
will never paste a key into an app.

| Signer | Where the key lives |
|---|---|
| `Nip07Signer` | A browser extension |
| `Nip46Signer` | Another device entirely, over a relay |
| `PrivateKeySigner` | This browser, encrypted at rest |
| Read-only | Nowhere. A pubkey with no signing |

Every `Signer` method is async even where a local key could answer
synchronously, because an extension and a remote signer cannot, and a
synchronous fast path would make them unimplementable.

---

## Media is not hosted here

Uploads go **from the browser straight to third-party Blossom servers** and
never touch this server. Each is authed with a kind-24242 event signed by the
user's own key. No accounts, no API keys.

Blossom is SHA-256 addressed, so a blob's identity is its hash rather than a
path on someone's disk. Mirrored across two independent hosts it is more
durable than one server's volume, and any server can serve it.

There is no media volume and no upload endpoint in this repository. If you add
one, put it on its own host: because content is hash-addressed, it slots in as
another mirror rather than a rewrite.

---

## Configuration

Every option is an environment variable, and the defaults assume you have set
nothing. See [`.env.example`](.env.example).

| Variable | Needed for |
|---|---|
| `NEXT_PUBLIC_APP_URL` | Absolute links and social cards |
| `DATABASE_URL` | The trending snapshot table |
| `TRENDING_INDEX_URL` | Candidates for the trending worker. No default |
| `PFP_CACHE_DIR` | Where resized avatars are written |
| `UNFURL_PROXY_SECRET` | Signs image-proxy URLs |

Relay defaults live in `packages/nostr/src/relays.ts`. A reader's own
kind-10002 list overrides them everywhere, so the defaults are a starting
point rather than a policy.

---

## Supported NIPs

`01` `04` `05` `07` `09` `10` `11` `13` `17` `18` `19` `21` `22` `23` `25`
`27` `30` `36` `40` `44` `45` `46` `47` `49` `50` `51` `53` `56` `57` `59`
`61` `65` `78` `89` `92` `98` `99`

---

## Testing

```bash
pnpm typecheck     # strict, with noUncheckedIndexedAccess
pnpm test          # every package
```

Over 2,500 tests. The protocol core is tested against real event fixtures
rather than hand-made ones, because a fixture you wrote yourself only proves
the parser agrees with itself.

---

## Contributing

Issues and pull requests are welcome.

- `pnpm typecheck && pnpm test` must pass
- Match the style of the file you are editing
- Explain *why* in the commit, not *what*

---

## License

[MIT](LICENSE)
