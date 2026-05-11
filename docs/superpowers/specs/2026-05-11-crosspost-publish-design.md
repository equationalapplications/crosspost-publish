# Crosspost publish — design spec (v1)

**Date:** 2026-05-11  
**Status:** Draft for review (no implementation gate until approved)

## Purpose

A **local web application** the author runs on their machine (e.g. Vite dev server on `http://localhost:5173` with API proxied or a single documented local URL). They compose a **single** social post once—**text plus at most one image**—then publish **immediately** to **Bluesky** and **LinkedIn (personal profile)**. Additional networks are **out of scope for v1** but the architecture must make them easy to add later.

## Goals

- One composer, one publish action, **per-network results** (each destination succeeds or fails independently; **no rollback** when APIs have already accepted a post).
- **Secrets only via environment variables** (typically a local `.env` file that is **never committed**).
- **Public GitHub–safe**: repository may be **public**, **MIT-licensed**, with **no credentials, tokens, or personal data** in version control.

## Non-goals (v1)

- Drafts, scheduling, queues, or background workers.
- LinkedIn **company** pages or multi-identity selection per post.
- Multiple images, carousels, video, or polls.
- Hosted multi-tenant SaaS, shared login, or remote deployment as a product (local use is the design center).
- Automatic LinkedIn token refresh (manual token rotation documented; optional follow-up: OAuth helper).

## User decisions (frozen for v1)

| Topic | Choice |
| --- | --- |
| Interface | Local web app in browser |
| Publish mode | Immediate only |
| Content | Text + optional **one** image; same asset sent to each selected network |
| LinkedIn target | Personal profile only |
| Configuration | `.env` only (no in-app secret store) |
| Partial failure | Show clear **per-network** status; no pretend rollback |

## Architecture

**React + Vite** for the **browser UI** (composer, toggles, image preview, publish button, results list). **Next.js is explicitly out of scope** — no App Router, no RSC requirement for v1.

Secrets and third-party APIs **cannot** live in the Vite client bundle. Use a **small Node HTTP API** in the same repo (e.g. Express, Hono, or Node’s built-in `http`) that exposes at least:

- `POST /api/publish` — `multipart/form-data`: `text`, optional `image`, flags for enabled destinations; JSON response of per-network results.

**Dev ergonomics:** either (a) run API and Vite concurrently with **Vite `server.proxy`** forwarding `/api` to the API port, or (b) one Node process that embeds Vite middleware in dev and serves `dist/` plus API in production. Pick one pattern at implementation time; both are valid.

**Production / local “build” run:** one process that serves the Vite `dist/` static assets and mounts the same `/api/publish` handler, **or** documented two-port setup — README must spell out the supported command(s).

All third-party API calls and `process.env` access occur **only on the Node API**. The browser never receives raw secrets.

### Publisher plugin pattern

- Directory (conceptual): `publishers/` or `src/lib/publishers/`.
- Each destination implements a shared contract, e.g. `publish(context) -> PublishResult`, where `context` includes normalized text, optional image buffer + MIME type, and logger-safe metadata (no secrets in logs).
- A **registry** maps stable ids (`bluesky`, `linkedin`, …) to implementations. Adding a network = new module + registration + env vars documented in `.env.example`.

### Data flow

1. User submits form → multipart request to server.
2. Server parses body, optionally validates global constraints (e.g. max body size).
3. Server runs **in parallel or sequential** publishes per enabled toggle; **results must be independent** (failure on one does not throw away another’s outcome).
4. JSON response: array of `{ networkId, ok, message?, externalId? }` (exact field names TBD at implementation; stable wire shape for the UI).

### Bluesky (v1)

- Authenticate with handle + **app password** via AT Protocol client (dependency choice at implementation time; prefer official/mainstream SDK).
- Post text; attach image when present per Bluesky rules.
- Return canonical post URI or id where available for success rows.

### LinkedIn (v1)

- Use **personal** UGC/share APIs consistent with `w_member_social` (exact endpoint and payload at implementation).
- **Configuration:** access token + person identifier (URN or documented equivalent) supplied via env vars.
- Document in README how to obtain tokens **without** checking secrets into git; state **manual refresh** for v1.

### Images

- Single file; validate on server (size, MIME allowlist). Each publisher may apply stricter rules and return a **network-specific** error without affecting other networks’ attempts (unless a global limit is exceeded before any call—document behavior: prefer “reject before any publish” only for oversized multipart, not for per-network policy).

## Public repository and MIT license (requirements)

These constraints apply to **all** commits intended for the public default branch.

### License and metadata

- Root **`LICENSE`** file: **MIT** (copyright holder: project author or organization name TBD at first public commit).
- **`package.json`**: `"license": "MIT"`, remove or set `"private": false` when the package is meant for public consumption (avoid implying npm publish unless intended).
- **README.md**: what the app does, **local run** steps, **env var table** (names only, no values), security notes, “no warranty” aligned with MIT.

### Secrets and PII

- **`.gitignore`** must include `.env`, `.env.local`, `.env.*.local`, and common OS/editor junk.
- **`.env.example`** committed with **placeholder values only** (e.g. `BLUESKY_HANDLE=your.handle`, `x=...`). Never real tokens.
- No analytics keys, no hardcoded endpoints with embedded credentials.
- Logs and error messages must **not** print access tokens or app passwords; redact query strings if any contain secrets.

### Dependencies

- Prefer **permissively licensed** dependencies compatible with MIT distribution.
- Avoid bundling proprietary fonts/assets; document optional branding separately if ever needed.

### Security posture (OSS honesty)

- README section: **threat model** — intended for **single-user local** use; not hardened for internet exposure. Recommend **localhost-only** bind and firewall if dev server is exposed.
- **SECURITY.md** (recommended): how to report vulnerabilities; scope that maintainers may not run a bug bounty.

### CI (optional for v1, design allowance)

- Public repo may add GitHub Actions for **lint/build** only; **no secrets** in workflow except optional **read-only** tokens not required for v1.

## Testing strategy (lightweight)

- **Unit tests** for publisher adapters using **mocked HTTP** or injected clients (no live keys in CI).
- **Manual smoke** checklist in README for maintainers with real `.env` (not automated in public CI).

## Open points for implementation (not blockers for this spec)

- Replace any existing **Next.js** scaffold with **Vite + React** and the Node API layout above; do not ship both frameworks.
- Exact env var names and minimal README screenshots (no PII).
- Max upload size and concurrent vs sequential publisher calls.
- Exact LinkedIn API version and error mapping to user-visible strings.

## Approval

- [ ] Product/architecture matches stakeholder intent  
- [ ] OSS/MIT section is sufficient for a public repo  

After approval: follow **writing-plans** skill to produce an implementation plan; implementation remains out of scope until that plan exists.
