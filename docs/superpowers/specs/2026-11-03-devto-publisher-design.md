# dev.to as a third crosspost target (Tessera + Kurt)

**Date:** 2026-11-03
**Status:** Draft — awaiting Kurt's spec approval
**Requested by:** Kurt VanDusen, 2026-11-03: Medium is out (platform policy); use
crosspost-publish to post to dev.to "for you [Tessera] to post more widely, as well as
I will use it for my posts."

## Problem

crosspost-publish v1 publishes short-form posts to Bluesky and LinkedIn only. dev.to is
the chosen long-form distribution channel (its community norms explicitly welcome
disclosed agent authors, unlike Medium). Two distinct author identities need to publish:
Kurt (human) and Tessera (disclosed AI agent) — and a dev.to API key is bound to one
account, so attribution requires per-identity keys.

## Design

### 1. Publisher: `server/publishers/devto.ts`

- Forem API v1: `POST https://dev.to/api/articles`, header `api-key: <key>`; JSON body
  `{ article: { title, body_markdown, published: true, canonical_url?, description?,
  tags? } }`. Verified 2026-11-04 against the Forem OpenAPI spec
  (https://developers.forem.com/api): the endpoint, `api-key` header, body shape,
  tags max 4 (the API takes them as a comma-separated string), and
  `GET /api/articles/me` are all confirmed; `description` has no schema maxLength —
  the ~140 cap is a dev.to-side convention, so treat it as a soft validation limit.
- Returns `{ networkId: "devto", ok, externalId: <article id>, message? }`; the UI links
  to the returned `url` on success.
- No image support in v1 (dev.to images live in the markdown body; remote URLs only).
  The one-image flow stays Bluesky/LinkedIn-only.
- Retry rule: `POST /api/articles` with `published: true` creates a new live article on
  every successful call (non-idempotent). dev.to publishes are never auto-retried; if
  the request times out, surface the failure for manual re-check instead of retrying.
  Persist the returned article id/url on success.

### 2. Article payload (long-form extends the context)

- `PublishContext` gains an optional `article?: { title, bodyMarkdown, canonicalUrl?,
  description?, tags?: string[] }`. Present only when dev.to is targeted. Validation:
  title required (≤ 128), bodyMarkdown required (≤ 400k), ≤ 4 tags, canonicalUrl must be
  https on the equationalapplications.com host when present.
- `/api/publish` accepts the new fields (JSON body variant; multipart path unchanged
  when no article fields are sent). `server/index.ts` today has no `express.json()` —
  every request goes through `upload.single("image")` (multer multipart) — so the
  implementation adds `express.json()` alongside it: multer handles multipart
  requests, JSON parsing handles the rest. Requests combining article fields with an
  image are rejected with 400 (dev.to has no image support in v1).

### 3. Two dev.to identities

- `DEVTO_API_KEY` — Kurt's account (primary).
- `DEVTO_API_KEY_TESSERA` — Tessera's account (optional; added when the account exists).
- UI: a dev.to target checkbox plus an identity selector (Kurt / Tessera) shown only
  when a second key is configured. Per-network success/failure reporting unchanged
  (identity is part of the result message).
- Wire contract: the client sends `devtoIdentity: "kurt" | "tessera"` — a closed enum,
  never free text and never an API key. The server maps the enum to the corresponding
  env var and rejects unknown values with 400. `PublishTargets` gains `devto: boolean`
  plus this identity carrier (server/publishers/types.ts).

### 4. Attribution convention (usage, not code enforcement)

- Tessera-authored posts carry a disclosure line in the first paragraph:
  "Posted by Tessera, Kurt VanDusen's executive AI agent at Equational Applications."
- canonical_url points at the canonical post on equationalapplications.com (site is
  always published first — a usage convention only; the site-publish leg lives outside
  this app, so there is no in-app enforcement).

### 5. Config + docs

- `.env.example`: the two new optional variables.
- README: dev.to section (key generation at dev.to/settings/extensions, identity
  selector, disclosure + canonical-URL conventions).

## Files touched

- `server/publishers/types.ts`, `registry.ts`, `devto.ts` (new)
- `server/index.ts` (route fields + validation)
- `src/App.tsx` (dev.to checkbox, article fields, identity selector)
- `.env.example`, `README.md`
- `scripts/validate-devto.mjs` (new; mirrors `scripts/validate-bluesky.mjs` — that
  mirror target is currently untracked working-tree content and is committed in this
  PR alongside the implementation: checks key works via `GET /api/articles/me`)

## Test plan

- ESLint + build pass.
- Unit tests for the new pure logic: article-field validation (title ≤ 128, ≤ 4 tags,
  canonicalUrl host rule, body ≤ 400k), identity→key resolution, and the
  JSON-vs-multipart branching in `server/index.ts`.
- Retry-rule unit test: a timeout or 5xx on `POST /api/articles` produces exactly one
  outbound request and a "check manually" failure result (no auto-retry); the returned
  article id/url is persisted on success.
- validate-devto.mjs against a real key (manual, Kurt-provided).
- First live post: re-publish the approved standing-privacy-modes post to Tessera's
  identity with canonical_url → the site note (after PR #109 on ea-site merges).

## Out of scope

- Cross-posting of Bluesky/LinkedIn content *from* dev.to, comments, or stats.
- Multiple dev.to organizations / publications.
