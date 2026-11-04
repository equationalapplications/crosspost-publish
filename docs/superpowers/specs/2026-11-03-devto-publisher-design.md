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

- Forem API v1: `POST https://dev.to/api/articles`, header `api-key: <key>`, JSON body
  `{ article: { title, body_markdown, published: true, canonical_url?, description?,
  tags? } }` (tags max 4; description max ~140). Verify against
  https://developers.forem.com/api before implementing.
- Returns `{ networkId: "devto", ok, externalId: <article id>, message? }`; the UI links
  to the returned `url` on success.
- No image support in v1 (dev.to images live in the markdown body; remote URLs only).
  The one-image flow stays Bluesky/LinkedIn-only.

### 2. Article payload (long-form extends the context)

- `PublishContext` gains an optional `article?: { title, bodyMarkdown, canonicalUrl?,
  description?, tags?: string[] }`. Present only when dev.to is targeted. Validation:
  title required (≤ 128), bodyMarkdown required (≤ 400k), ≤ 4 tags, canonicalUrl must be
  https when present.
- `/api/publish` accepts the new fields (JSON body variant; multipart path unchanged
  when no article fields are sent).

### 3. Two dev.to identities

- `DEVTO_API_KEY` — Kurt's account (primary).
- `DEVTO_API_KEY_TESSERA` — Tessera's account (optional; added when the account exists).
- UI: a dev.to target checkbox plus an identity selector (Kurt / Tessera) shown only
  when a second key is configured. Per-network success/failure reporting unchanged
  (identity is part of the result message).

### 4. Attribution convention (usage, not code enforcement)

- Tessera-authored posts carry a disclosure line in the first paragraph:
  "Posted by Tessera, Kurt VanDusen's executive AI agent at Equational Applications."
- canonical_url points at the canonical post on equationalapplications.com (site is
  always published first).

### 5. Config + docs

- `.env.example`: the two new optional variables.
- README: dev.to section (key generation at dev.to/settings/extensions, identity
  selector, disclosure + canonical-URL conventions).

## Files touched

- `server/publishers/types.ts`, `registry.ts`, `devto.ts` (new)
- `server/index.ts` (route fields + validation)
- `src/App.tsx` (dev.to checkbox, article fields, identity selector)
- `.env.example`, `README.md`
- `scripts/validate-devto.mjs` (new; mirrors validate-bluesky.mjs: checks key works via
  `GET /api/articles/me`)

## Test plan

- ESLint + build pass.
- validate-devto.mjs against a real key (manual, Kurt-provided).
- First live post: re-publish the approved standing-privacy-modes post to Tessera's
  identity with canonical_url → the site note (after PR #109 on ea-site merges).

## Out of scope

- Cross-posting of Bluesky/LinkedIn content *from* dev.to, comments, or stats.
- Multiple dev.to organizations / publications.
