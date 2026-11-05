# LEDGER — dev.to publisher (PR #43, feat/devto-publisher)

**Plan:** `plan.md` (this folder). **Spec:** `spec.md` — Status: Reviewed (Kurt approved 2026-11-04, chat ruling).
**What's in flight:** implementation NOT started — plan written, awaiting plan review + Kurt's plan approval.

- [ ] Task 1: test infrastructure (vitest + jsdom + testing-library)
- [ ] Task 2: article payload types + pure validation
- [ ] Task 3: disclosure guard match rule
- [ ] Task 4: request-rule branching + identity→key resolution
- [ ] Task 5: Forem publisher, never-auto-retry
- [ ] Task 6: registry + route wiring (`express.json()`, health identities)
- [ ] Task 7: UI — article fields, identity selector, submit-time lock
- [ ] Task 8: config, docs, validate scripts (+ track validate-bluesky.mjs)
- [ ] Task 9: full verification + ledger reconcile

**Manual gates outside the plan (controller, never a plan task):**
- `scripts/validate-devto.mjs` against real keys — keys arrive from Kurt via pass → `.env`, never chat.
- First live post (approved standing-privacy-modes post → Tessera identity, canonical_url → site) waits on the ea-site merge.
- Draft→ready flip (status → `Implemented`, delete plan.md + LEDGER.md, `gh pr ready`) per the ONE-PR LIFECYCLE, after internal review loops converge, before the bot gauntlet.

*Ticked boxes carry evidence (command + sha/output path) in the line below each; ledger reconciles against disk at every session start — disk wins.*
