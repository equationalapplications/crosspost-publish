# LEDGER — dev.to publisher (PR #43, feat/devto-publisher)

**Plan:** `plan.md` (this folder). **Spec:** `spec.md` — Status: Reviewed (Kurt approved 2026-11-04, chat ruling).
**What's in flight:** implementation complete — all nine tasks evidenced; awaiting controller review-loop convergence and draft→ready flip.

- [x] Task 1: test infrastructure (vitest + jsdom + testing-library)
  - Evidence: commit 3c17f1a (`test: vitest + jsdom + testing-library harness with ui/server environments`); `package.json` `test: vitest run` verified on disk; 6 test files / 66 tests run green.
- [x] Task 2: article payload types + pure validation
  - Evidence: commit 5b4ada8; `server/publishers/types.ts:19` (`article?:` on PublishContext), `:27` (`url?:` on PublishResult), `:35` (devtoIdentity); `server/publishers/devto-validation.ts:30` (title ≤ 128), `:32` (body ≤ 400k), `:35` (≤ 4 tags + normalization `:62`), `:40-47` (canonicalUrl https + exact-host rule).
- [x] Task 3: disclosure guard match rule
  - Evidence: commit 86b2c51; `server/publishers/devto-validation.ts:4,62,134` (case-insensitive, whitespace-normalised substring incl. curly-quote normalization; enforced at `:133-135`, 400 when missing for tessera).
- [x] Task 4: request-rule branching + identity→key resolution
  - Evidence: commit 8d64b2d; `server/publishers/devto-validation.ts:65-68` (IDENTITY_ENV map), `:91-137` (request rules: devto-only, devto-without-article 400, article-without-devto 400, article+image 400, stale-identity ignore, default = first `devtoIdentities` entry `:125-127`).
- [x] Task 5: Forem publisher, never-auto-retry
  - Evidence: commit c66b992; `server/publishers/devto.ts` — POST `https://dev.to/api/articles` with `api-key` header (`:4,67-69`), 30s `AbortSignal.timeout` (`:5,71`), 5xx/429/abort/id-less-2xx all map to unknown-outcome rows (`:76-106`), exactly one outbound request, never retried.
- [x] Task 6: registry + route wiring (`express.json()`, health identities)
  - Evidence: commit 697f731; `server/index.ts:32` (`express.json({ limit: "2mb" })`), `:34-56` (route fields + validation), `:70-72` (`/api/health` `devtoIdentities`), `server/publishers/registry.ts:49-56` (identity resolution, missing-key per-network failure).
- [x] Task 7: UI — article fields, identity selector, submit-time lock
  - Evidence: commit 2a93473; `src/App.tsx:40,94,124,159,189` (sessionStorage `DEVTO_PENDING_KEY` lock: set at submit before response, released on ok/4xx, held through unknown outcome, Reset-safe), `:49-51` (identity selector visibility from `/api/health`), `:143,151,251,262` (tag normalization, identity passthrough, counters).
- [x] Task 8: config, docs, validate scripts (+ track validate-bluesky.mjs)
  - Evidence: commits 5ceaf73 + 7fc85f7; `.env.example` carries `DEVTO_API_KEY` / `DEVTO_API_KEY_TESSERA`; README dev.to section (key generation, disclosure + canonical-URL conventions, no-auto-retry); `scripts/validate-devto.mjs` and `scripts/validate-bluesky.mjs` tracked.
- [x] Task 9: full verification + ledger reconcile
  - Evidence (cold, 2026-11-05): `rm -rf node_modules/.vite && npm run lint` → FAILS (expected, pre-existing: `typescript-eslint does not support TS 7.0`, ESLint 10.12.0, exit 2 — controller-adjudicated out of scope, full output in `.superpowers/sdd/plan/task-9-report.md`); `npm run build` → PASS (exit 0, vite client + tsc server); `npm test` → 66/66 pass, 6 files, 30.5s (incl. the 30s hang-case timeout test). Spec walkthrough: all spec §1–§5 requirements and Files-touched list map to landed code (see task-9-report.md). Ledger commit: see HEAD.

**Manual gates outside the plan (controller, never a plan task):**
- `scripts/validate-devto.mjs` against real keys — keys arrive from Kurt via pass → `.env`, never chat.
- First live post (approved standing-privacy-modes post → Tessera identity, canonical_url → site) waits on the ea-site merge.
- Draft→ready flip (status → `Implemented`, delete plan.md + LEDGER.md, `gh pr ready`) per the ONE-PR LIFECYCLE, after internal review loops converge, before the bot gauntlet.

*Ticked boxes carry evidence (command + sha/output path) in the line below each; ledger reconciles against disk at every session start — disk wins.*
