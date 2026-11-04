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

- Forem API v1: `POST https://dev.to/api/articles` with the `api-key` header carrying
  the key; JSON body
  `{ article: { title, body_markdown, published: true, canonical_url?, description?,
  tags? } }`. Verified 2026-11-04 against the Forem OpenAPI spec
  (https://developers.forem.com/api): the endpoint, `api-key` header, body shape,
  tags max 4 (the API takes them as a comma-separated string), and
  `GET /api/articles/me` are all confirmed; `description` has no schema maxLength —
  the ~140 cap is a dev.to-side convention, so treat it as a soft validation limit.
- Returns `{ networkId: "devto", ok, externalId: <article id>, url, message? }`; the UI
  links to the returned `url` on success. `PublishResult` (types.ts) gains an optional
  `url?: string` populated from the Forem response — dev.to article URLs are not
  derivable from the id alone.
- No image support in v1 (dev.to images live in the markdown body; remote URLs only).
  The one-image flow stays Bluesky/LinkedIn-only.
- Retry rule: `POST /api/articles` with `published: true` creates a new live article on
  every successful call (non-idempotent). dev.to publishes are never auto-retried; if
  the request times out, surface the failure for manual re-check instead of retrying,
  with the failure message pointing the user at `GET /api/articles/me` or their dev.to
  dashboard (a 5xx may mean "created but response lost" — re-posting blind can
  duplicate the article). The request carries an explicit timeout (30 s via
  AbortSignal); an abort after the bytes were sent is treated as a possible create.
  Because `publishAll` sends to all targets in one request, the UI also guards manual
  resubmits: after a dev.to success or a "check manually" failure, the dev.to target
  is unchecked/locked (re-enable requires a fresh form) so pressing Publish again
  cannot create a second live article. On success the article id/url is returned to
  the UI in the result (no server-side store; the app is stateless).

### 2. Article payload (long-form extends the context)

- `PublishContext` gains an optional `article?: { title, bodyMarkdown, canonicalUrl?,
  description?, tags?: string[] }`. Validation: title required (≤ 128), bodyMarkdown
  required (≤ 400,000 characters), ≤ 4 tags (normalized to lowercase alphanumeric
  before submit — dev.to rejects other characters with a 422), canonicalUrl must be
  https with `URL.hostname` exactly `equationalapplications.com` when present (no
  www/subdomains).
- `/api/publish` request rules with dev.to in the mix:
  - `text` is required only when Bluesky or LinkedIn is targeted (a dev.to-only
    publish has no short-form text).
  - `devto: true` requires `article`; missing article → 400. `article` sent without
    `devto: true` → 400.
  - the "at least one destination" check includes `devto`.
- `/api/publish` accepts the new fields (JSON body variant; multipart path unchanged
  when no article fields are sent). `server/index.ts` today has no `express.json()` —
  every request goes through `upload.single("image")` (multer multipart) — so the
  implementation adds `express.json()` alongside it — with a JSON body limit of `2mb`
  (Express defaults to 100kb, which would 413 a ≤400k-character non-ASCII
  `bodyMarkdown`; 2mb covers the worst case): multer handles
  multipart requests, JSON parsing handles the rest. A request combining article
  fields with an image is rejected with 400 (dev.to has no image support in v1), and
  the UI disables the image picker when the dev.to checkbox is set so users never hit
  that 400.

### 3. Two dev.to identities

- `DEVTO_API_KEY` — Kurt's account (primary).
- `DEVTO_API_KEY_TESSERA` — Tessera's account (optional; added when the account exists).
- UI: a dev.to target checkbox plus an identity selector (Kurt / Tessera) shown only
  when a second key is configured. Per-network success/failure reporting unchanged
  (identity is part of the result message).
- Wire contract: the client sends `devtoIdentity: "kurt" | "tessera"` — a closed enum,
  never free text and never an API key. The server maps the enum to the corresponding
  env var and rejects unknown values with 400; an omitted `devtoIdentity` defaults to
  `"kurt"`. `PublishTargets` gains `devto: boolean` plus this identity carrier
  (server/publishers/types.ts). A publish whose identity's key is not configured fails
  per-network with a message naming the missing env var (registry.ts).
- Identity discovery: the client cannot see env vars, so an existing endpoint reports
  which dev.to identities are configured (`/api/health` gains a `devtoIdentities`
  field); the UI derives the selector's visibility from that.

### 4. Attribution (one code guard + usage conventions)

- Tessera-authored posts carry the disclosure line in the first paragraph:
  "Posted by Tessera, Kurt VanDusen's executive AI agent at Equational Applications."
  This one rule is code-enforced: when `devtoIdentity` is `"tessera"`, the server
  requires the disclosure line in `bodyMarkdown` (400 if missing) — disclosure is why
  dev.to was chosen over Medium, so it cannot ride on memory alone. Kurt's own posts
  are not policed.
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
  mirror target is currently untracked working-tree content and is committed in the
  implementation PR alongside this feature: checks key works via
  `GET /api/articles/me`)

## Test plan

- ESLint + build pass.
- Unit tests for the new pure logic: article-field validation (title ≤ 128, ≤ 4 tags,
  tag normalization, canonicalUrl exact-host rule, body ≤ 400k characters),
  identity→key resolution (default `kurt`, unknown → 400, missing-key message), the
  disclosure-line guard for the tessera identity, and the request-rule branching in
  `server/index.ts` (dev.to-only publish, `devto` without `article` → 400, `article`
  without `devto` → 400, article+image → 400, no-destination → 400).
- Retry-rule unit test: a timeout or 5xx on `POST /api/articles` produces exactly one
  outbound request and a "check manually" failure result (no auto-retry); the response
  carries the article id/url on success.
- UI-guard test: after a dev.to success or "check manually" failure, the dev.to target
  is unchecked/locked on the next submit.
- validate-devto.mjs against a real key (manual, Kurt-provided).
- First live post: re-publish the approved standing-privacy-modes post to Tessera's
  identity with canonical_url → the site note (after PR #109 on ea-site merges).

## Out of scope

- Cross-posting of Bluesky/LinkedIn content *from* dev.to, comments, or stats.
- Multiple dev.to organizations / publications.
