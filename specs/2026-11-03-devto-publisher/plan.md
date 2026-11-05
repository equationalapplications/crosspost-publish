# dev.to Publisher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dev.to as a third crosspost target to crosspost-publish, with two identities (Kurt + Tessera), a code-enforced Tessera disclosure guard, and a never-auto-retry + submit-time UI lock that makes a blind duplicate dev.to article impossible in a session.

**Architecture:** A pure validation module (`devto-validation.ts`) holds every request-rule and match rule so they are unit-testable (the route handler calls `app.listen` at module load and is unimportable — the route imports from the module instead of inlining logic). A thin Forem API publisher (`devto.ts`) mirrors the existing `bluesky.ts` pattern (env-var presence check, per-network result rows). The UI submits JSON when dev.to is targeted (the existing FormData path is kept for Bluesky/LinkedIn-only publishes) and locks the dev.to target at submit time via a `sessionStorage` flag.

**Tech Stack:** TypeScript, Express 5 + multer, React 19, Vite; vitest + jsdom + @testing-library/react (new devDependencies).

**Spec:** `specs/2026-11-03-devto-publisher/spec.md` (read together with this plan — the plan argues from it).

## Global Constraints

- Forem API v1: `POST https://dev.to/api/articles`, header `api-key: <key>`, JSON body `{ article: { title, body_markdown, published: true, canonical_url?, description?, tags? } }`. Tags max **4**, sent as a comma-separated string. Facts verified 2026-11-04 against https://developers.forem.com/api (Forem OpenAPI spec).
- Title: required, ≤ **128** characters. `bodyMarkdown`: required, ≤ **400,000** characters. `description`: no server-side cap — UI counter (~140) only. Tags: ≤ 4, normalized to lowercase alphanumeric before submit.
- `canonicalUrl`, when present: `https://` and `new URL(canonicalUrl).hostname` must be **exactly** `equationalapplications.com` (no www, no subdomains) — verified live 2026-11-04 (canonical tags on apex; www 301s to apex).
- **Never auto-retry** `POST /api/articles` with `published: true` (non-idempotent: every success creates a live article). Timeout is 30 s via `AbortSignal.timeout`. Timeout/abort after bytes sent, 5xx, and transport errors are *unknown outcomes*, not failures to retry.
- Wire contract: `devtoIdentity: "kurt" | "tessera"` — closed enum, never free text, never a key. Unknown identity + `devto: true` → 400. Unknown/stale identity on a request without `devto` → ignored (not an error). Omitted identity defaults to the first entry of `devtoIdentities` (Kurt when both keys set).
- Env vars: `DEVTO_API_KEY` (Kurt), `DEVTO_API_KEY_TESSERA` (optional). Keys never transit the client or chat.
- Tessera-authored posts: the server 400s when `devtoIdentity` is `"tessera"` and `bodyMarkdown` lacks the disclosure line — case-insensitive, whitespace-normalised substring match. Disclosure line (exact string): `Posted by Tessera, Kurt VanDusen's executive AI agent at Equational Applications.`
- `/api/publish` request rules: `text` required only when Bluesky or LinkedIn targeted; `devto: true` without `article` → 400; `article` without `devto: true` → 400; article fields + image → 400 (and the UI disables the image picker so users never hit it); at-least-one-destination check includes `devto`.
- JSON body limit: `2mb` (Express default 100kb would 413 a ≤400k-char non-ASCII `bodyMarkdown`). multer keeps handling multipart; `express.json()` handles JSON.
- `PublishResult` gains optional `url?: string` (dev.to article URLs are not derivable from the id) and optional `resultKind?: "created" | "rejected" | "unknown"`. `resultKind` is this plan's carrier for the spec's outcome semantics: `created` = ok row, `rejected` = deterministic 4xx or a nothing-sent failure (auto-unlocks the UI lock), `unknown` = timeout/5xx/transport (keeps it locked until the "checked dev.to" confirmation). Only devto rows carry it (`devto.ts` and the registry's unconfigured-key row); other publishers leave it undefined.
- Duplicate-article defence is client-side by design (stateless app): sessionStorage-backed submit-time lock, per-browser-tab; closing the tab clears it. Accepted v1 tradeoff — do not add server-side state.
- ESLint + `npm run build` must pass at every commit; existing behavior (Bluesky/LinkedIn FormData path) must not regress.

---

### Task 1: Test infrastructure (vitest + jsdom + testing-library)

**Files:**
- Modify: `package.json` (devDependencies + `test` script)
- Create: `vitest.config.ts`
- Create: `tests/ui/smoke.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `npm test` runs vitest; `tests/server/**` runs in node environment, `tests/ui/**` in jsdom. Later tasks place tests at `tests/server/devto-validation.test.ts`, `tests/server/devto.test.ts`, `tests/ui/app-guard.test.tsx`.

- [ ] **Step 1: Install dev tooling**

```bash
npm install --save-dev vitest jsdom @testing-library/react @testing-library/user-event
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // environmentMatchGlobs is deprecated/removed in current vitest — use projects.
    projects: [
      {
        test: {
          name: "server",
          environment: "node",
          include: ["tests/server/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "ui",
          environment: "jsdom",
          include: ["tests/ui/**/*.test.tsx"],
        },
      },
    ],
  },
});
```

- [ ] **Step 3: Add the test script** to `package.json` scripts (after `"lint"`):

```json
"test": "vitest run"
```

- [ ] **Step 4: Write the smoke test** — `tests/ui/smoke.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "../../src/App";

describe("App smoke", () => {
  it("renders the publish surface", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: /publish now/i })).toBeTruthy();
  });
});
```

- [ ] **Step 5: Verify it runs** — Run: `npm test`. Expected: 1 passed (jsdom). If React 19 + testing-library needs `globals` for cleanup, add `test.globals: true` — do not reach for that until a real failure shows it.

- [ ] **Step 6: Lint + build stay green** — Run: `npm run lint && npm run build`. Fix any eslint complaint about the new config/test files only.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tests/ui/smoke.test.tsx
git commit -m "test: vitest + jsdom + testing-library harness with ui/server environments"
```

### Task 2: Article payload types + validation (pure module)

**Files:**
- Modify: `server/publishers/types.ts`
- Create: `server/publishers/devto-validation.ts`
- Test: `tests/server/devto-validation.test.ts`

**Interfaces:**
- Produces (later tasks rely on these exact names/types):

```ts
// types.ts additions
export type DevtoIdentity = "kurt" | "tessera";
export type DevtoArticle = {
  title: string;
  bodyMarkdown: string;
  canonicalUrl?: string;
  description?: string;
  tags?: string[];
};
// PublishContext gains: article?: DevtoArticle
// PublishResult gains: url?: string; resultKind?: "created" | "rejected" | "unknown"
// PublishTargets gains: devto: boolean; devtoIdentity?: DevtoIdentity

// devto-validation.ts exports
export const DISCLOSURE_LINE: string;
export function normalizeTags(tags: string[] | undefined): string[];
export function validateArticle(article: DevtoArticle): string[]; // [] = valid
export function isDisclosurePresent(bodyMarkdown: string): boolean;
export function normalizeForMatch(s: string): string;
```

- [ ] **Step 1: Write failing tests** — `tests/server/devto-validation.test.ts`, article-validation cases:

```ts
import { describe, it, expect } from "vitest";
import {
  DISCLOSURE_LINE,
  normalizeTags,
  validateArticle,
} from "../../server/publishers/devto-validation.js";

const good = {
  title: "A valid title",
  bodyMarkdown: "Some body text.",
};

describe("validateArticle", () => {
  it("accepts a valid minimal article", () => {
    expect(validateArticle(good)).toEqual([]);
  });

  it("rejects a missing or empty title", () => {
    expect(validateArticle({ ...good, title: "" }).length).toBeGreaterThan(0);
  });

  it("rejects a title over 128 chars", () => {
    expect(validateArticle({ ...good, title: "x".repeat(129) }).length).toBeGreaterThan(0);
    expect(validateArticle({ ...good, title: "x".repeat(128) })).toEqual([]);
  });

  it("rejects a missing or empty bodyMarkdown", () => {
    expect(validateArticle({ ...good, bodyMarkdown: "" }).length).toBeGreaterThan(0);
  });

  it("rejects a bodyMarkdown over 400,000 chars", () => {
    expect(validateArticle({ ...good, bodyMarkdown: "x".repeat(400_001) }).length).toBeGreaterThan(0);
    expect(validateArticle({ ...good, bodyMarkdown: "x".repeat(400_000) })).toEqual([]);
  });

  it("rejects more than 4 tags after normalization", () => {
    expect(
      validateArticle({ ...good, tags: ["a", "b", "c", "d", "e"] }).length,
    ).toBeGreaterThan(0);
    expect(validateArticle({ ...good, tags: ["a", "b", "c", "d"] })).toEqual([]);
  });

  it("rejects a canonicalUrl that is not https", () => {
    expect(
      validateArticle({ ...good, canonicalUrl: "http://equationalapplications.com/x" }).length,
    ).toBeGreaterThan(0);
  });

  it("rejects a canonicalUrl whose host is not the exact apex", () => {
    for (const bad of [
      "https://www.equationalapplications.com/x",
      "https://blog.equationalapplications.com/x",
      "https://equationalapplications.com.evil.test/x",
      "not a url",
    ]) {
      expect(validateArticle({ ...good, canonicalUrl: bad }).length).toBeGreaterThan(0);
    }
  });

  it("accepts a canonicalUrl on the exact apex host", () => {
    expect(validateArticle({ ...good, canonicalUrl: "https://equationalapplications.com/post" })).toEqual([]);
  });

  it("accepts a description of any length (counter-surface only)", () => {
    expect(validateArticle({ ...good, description: "x".repeat(500) })).toEqual([]);
  });

  it("returns errors, never throws, on malformed untrusted fields", () => {
    expect(validateArticle({ ...good, title: undefined as unknown as string }).length).toBeGreaterThan(0);
    expect(validateArticle({ ...good, title: 42 as unknown as string }).length).toBeGreaterThan(0);
    expect(validateArticle({ ...good, bodyMarkdown: null as unknown as string }).length).toBeGreaterThan(0);
    expect(validateArticle({ ...good, tags: "a,b" as unknown as string[] }).length).toBeGreaterThan(0);
  });
});

describe("normalizeTags", () => {
  it("lowercases and strips non-alphanumeric characters, dropping empties", () => {
    expect(normalizeTags(["TypeScript!", "AI Agents", "  ", "Web_Dev"])).toEqual([
      "typescript",
      "aiagents",
      "webdev",
    ]);
  });

  it("returns [] for undefined", () => {
    expect(normalizeTags(undefined)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail** — Run: `npm test`. Expected: FAIL (module `devto-validation` does not exist).

- [ ] **Step 3: Extend `server/publishers/types.ts`** — add `DevtoIdentity`, `DevtoArticle`, and the three field additions listed in Interfaces (exact shapes above; `PublishTargets` gains `devto: boolean` + optional `devtoIdentity?: DevtoIdentity` — other publishers never read it).

- [ ] **Step 4: Write the minimal implementation** — `server/publishers/devto-validation.ts`:

```ts
import type { DevtoArticle } from "./types.js";

export const DISCLOSURE_LINE =
  "Posted by Tessera, Kurt VanDusen's executive AI agent at Equational Applications.";

export function normalizeTags(tags: string[] | undefined): string[] {
  return (tags ?? [])
    .map((t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ""))
    .filter((t) => t.length > 0);
}

const CANONICAL_HOST = "equationalapplications.com";

export function validateArticle(article: DevtoArticle): string[] {
  const errors: string[] = [];
  // Route bodies come from untrusted JSON: every field gets a typeof guard BEFORE
  // any .length/.map access, so a malformed article is a 400, never a 500.
  const title = typeof article.title === "string" ? article.title : "";
  const bodyMarkdown = typeof article.bodyMarkdown === "string" ? article.bodyMarkdown : "";
  if (article.tags !== undefined && !Array.isArray(article.tags)) {
    errors.push("tags must be an array of strings");
  }
  const tags = Array.isArray(article.tags)
    ? article.tags.filter((t): t is string => typeof t === "string")
    : [];
  if (Array.isArray(article.tags) && tags.length !== article.tags.length) {
    errors.push("tags must be an array of strings");
  }
  if (!title || !title.trim()) errors.push("title is required");
  if (title.length > 128) errors.push("title must be 128 characters or fewer");
  if (!bodyMarkdown || !bodyMarkdown.trim()) errors.push("bodyMarkdown is required");
  if (bodyMarkdown.length > 400_000) {
    errors.push("bodyMarkdown must be 400,000 characters or fewer");
  }
  if (normalizeTags(tags).length > 4) errors.push("at most 4 tags are allowed");
  if (article.canonicalUrl !== undefined) {
    let host = "";
    try {
      const u = new URL(article.canonicalUrl);
      if (u.protocol !== "https:") throw new Error("not https");
      host = u.hostname;
    } catch {
      errors.push("canonicalUrl must be a valid https URL");
    }
    if (host && host !== CANONICAL_HOST) {
      errors.push("canonicalUrl host must be exactly equationalapplications.com");
    }
  }
  return errors;
}
```

- [ ] **Step 5: Run tests to verify they pass** — Run: `npm test`. Expected: all PASS (disclosure tests not yet written — they are Task 3).

- [ ] **Step 6: Lint + build** — Run: `npm run lint && npm run build`. Expected: green.

- [ ] **Step 7: Commit**

```bash
git add server/publishers/types.ts server/publishers/devto-validation.ts tests/server/devto-validation.test.ts
git commit -m "feat(devto): article payload types + pure article validation"
```

### Task 3: Disclosure guard (pure match rule)

**Files:**
- Modify: `server/publishers/devto-validation.ts`
- Test: `tests/server/devto-validation.test.ts` (append)

**Interfaces:**
- Consumes: `DISCLOSURE_LINE` from Task 2.
- Produces: `normalizeForMatch(s: string): string`, `isDisclosurePresent(bodyMarkdown: string): boolean` (used by Task 6's route guard and tested here).

- [ ] **Step 1: Write failing tests** (append to `tests/server/devto-validation.test.ts`):

```ts
import { isDisclosurePresent, normalizeForMatch } from "../../server/publishers/devto-validation.js";

describe("isDisclosurePresent", () => {
  it("matches the exact line", () => {
    expect(isDisclosurePresent(`Intro.\n\n${DISCLOSURE_LINE}\n\nBody.`)).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(isDisclosurePresent(DISCLOSURE_LINE.toUpperCase())).toBe(true);
  });

  it("matches across whitespace differences", () => {
    expect(isDisclosurePresent("Posted  by Tessera,   Kurt VanDusen's executive\nAI agent at Equational\nApplications.")).toBe(true);
  });

  it("does not match when the disclosure is absent", () => {
    expect(isDisclosurePresent("A perfectly ordinary post by a human.")).toBe(false);
  });

  it("matches curly apostrophes (rich-text paste)", () => {
    expect(isDisclosurePresent(DISCLOSURE_LINE.replace(/'/g, "\u2019"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure** — Run: `npm test`. Expected: FAIL (`isDisclosurePresent` not exported).

- [ ] **Step 3: Implement** (append to `devto-validation.ts`):

```ts
export function normalizeForMatch(s: string): string {
  // \u2019 (curly right single quote) → straight apostrophe: rich-text editors emit
  // curly quotes and a compliant Tessera post must not 400 on paste.
  return s.toLowerCase().replace(/[\u2018\u2019\u02BC]/g, "'").replace(/\s+/g, " ").trim();
}

export function isDisclosurePresent(bodyMarkdown: string): boolean {
  return normalizeForMatch(bodyMarkdown).includes(normalizeForMatch(DISCLOSURE_LINE));
}
```

- [ ] **Step 4: Run to verify pass** — Run: `npm test`. Expected: all PASS.

(Adjudicated limitation, recorded for the reviewer: `isDisclosurePresent` is a substring
match — the disclosure line inside an HTML comment or code fence also satisfies it.
Accepted for v1; the guard's purpose is preventing UNATTRIBUTED Tessera posts, and a
user deliberately hiding the disclosure inside a fence is a different problem. Do not
"fix" this without a new spec decision.)

- [ ] **Step 5: Lint + build, commit**

```bash
npm run lint && npm run build
git add server/publishers/devto-validation.ts tests/server/devto-validation.test.ts
git commit -m "feat(devto): code-enforced Tessera disclosure match rule"
```

### Task 4: Request-rule branching + identity→key resolution (pure module)

**Files:**
- Modify: `server/publishers/devto-validation.ts`
- Test: `tests/server/devto-validation.test.ts` (append)

**Interfaces:**
- Consumes: `validateArticle`, `isDisclosurePresent` (Tasks 2–3), `DevtoIdentity`, `DevtoArticle` from types.
- Produces (Task 6 consumes these exact signatures):

```ts
export function isDevtoKeyConfigured(identity: DevtoIdentity): boolean;
export function devtoIdentities(): DevtoIdentity[]; // ordered Kurt first, only configured identities
export function resolveDevtoIdentityKey(identity: DevtoIdentity): string | undefined;

export type PublishRequestRulesInput = {
  text?: unknown;
  targets: { bluesky: boolean; linkedin: boolean; devto: boolean };
  article?: DevtoArticle | unknown;
  devtoIdentity?: unknown;
  hasImage: boolean;
};
export type PublishRequestRulesResult =
  | { ok: true; text: string; article?: DevtoArticle; identity?: DevtoIdentity }
  | { ok: false; status: 400; error: string };
export function validatePublishRequest(input: PublishRequestRulesInput): PublishRequestRulesResult;
```

(The ok branch ALWAYS carries `identity` — the resolved identity, defaulted from the
first configured entry. The route must copy `rules.identity` into `targets.devtoIdentity`
before calling `publishAll`; the registry reads only `targets.devtoIdentity`. Passing the
identity out-of-band via the raw request body would silently drop the default and the
disclosure check would run against a different identity than the one that publishes.)

- [ ] **Step 1: Write failing tests** (append; stub env vars with `vi.stubEnv`):

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  devtoIdentities,
  isDevtoKeyConfigured,
  resolveDevtoIdentityKey,
  validatePublishRequest,
} from "../../server/publishers/devto-validation.js";

describe("identity resolution", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reports only configured identities, Kurt first", () => {
    vi.stubEnv("DEVTO_API_KEY", "k");
    expect(devtoIdentities()).toEqual(["kurt"]);
    vi.stubEnv("DEVTO_API_KEY_TESSERA", "t");
    expect(devtoIdentities()).toEqual(["kurt", "tessera"]);
    vi.stubEnv("DEVTO_API_KEY", "");
    expect(devtoIdentities()).toEqual(["tessera"]);
  });

  it("isDevtoKeyConfigured + resolveDevtoIdentityKey map the closed enum to env vars", () => {
    vi.stubEnv("DEVTO_API_KEY", "k");
    vi.stubEnv("DEVTO_API_KEY_TESSERA", "t");
    expect(isDevtoKeyConfigured("tessera")).toBe(true);
    expect(resolveDevtoIdentityKey("tessera")).toBe("t");
    expect(isDevtoKeyConfigured("kurt")).toBe(true);
    vi.stubEnv("DEVTO_API_KEY_TESSERA", "");
    expect(isDevtoKeyConfigured("tessera")).toBe(false);
    expect(resolveDevtoIdentityKey("tessera")).toBeUndefined();
  });
});

describe("validatePublishRequest", () => {
  const both = { bluesky: true, linkedin: true, devto: false };

  it("requires text when Bluesky or LinkedIn is targeted", () => {
    expect(validatePublishRequest({ text: "", targets: both, hasImage: false })).toEqual({
      ok: false,
      status: 400,
      error: "text is required",
    });
  });

  it("allows a dev.to-only publish with no text", () => {
    const r = validatePublishRequest({
      targets: { bluesky: false, linkedin: false, devto: true },
      article: { title: "T", bodyMarkdown: "B" },
      hasImage: false,
    });
    expect(r.ok).toBe(true);
  });

  it("400s when no destination at all is targeted", () => {
    expect(
      validatePublishRequest({ text: "x", targets: { bluesky: false, linkedin: false, devto: false }, hasImage: false }),
    ).toEqual({ ok: false, status: 400, error: "Select at least one destination" });
  });

  it("400s on devto without article", () => {
    expect(
      validatePublishRequest({ text: "x", targets: { ...both, devto: true }, hasImage: false }),
    ).toEqual({ ok: false, status: 400, error: "dev.to requires an article" });
  });

  it("400s on article without devto", () => {
    expect(
      validatePublishRequest({ text: "x", targets: both, article: { title: "T", bodyMarkdown: "B" }, hasImage: false }),
    ).toEqual({ ok: false, status: 400, error: "article requires dev.to to be selected" });
  });

  it("400s on article + image", () => {
    expect(
      validatePublishRequest({
        text: "x",
        targets: { ...both, devto: true },
        article: { title: "T", bodyMarkdown: "B" },
        hasImage: true,
      }),
    ).toEqual({ ok: false, status: 400, error: "dev.to does not support images in v1" });
  });

  it("400s on an invalid article (delegates to validateArticle)", () => {
    expect(
      validatePublishRequest({
        targets: { bluesky: false, linkedin: false, devto: true },
        article: { title: "", bodyMarkdown: "B" },
        hasImage: false,
      }),
    ).toEqual({ ok: false, status: 400, error: "title is required" });
  });

  it("400s on a Tessera article without the disclosure line", () => {
    expect(
      validatePublishRequest({
        targets: { bluesky: false, linkedin: false, devto: true },
        article: { title: "T", bodyMarkdown: "No disclosure here." },
        devtoIdentity: "tessera",
        hasImage: false,
      }),
    ).toEqual({ ok: false, status: 400, error: "Tessera-authored posts must include the disclosure line" });
  });

  it("accepts a Tessera article with the disclosure line", () => {
    const r = validatePublishRequest({
      targets: { bluesky: false, linkedin: false, devto: true },
      article: { title: "T", bodyMarkdown: `Intro.\n\nPosted by Tessera, Kurt VanDusen's executive AI agent at Equational Applications.` },
      devtoIdentity: "tessera",
      hasImage: false,
    });
    expect(r.ok).toBe(true);
  });

  it("400s on an unknown devtoIdentity when devto is targeted", () => {
    expect(
      validatePublishRequest({
        targets: { bluesky: false, linkedin: false, devto: true },
        article: { title: "T", bodyMarkdown: "B" },
        devtoIdentity: "root",
        hasImage: false,
      }),
    ).toEqual({ ok: false, status: 400, error: "Unknown dev.to identity" });
  });

  it("ignores a stale devtoIdentity when devto is NOT targeted", () => {
    const r = validatePublishRequest({ text: "x", targets: both, devtoIdentity: "root", hasImage: false });
    expect(r.ok).toBe(true);
  });

  it("defaults an omitted identity to the first configured identity", () => {
    vi.stubEnv("DEVTO_API_KEY", "k");
    const r = validatePublishRequest({
      targets: { bluesky: false, linkedin: false, devto: true },
      article: { title: "T", bodyMarkdown: "B" },
      hasImage: false,
    });
    expect(r.ok).toBe(true); // Kurt default: no disclosure requirement
    if (r.ok) expect(r.identity).toBe("kurt");
  });

  it("returns the chosen identity on the ok branch so the route can pass it to publishAll", () => {
    const r = validatePublishRequest({
      targets: { bluesky: false, linkedin: false, devto: true },
      article: { title: "T", bodyMarkdown: `x\n\nPosted by Tessera, Kurt VanDusen's executive AI agent at Equational Applications.` },
      devtoIdentity: "tessera",
      hasImage: false,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.identity).toBe("tessera");
  });
});
```

(Note: every identity-resolution test stubs exactly the env vars it needs with `vi.stubEnv` and relies on the shared `afterEach(() => vi.unstubAllEnvs())`; no cross-test state.)

- [ ] **Step 2: Run to verify failure** — Run: `npm test`. Expected: FAIL (exports missing).

- [ ] **Step 3: Implement** (append to `devto-validation.ts`):

```ts
import type { DevtoIdentity } from "./types.js";

const IDENTITY_ENV: Record<DevtoIdentity, string> = {
  kurt: "DEVTO_API_KEY",
  tessera: "DEVTO_API_KEY_TESSERA",
};

export function isDevtoKeyConfigured(identity: DevtoIdentity): boolean {
  return Boolean(process.env[IDENTITY_ENV[identity]]);
}

export function resolveDevtoIdentityKey(identity: DevtoIdentity): string | undefined {
  return process.env[IDENTITY_ENV[identity]];
}

export function devtoIdentities(): DevtoIdentity[] {
  return (["kurt", "tessera"] as DevtoIdentity[]).filter((id) => isDevtoKeyConfigured(id));
}

function isDevtoIdentity(v: unknown): v is DevtoIdentity {
  return v === "kurt" || v === "tessera";
}

export function validatePublishRequest(
  input: PublishRequestRulesInput,
): PublishRequestRulesResult {
  const { targets, hasImage } = input;
  if (!targets.bluesky && !targets.linkedin && !targets.devto) {
    return { ok: false, status: 400, error: "Select at least one destination" };
  }
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if ((targets.bluesky || targets.linkedin) && !text) {
    return { ok: false, status: 400, error: "text is required" };
  }
  const articleGiven =
    input.article !== undefined && input.article !== null && typeof input.article === "object";
  if (targets.devto && !articleGiven) {
    return { ok: false, status: 400, error: "dev.to requires an article" };
  }
  if (!targets.devto && articleGiven) {
    return { ok: false, status: 400, error: "article requires dev.to to be selected" };
  }
  if (targets.devto && hasImage) {
    return { ok: false, status: 400, error: "dev.to does not support images in v1" };
  }
  if (targets.devto && input.devtoIdentity !== undefined && !isDevtoIdentity(input.devtoIdentity)) {
    return { ok: false, status: 400, error: "Unknown dev.to identity" };
  }
  const identity: DevtoIdentity | undefined = isDevtoIdentity(input.devtoIdentity)
    ? input.devtoIdentity
    : devtoIdentities()[0];
  let article: DevtoArticle | undefined;
  if (targets.devto && articleGiven) {
    article = input.article as DevtoArticle;
    const errors = validateArticle(article);
    if (errors.length > 0) return { ok: false, status: 400, error: errors[0] };
    if (identity === "tessera" && !isDisclosurePresent(article.bodyMarkdown)) {
      return { ok: false, status: 400, error: "Tessera-authored posts must include the disclosure line" };
    }
  }
  return articleGiven && targets.devto ? { ok: true, text, article, identity } : { ok: true, text, identity };
}
```

- [ ] **Step 4: Run to verify pass** — Run: `npm test`. Expected: all PASS. Note the unknown-identity check runs before the default-resolution line's errors can mask it — if lint flags the ordering, reorder so the 400 check precedes identity defaulting.

- [ ] **Step 5: Lint + build, commit**

```bash
npm run lint && npm run build
git add server/publishers/devto-validation.ts tests/server/devto-validation.test.ts
git commit -m "feat(devto): pure request-rule branching + identity-to-key resolution"
```

### Task 5: Forem publisher with the never-auto-retry rule

**Files:**
- Create: `server/publishers/devto.ts`
- Test: `tests/server/devto.test.ts`

**Interfaces:**
- Consumes: `PublishContext`, `PublishResult` (Task 2), `DevtoIdentity`, `resolveDevtoIdentityKey` (Task 4).
- Produces:

```ts
export function publishDevto(ctx: PublishContext, identity: DevtoIdentity): Promise<PublishResult>;
export const DEVTO_API_BASE: string; // "https://dev.to/api" — exported so tests can point at a local stub server
```

- [ ] **Step 1: Write failing tests** — `tests/server/devto.test.ts`. The retry-rule test proves **exactly one** outbound request per publish call. Use a local `node:http` server as the Forem stub so the real fetch/AbortSignal path is exercised:

```ts
import { describe, it, expect, afterAll, beforeEach, afterEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { publishDevto, DEVTO_API_BASE } from "../../server/publishers/devto.js";

let requests = 0;
let mode: "ok" | "500" | "hang" | "422" | "429" = "ok";

const server: Server = createServer((req, res) => {
  requests += 1;
  if (mode === "ok") {
    res.writeHead(201, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: 42, url: "https://dev.to/kurt/test-article" }));
  } else if (mode === "422") {
    res.writeHead(422, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Validation failed", status: "422" }));
  } else if (mode === "429") {
    res.writeHead(429, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Too many requests", status: "429" }));
  } else if (mode === "500") {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "boom" }));
  } else {
    // hang until the client's AbortSignal fires
  }
});
server.listen(0, "127.0.0.1");
const port = (server.address() as { port: number }).port;
const base = `http://127.0.0.1:${port}`;
afterAll(() => server.close());

beforeEach(() => {
  vi.stubEnv("DEVTO_API_KEY", "test-kurt-key");
  vi.stubEnv("DEVTO_API_KEY_TESSERA", "test-tessera-key");
  process.env.DEVTO_API_BASE_OVERRIDE = base;
  requests = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.DEVTO_API_BASE_OVERRIDE;
});

const ctx = {
  text: "",
  article: { title: "T", bodyMarkdown: `Intro.\n\nPosted by Tessera, Kurt VanDusen's executive AI agent at Equational Applications.` },
};

describe("publishDevto", () => {
  it("posts the article and returns id + url", async () => {
    mode = "ok";
    const r = await publishDevto(ctx, "kurt");
    expect(requests).toBe(1);
    expect(r.ok).toBe(true);
    expect(r.resultKind).toBe("created");
    expect(r.externalId).toBe("42");
    expect(r.url).toBe("https://dev.to/kurt/test-article");
  });

  it("never auto-retries on a 5xx unknown outcome", async () => {
    mode = "500";
    const r = await publishDevto(ctx, "kurt");
    expect(requests).toBe(1); // exactly one outbound request
    expect(r.ok).toBe(false);
    expect(r.resultKind).toBe("unknown");
    expect(r.message).toMatch(/check your dev\.to dashboard|api\/articles\/me/i);
  });

  it("times out after 30s max and reports an unknown outcome, once", async () => {
    mode = "hang";
    const r = await publishDevto(ctx, "kurt");
    expect(requests).toBe(1);
    expect(r.ok).toBe(false);
    expect(r.resultKind).toBe("unknown");
  }, 40_000);

  it("maps a deterministic 4xx to a rejected result with the API error", async () => {
    mode = "422";
    const r = await publishDevto(ctx, "kurt");
    expect(requests).toBe(1);
    expect(r.ok).toBe(false);
    expect(r.resultKind).toBe("rejected");
    expect(r.message).toMatch(/Validation failed/);
  });

  it("maps a 429 rate limit to an unknown outcome (must NOT auto-unlock the UI)", async () => {
    mode = "429";
    const r = await publishDevto(ctx, "kurt");
    expect(requests).toBe(1);
    expect(r.ok).toBe(false);
    expect(r.resultKind).toBe("unknown");
    expect(r.message).toMatch(/429/);
  });

  it("returns a missing-key failure naming the env var when the identity key is absent", async () => {
    vi.stubEnv("DEVTO_API_KEY_TESSERA", "");
    mode = "ok";
    const r = await publishDevto(ctx, "tessera");
    expect(requests).toBe(0); // no outbound request without a key
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/DEVTO_API_KEY_TESSERA/);
  });

  it("sends the api-key header and the Forem body shape", async () => {
    mode = "ok";
    let seen: { headers: Record<string, string | string[] | undefined>; body: string } | null = null;
    const probe: Server = createServer((req, res) => {
      seen = { headers: req.headers, body: "" };
      req.on("data", (c: Buffer) => { (seen as NonNullable<typeof seen>).body += c.toString(); });
      req.on("end", () => {
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: 1, url: "https://dev.to/x" }));
      });
    });
    probe.listen(0, "127.0.0.1");
    const pport = (probe.address() as { port: number }).port;
    process.env.DEVTO_API_BASE_OVERRIDE = `http://127.0.0.1:${pport}`;
    await publishDevto(ctx, "tessera");
    probe.close();
    const s = seen as NonNullable<typeof seen>;
    expect(s.headers["api-key"]).toBe("test-tessera-key"); // DEVTO_API_KEY_TESSERA for the tessera identity
    const parsed = JSON.parse(s.body);
    expect(parsed.article.published).toBe(true);
    expect(parsed.article.body_markdown).toContain("Tessera");
    expect(parsed.article.title).toBe("T");
  });
});
```

(Implementation note: `publishDevto` reads its base URL as `base()`, which honors
`DEVTO_API_BASE_OVERRIDE` **only when `NODE_ENV === "test"`** — the override exists
solely so tests hit a local stub with the real fetch path; production code never sets
it, and a stray value outside tests is ignored so the `api-key` header can never be
redirected to a foreign host. Do not introduce a fetch-mocking library — the spec's
retry rule is about the real request lifecycle.)

- [ ] **Step 2: Run to verify failure** — Run: `npm test`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement** — `server/publishers/devto.ts`:

```ts
import type { DevtoIdentity, PublishContext, PublishResult } from "./types.js";
import { normalizeTags, resolveDevtoIdentityKey } from "./devto-validation.js";

export const DEVTO_API_BASE = "https://dev.to/api";
const TIMEOUT_MS = 30_000;

function base(): string {
  // Test-only override, gated so a stray env var in production can never redirect
  // the api-key header to an attacker-chosen host.
  if (process.env.NODE_ENV === "test" && process.env.DEVTO_API_BASE_OVERRIDE) {
    return process.env.DEVTO_API_BASE_OVERRIDE;
  }
  return DEVTO_API_BASE;
}

function errMsg(e: unknown, fallback: string): string {
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return fallback;
}

function unknownOutcome(reason: string): PublishResult {
  return {
    networkId: "devto",
    ok: false,
    resultKind: "unknown",
    message:
      `${reason}. dev.to publishes are never auto-retried — the article may have been created. ` +
      "Check your dev.to dashboard or GET /api/articles/me before re-posting.",
  };
}

export async function publishDevto(ctx: PublishContext, identity: DevtoIdentity): Promise<PublishResult> {
  const networkId = "devto";
  const key = resolveDevtoIdentityKey(identity);
  if (!key) {
    const envName = identity === "kurt" ? "DEVTO_API_KEY" : "DEVTO_API_KEY_TESSERA";
    return { networkId, ok: false, message: `dev.to not configured for this identity: set ${envName} in .env` };
  }
  const article = ctx.article!;
  const payload = {
    article: {
      title: article.title,
      body_markdown: article.bodyMarkdown,
      published: true,
      ...(article.canonicalUrl !== undefined ? { canonical_url: article.canonicalUrl } : {}),
      ...(article.description !== undefined && article.description !== ""
        ? { description: article.description }
        : {}),
      ...(normalizeTags(article.tags).length > 0
        ? { tags: normalizeTags(article.tags).join(",") }
        : {}),
    },
  };
  let res: Response;
  let bodyText = "";
  try {
    res = await fetch(`${base()}/articles`, {
      method: "POST",
      headers: { "api-key": key, "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Inside the try: the 30s abort can fire during the body read — after the
    // request was sent — and must map to the same unknown-outcome row, not reject.
    bodyText = await res.text();
  } catch (e: unknown) {
    return unknownOutcome(errMsg(e, "Request to dev.to failed"));
  }
  if (res.status >= 500) {
    return unknownOutcome(`dev.to returned ${res.status}`);
  }
  if (res.status === 429) {
    // A rate limit says nothing about whether an earlier request landed — same
    // unknown-outcome treatment as 5xx so the UI lock never auto-releases on it.
    return unknownOutcome("dev.to rate-limited the request (429)");
  }
  let parsed: { id?: number; url?: string; error?: string; status?: string } = {};
  try {
    parsed = JSON.parse(bodyText) as typeof parsed;
  } catch {
    // non-JSON body: fall through to the status-based branches
  }
  if (!res.ok) {
    return {
      networkId,
      ok: false,
      resultKind: "rejected",
      message: `dev.to rejected the article (${res.status}): ${parsed.error ?? bodyText.slice(0, 200)}`,
    };
  }
  return {
    networkId,
    ok: true,
    resultKind: "created",
    externalId: parsed.id !== undefined ? String(parsed.id) : undefined,
    url: parsed.url,
  };
}
```

- [ ] **Step 4: Run to verify pass** — Run: `npm test`. Expected: all PASS (the hang test takes ~30 s — that is the real abort path being proven; do not shorten the timeout constant to speed up tests).

- [ ] **Step 5: Lint + build, commit**

```bash
npm run lint && npm run build
git add server/publishers/devto.ts tests/server/devto.test.ts
git commit -m "feat(devto): Forem publisher, never-auto-retry, created/rejected/unknown outcomes"
```

### Task 6: Registry + route wiring (`express.json()`, rules, `/api/health`)

**Files:**
- Modify: `server/publishers/registry.ts`
- Modify: `server/index.ts`
- Test: `tests/server/publish-route.test.ts` (boots the real app via `createApp()` on an ephemeral port)

**Interfaces:**
- Consumes: `validatePublishRequest`, `devtoIdentities`, `isDevtoKeyConfigured`, `publishDevto`.
- Produces: `createApp(): Express` exported from `server/index.ts` (the `app.listen` call moves behind a `NODE_ENV !== "test"` guard so tests can boot the real app); `publishAll(ctx, targets)` dispatches devto using ONLY `targets.devtoIdentity` (the route sets it from `rules.identity` — the registry never re-defaults, so validation and publishing cannot disagree about identity); a configured-but-missing-key identity fails per-network naming the env var, with `resultKind: "rejected"` (nothing was sent — the UI must auto-unlock); `publishAll` collects with `Promise.allSettled` so one publisher's rejection can never drop another network's result row.

- [ ] **Step 1: Extend `registry.ts`** — add the devto branch and harden the collection:

```ts
import { publishDevto } from "./devto.js";
import { isDevtoKeyConfigured } from "./devto-validation.js";
import type { DevtoIdentity, PublishContext, PublishResult, PublishTargets } from "./types.js";

type Job = { networkId: string; promise: Promise<PublishResult> };
const jobs: Job[] = []; // replaces the old Promise<PublishResult>[] — networkId rides with the job

// bluesky / linkedin branches push { networkId: "bluesky" | "linkedin", promise: ... } —
// same logic as today, only the wrapper changes.

// devto branch — identity comes from targets ONLY. No re-defaulting here: the route
// sets targets.devtoIdentity from rules.identity, so validation and publishing cannot
// disagree about identity.
if (targets.devto) {
  const identity: DevtoIdentity | undefined = targets.devtoIdentity;
  if (identity && isDevtoKeyConfigured(identity)) {
    jobs.push({ networkId: "devto", promise: publishDevto(ctx, identity) });
  } else {
    const envName = identity === "tessera" ? "DEVTO_API_KEY_TESSERA" : "DEVTO_API_KEY";
    jobs.push({
      networkId: "devto",
      promise: Promise.resolve({
        networkId: "devto",
        ok: false,
        resultKind: "rejected" as const, // deterministic, nothing sent — UI auto-unlocks
        message: `dev.to not configured for this identity: set ${envName} in .env`,
      }),
    });
  }
}

// collection: allSettled, so a rejecting publisher can never drop another network's
// row — and the fallback row carries the JOB's networkId, so the UI's devto rules
// still fire (a fallback row with networkId "unknown" would look like a missing
// devto row and could be misread as an unlock).
const settled = await Promise.allSettled(jobs.map((j) => j.promise));
return settled.map((s, i) =>
  s.status === "fulfilled"
    ? s.value
    : {
        networkId: jobs[i].networkId,
        ok: false,
        resultKind: "unknown" as const,
        message: `Internal error: ${String(s.reason)}`,
      },
);
```

- [ ] **Step 2: Wire the route** — in `server/index.ts`, restructure into an exported `createApp()` so the REAL app is testable (this is what catches identity-dropping wiring bugs the pure module cannot see):

  - Move the app construction into:

```ts
export function createApp(): Express {
  const app = express();
  app.use(express.json({ limit: "2mb" })); // default 100kb would 413 a <=400k-char bodyMarkdown
  // ...upload, /api/publish, /api/health, static fallback, error middleware...
  return app;
}

if (process.env.NODE_ENV !== "test") {
  createApp().listen(PORT, "127.0.0.1", () => {
    console.log(`API listening on http://127.0.0.1:${PORT}`);
  });
}
```

  - The `/api/publish` handler — identity passthrough from the validated rules (BLOCKER-1 fix: `targets.devtoIdentity` is set from `rules.identity`, never from the raw body):

```ts
app.post("/api/publish", upload.single("image"), async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const targets = {
      bluesky: parseFlag(body.bluesky),
      linkedin: parseFlag(body.linkedin),
      devto: parseFlag(body.devto),
    };
    const devtoIdentity = typeof body.devtoIdentity === "string" ? body.devtoIdentity : undefined;
    const article = body.article;
    const file = req.file;
    const hasImage = Boolean(file && file.buffer.length);
    const rules = validatePublishRequest({ text: body.text, targets, article, devtoIdentity, hasImage });
    if (!rules.ok) {
      res.status(rules.status).json({ error: rules.error });
      return;
    }
    if (targets.devto) targets.devtoIdentity = rules.identity;
    const ctx = {
      text: rules.text,
      article: rules.article,
      image: hasImage && file ? { buffer: file.buffer, mimeType: file.mimetype } : undefined,
    };
    const results = await publishAll(ctx, targets);
    res.json({ results });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Publish failed";
    res.status(500).json({ error: msg });
  }
});
```

  - Extend `/api/health`:

```ts
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, devtoIdentities: devtoIdentities() });
});
```

- [ ] **Step 3: Route tests against the REAL app** — `tests/server/publish-route.test.ts` boots `createApp()` on port 0 and speaks HTTP, with the Forem stub from `devto.test.ts` behind `DEVTO_API_BASE_OVERRIDE`. This is the test that would have caught the identity-dropping bug:

```ts
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../../server/index.js";

// Deterministic bluesky rejection via module mock — no env-var roulette: the real
// isBlueskyConfigured may treat an empty handle as configured, so forcing failure
// through env values alone is not reliable.
vi.mock("../../server/publishers/bluesky.js", () => ({
  isBlueskyConfigured: () => true,
  publishBluesky: async () => ({ networkId: "bluesky", ok: false, message: "stubbed bluesky failure" }),
}));

let appUrl = "";
let forseen: { apiKey?: string; body?: string } = {};

const forem: Server = createServer((req, res) => {
  forseen = { apiKey: req.headers["api-key"] as string | undefined, body: "" };
  req.on("data", (c: Buffer) => { forseen.body += c.toString(); });
  req.on("end", () => {
    res.writeHead(201, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: 42, url: "https://dev.to/t/article" }));
  });
});

beforeAll(async () => {
  forem.listen(0, "127.0.0.1");
  const fport = (forem.address() as AddressInfo).port;
  // vi.stubEnv: every assignment is undone by the single unstubAllEnvs in afterAll —
  // no direct process.env writes, no cross-file leakage.
  vi.stubEnv("DEVTO_API_BASE_OVERRIDE", `http://127.0.0.1:${fport}`);
  vi.stubEnv("DEVTO_API_KEY", "kurt-route-key");
  vi.stubEnv("DEVTO_API_KEY_TESSERA", "tessera-route-key");
  const app = createApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  appUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  vi.unstubAllEnvs();
  forem.close();
});

const article = {
  title: "T",
  bodyMarkdown: `Intro.\n\nPosted by Tessera, Kurt VanDusen's executive AI agent at Equational Applications.`,
};

describe("POST /api/publish (real app)", () => {
  it("routes the SELECTED identity's key to dev.to (identity passthrough)", async () => {
    const res = await fetch(`${appUrl}/api/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ devto: true, devtoIdentity: "tessera", article }),
    });
    const json = await res.json() as { results: Array<{ networkId: string; ok: boolean }> };
    expect(json.results.find((r) => r.networkId === "devto")?.ok).toBe(true);
    expect(forseen.apiKey).toBe("tessera-route-key"); // NOT kurt-route-key
  });

  it("defaults an omitted identity to Kurt", async () => {
    const res = await fetch(`${appUrl}/api/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ devto: true, article }),
    });
    await res.json();
    expect(forseen.apiKey).toBe("kurt-route-key");
  });

  it("400s on a rule violation without touching dev.to", async () => {
    const res = await fetch(`${appUrl}/api/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ devto: true }),
    });
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toMatch(/dev\.to requires an article/);
  });

  it("returns per-network rows even when a publisher rejects", async () => {
    const res = await fetch(`${appUrl}/api/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ devto: true, bluesky: true, text: "hello", article }),
    });
    const json = await res.json() as { results: Array<{ networkId: string; ok: boolean }> };
    const rows = json.results.map((r) => r.networkId).sort();
    expect(rows).toEqual(["bluesky", "devto"]); // both rows present despite the bluesky failure
    expect(json.results.find((r) => r.networkId === "bluesky")?.ok).toBe(false);
  });

  it("health exposes the configured identity list", async () => {
    const res = await fetch(`${appUrl}/api/health`);
    const json = await res.json() as { devtoIdentities: string[] };
    expect(json.devtoIdentities).toEqual(["kurt", "tessera"]);
  });
});
```

(Note: `createApp()` boots at `NODE_ENV === "test"` without listening, and vitest sets that env var — the `NODE_ENV !== "test"` guard around `listen` in `server/index.ts` is what makes this import safe. If a test run shows the guard is wrong for your vitest version, assert `process.env.NODE_ENV` in the first failing test before changing the guard.)

- [ ] **Step 4: Run to verify pass** — Run: `npm test`. Expected: all PASS.

- [ ] **Step 5: Manual smoke** — Run: `npm run build && node dist/server/index.js &` then `curl -s http://127.0.0.1:3001/api/health`. Expected: `{"ok":true,"devtoIdentities":[...]}` reflecting whatever keys are in the local `.env` (may be `[]` — fine). Kill the server. Also `curl -s -X POST http://127.0.0.1:3001/api/publish -H 'content-type: application/json' -d '{"devto":true}'` → `400` with `dev.to requires an article`. (No keys are exercised; nothing publishes.)

- [ ] **Step 6: Lint + build, commit**

```bash
npm run lint && npm run build
git add server/index.ts server/publishers/registry.ts tests/server/publish-route.test.ts
git commit -m "feat(devto): express.json route wiring, health identities, registry dispatch"
```

### Task 7: UI — article fields, identity selector, submit-time dev.to lock

**Files:**
- Modify: `src/App.tsx`
- Test: `tests/ui/app-guard.test.tsx`

**Interfaces:**
- Consumes: `/api/health` `devtoIdentities`; publish API contract (`devto`, `devtoIdentity`, `article` fields; result rows with `resultKind`, `url`).
- Produces: UI behavior per spec §1–§3. No exports other than the default `App`.

**State additions:** `devto: boolean`, `devtoIdentity: string | null`, `title`, `bodyMarkdown`, `canonicalUrl`, `description`, `tags` (comma-separated string), `identities: string[]` (from health), `devtoLocked: boolean`, `devtoCheckConfirmed: boolean`.

**sessionStorage key:** `crosspost.devtoPending` (value `"1"`).

**Submit path:** when `devto` is true AND not locked → `fetch("/api/publish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ devto: true, devtoIdentity, article: { title, bodyMarkdown, canonicalUrl: canonicalUrl || undefined, description: description || undefined, tags: tags ? tags.split(",").map(t => t.trim()).filter(Boolean) : undefined } }) })`. When `devtoLocked` → the request is the **existing FormData path for the remaining targets only** — it never contains `devto`, `article`, or `devtoIdentity`, whatever the checkbox shows (locked dev.to cannot ride along on a Bluesky/LinkedIn submit). When devto is unchecked → the existing FormData path unchanged.

**Lock rules (the heart of this task):**
1. On submit with `devto` targeted: set `sessionStorage["crosspost.devtoPending"] = "1"` and `devtoLocked = true` **before** the fetch (unknown outcome starts at submit, not at response). A synchronous `submitting` ref is set at the same moment (rule 7).
2. After the response: if the devto result row has `resultKind === "created"` or `"rejected"` → clear the flag, `devtoLocked = false`.
3. If the fetch threw (network error), the response status is 5xx or 429, the devto row has `resultKind === "unknown"`, **or dev.to was requested but the results contain no devto row** → keep the flag, keep `devtoLocked = true`, show the confirmation checkbox. Any other **HTTP 4xx response** (400 validation, 413 body limit, unknown identity — none of which can have created an article) **unlocks** exactly like a `rejected` row.
4. The confirmation checkbox (label: `I checked dev.to — no duplicate article`) is rendered **whenever `devtoLocked` is true** — after an unknown outcome AND after a reload; ticking it clears the flag and unlocks. Reset clears the form fields but NOT the flag or the confirmation requirement.
5. On mount: if `sessionStorage["crosspost.devtoPending"]` is set → `devtoLocked = true` and the confirmation checkbox renders (rule 4) — a reloaded tab always has an exit hatch; the only way to be stuck is to never confirm.
6. While locked: the dev.to checkbox is disabled and checked; the article fieldset renders disabled; if devto was the only target the Publish button is disabled too. A locked dev.to target can NEVER be included in any outgoing payload (see Submit path) — the UI never sends one, whatever else the user targets.
7. Double-click guard: the submit handler checks the `submitting` ref synchronously and returns if it is already set (state updates are async; the ref is not), sets it before any fetch, and clears it in a `finally`. The Publish button is disabled while `submitting`. A double-click can therefore never send two devto requests in one session.

- [ ] **Step 1: Write the failing UI-guard test** — `tests/ui/app-guard.test.tsx` (stub `fetch` with `vi.stubGlobal`; the health call returns `{ ok: true, devtoIdentities: ["kurt", "tessera"] }`):

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "../../src/App";

function healthThen(payload: unknown) {
  return vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, devtoIdentities: ["kurt", "tessera"] }) })
    .mockResolvedValueOnce(payload);
}

const created = { ok: true, json: async () => ({ results: [{ networkId: "devto", ok: true, resultKind: "created", externalId: "42", url: "https://dev.to/x" }] }) };
const unknownRow = { ok: true, json: async () => ({ results: [{ networkId: "devto", ok: false, resultKind: "unknown", message: "may exist" }] }) };
const rejectedRow = { ok: true, json: async () => ({ results: [{ networkId: "devto", ok: false, resultKind: "rejected", message: "422" }] }) };

async function fillArticleForm() {
  fireEvent.change(screen.getByLabelText(/post title/i), { target: { value: "T" } });
  fireEvent.change(screen.getByLabelText(/article body/i), { target: { value: "B" } });
}

describe("dev.to submit-time lock", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

  it("locks dev.to at submit before the response arrives, clears on created", async () => {
    const f = healthThen(created);
    vi.stubGlobal("fetch", f);
    render(<App />);
    fireEvent.click(screen.getByLabelText(/dev\.to/i));
    await fillArticleForm();
    fireEvent.click(screen.getByRole("button", { name: /publish now/i }));
    expect(sessionStorage.getItem("crosspost.devtoPending")).toBe("1");
    expect((screen.getByLabelText(/dev\.to/i) as HTMLInputElement).disabled).toBe(true);
    await screen.findByText("https://dev.to/x"); // the created row links the article url
    expect(sessionStorage.getItem("crosspost.devtoPending")).toBeNull();
  });

  it("stays locked after an unknown outcome until the confirmation is ticked", async () => {
    const f = healthThen(unknownRow);
    vi.stubGlobal("fetch", f);
    render(<App />);
    fireEvent.click(screen.getByLabelText(/dev\.to/i));
    await fillArticleForm();
    fireEvent.click(screen.getByRole("button", { name: /publish now/i }));
    await waitFor(() => screen.getByLabelText(/checked dev\.to/i));
    expect(sessionStorage.getItem("crosspost.devtoPending")).toBe("1");
    fireEvent.click(screen.getByLabelText(/checked dev\.to/i));
    expect(sessionStorage.getItem("crosspost.devtoPending")).toBeNull();
  });

  it("unlocks automatically on a deterministic rejection", async () => {
    const f = healthThen(rejectedRow);
    vi.stubGlobal("fetch", f);
    render(<App />);
    fireEvent.click(screen.getByLabelText(/dev\.to/i));
    await fillArticleForm();
    fireEvent.click(screen.getByRole("button", { name: /publish now/i }));
    await waitFor(() => expect(sessionStorage.getItem("crosspost.devtoPending")).toBeNull());
  });

  it("survives a reload: re-mount with the pending flag keeps the lock", async () => {
    sessionStorage.setItem("crosspost.devtoPending", "1");
    vi.stubGlobal("fetch", healthThen(created));
    render(<App />);
    expect((screen.getByLabelText(/dev\.to/i) as HTMLInputElement).disabled).toBe(true);
    await waitFor(() => screen.getByLabelText(/checked dev\.to/i));
  });

  it("shows the identity selector when more than one identity is configured", async () => {
    vi.stubGlobal("fetch", healthThen(created));
    render(<App />);
    await waitFor(() => screen.getByLabelText(/publish as/i));
    fireEvent.click(screen.getByLabelText(/dev\.to/i));
    expect(screen.getByLabelText(/publish as/i).textContent).toMatch(/Tessera/);
  });

  it("disables the image picker when dev.to is checked", async () => {
    vi.stubGlobal("fetch", healthThen(created));
    render(<App />);
    fireEvent.click(screen.getByLabelText(/dev\.to/i));
    expect((screen.getByLabelText(/optional image/i) as HTMLInputElement).disabled).toBe(true);
  });

  it("never includes dev.to in a payload submitted while locked (other targets ride alone)", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, devtoIdentities: ["kurt", "tessera"] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ networkId: "devto", ok: false, resultKind: "unknown", message: "may exist" }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ networkId: "bluesky", ok: false, message: "not configured" }] }) });
    vi.stubGlobal("fetch", f);
    render(<App />);
    fireEvent.click(screen.getByLabelText(/dev\.to/i));
    await fillArticleForm();
    fireEvent.click(screen.getByRole("button", { name: /publish now/i }));
    await waitFor(() => screen.getByLabelText(/checked dev\.to/i));
    // now fill the short-form text and submit again with Bluesky alongside the locked dev.to
    fireEvent.change(screen.getByLabelText(/post text/i), { target: { value: "short post" } });
    fireEvent.click(screen.getByLabelText(/bluesky/i));
    fireEvent.click(screen.getByRole("button", { name: /publish now/i }));
    await waitFor(() => expect(f).toHaveBeenCalledTimes(3));
    // call 0 = health, call 1 = first publish (JSON, contains article), call 2 = locked submit:
    const lockedInit = f.mock.calls[2]?.[1] as RequestInit;
    const lockedBody = lockedInit.body as FormData;
    expect(lockedInit.headers && (lockedInit.headers as Record<string, string>)["content-type"]).toBeUndefined(); // FormData path, not JSON
    expect(lockedBody.get("devto")).toBeNull();
    expect(lockedBody.get("title")).toBeNull();
    expect(lockedBody.get("bodyMarkdown")).toBeNull();
    expect(lockedBody.get("text")).toBe("short post");
  });

  it("a double-click sends exactly one devto request", async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, devtoIdentities: ["kurt", "tessera"] }) })
      .mockReturnValueOnce(new Promise((res) => { resolveFirst = res; })); // first publish hangs until we resolve it
    vi.stubGlobal("fetch", f);
    render(<App />);
    fireEvent.click(screen.getByLabelText(/dev\.to/i));
    await fillArticleForm();
    const publish = screen.getByRole("button", { name: /publish now/i });
    fireEvent.click(publish);
    fireEvent.click(publish); // second click while in flight
    resolveFirst({ ok: true, json: async () => ({ results: [{ networkId: "devto", ok: true, resultKind: "created", url: "https://dev.to/x" }] }) });
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2)); // health + ONE publish only
    expect(f.mock.calls.filter((c) => String(c[0]).includes("/api/publish")).length).toBe(1);
  });

  it("unlocks on a deterministic 4xx response with no result rows", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, devtoIdentities: ["kurt", "tessera"] }) })
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: "dev.to does not support images in v1" }) });
    vi.stubGlobal("fetch", f);
    render(<App />);
    fireEvent.click(screen.getByLabelText(/dev\.to/i));
    await fillArticleForm();
    fireEvent.click(screen.getByRole("button", { name: /publish now/i }));
    await waitFor(() => expect(sessionStorage.getItem("crosspost.devtoPending")).toBeNull());
  });
});
```

(Label text is part of the contract: `dev.to` for the target checkbox, `Post text` for the short-form textarea, `Post title`, `Article body`, `Optional image`, `publish as` for the identity selector, `checked dev.to` inside the confirmation label, `bluesky` for the Bluesky checkbox. Adjust `getByLabelText` regexes only if a test proves ambiguous — then update BOTH sides.)

- [ ] **Step 2: Run to verify failure** — Run: `npm test`. Expected: FAIL (no dev.to UI yet).

- [ ] **Step 3: Implement `src/App.tsx`** — extend the existing component:
  - `useEffect` on mount: `fetch("/api/health")` → set `identities`; read `sessionStorage["crosspost.devtoPending"]` → set `devtoLocked`.
  - When `devto` checked: render title input (`Post title`, maxLength 128), article textarea (`Article body`, maxLength 400000), canonical URL input (placeholder showing the apex-host rule), description input with a live `~140` counter (`description.length` shown; display-only), tags input (comma-separated, ≤ 4 after normalization). Hide the short-form text requirement: when devto-only, `canPublish` requires a non-empty title + body instead of text.
  - Identity selector `<select aria-label="publish as">` rendered only when `identities.length > 1`, options labeled `Kurt` / `Tessera`, default = first identity.
  - Image picker input gets `disabled={devto}` and clearing `file` when devto is toggled on.
  - Submit per the **Submit path** above; lock rules 1–6 exactly.
  - Result rows render the `url` as a link when present.
  - Add a `Reset` button: clears text/article fields/file/results, does NOT touch `crosspost.devtoPending` or the confirmation requirement.

- [ ] **Step 4: Run to verify pass** — Run: `npm test`. Expected: all PASS.

- [ ] **Step 5: Lint + build** — Run: `npm run lint && npm run build`. Expected: green.

- [ ] **Step 6: Manual browser smoke (no keys needed)** — `npm run dev`, open the UI, tick dev.to with no title → confirm the form demands article fields; set a title/body → confirm JSON goes out (DevTools network tab: content-type application/json); untick → confirm FormData path still works for Bluesky-only with stubbed/no keys returning the not-configured error rows.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx tests/ui/app-guard.test.tsx
git commit -m "feat(devto): article UI, identity selector, submit-time sessionStorage lock"
```

### Task 8: Config, docs, validate script (includes committing the untracked mirror target)

**Files:**
- Modify: `.env.example`, `README.md`
- Create: `scripts/validate-devto.mjs`
- Commit also: `scripts/validate-bluesky.mjs` (untracked working-tree file the spec cites as the mirror target — content verified clean 2026-11-04: read-only credential check, no secrets)

**Interfaces:** standalone scripts, run manually with a real key.

- [ ] **Step 1: Commit the untracked mirror target first**

```bash
git add scripts/validate-bluesky.mjs
git commit -m "chore: track scripts/validate-bluesky.mjs (spec mirror target, verified clean)"
```

- [ ] **Step 2: Write `scripts/validate-devto.mjs`** (mirrors the bluesky script's shape: read-only, never prints the key):

```js
// Read-only dev.to credential check: GET /api/articles/me with the key, print the
// account name, immediately done. Never prints the API key.
// Usage: DEVTO_API_KEY=... node scripts/validate-devto.mjs   (or DEVTO_API_KEY_TESSERA)
import "dotenv/config";

const key = process.env.DEVTO_API_KEY ?? process.env.DEVTO_API_KEY_TESSERA;
const which = process.env.DEVTO_API_KEY ? "DEVTO_API_KEY" : process.env.DEVTO_API_KEY_TESSERA ? "DEVTO_API_KEY_TESSERA" : null;
if (!key) {
  console.error("MISSING: DEVTO_API_KEY / DEVTO_API_KEY_TESSERA not set");
  process.exit(2);
}
try {
  const res = await fetch("https://dev.to/api/articles/me", {
    headers: { "api-key": key },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    console.log(JSON.stringify({ ok: false, status: res.status, identity: which }));
    process.exit(1);
  }
  const articles = await res.json();
  console.log(JSON.stringify({ ok: true, identity: which, articleCount: Array.isArray(articles) ? articles.length : null }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e?.message ?? e), identity: which }));
  process.exit(1);
}
```

- [ ] **Step 3: `.env.example`** — append (with the two identities commented as optional in the doc sense; the keys themselves stay blank):

```bash
# dev.to (Forem API) — optional; generate at https://dev.to/settings/extensions
DEVTO_API_KEY=
# Tessera's account key (optional; enables the Tessera identity)
DEVTO_API_KEY_TESSERA=
```

- [ ] **Step 4: README dev.to section** — add after the existing network sections, plain prose: what dev.to targeting does (long-form article + title/body/tags/description/canonical URL), key generation at dev.to/settings/extensions, the two identity env vars and how the selector appears, the Tessera disclosure rule (server-enforced 400), the canonical-URL apex-host rule, and the never-auto-retry + locked-until-you-check-dev.to behavior with the explicit per-browser-tab limitation.

- [ ] **Step 5: Lint + build, commit**

```bash
npm run lint && npm run build
git add scripts/validate-devto.mjs .env.example README.md
git commit -m "docs(devto): env example, README section, validate-devto script"
```

### Task 9: Full verification + ledger reconcile

**Files:**
- Modify: `specs/2026-11-03-devto-publisher/LEDGER.md`

- [ ] **Step 1: Full suite** — Run: `npm run lint && npm run build && npm test`. Expected: lint clean, build green, every test passing (including the ~30 s hang-case retry test).
- [ ] **Step 2: Ledger reconcile against disk** — every LEDGER.md box gets an evidence line (command + observed output path/commit sha); trust the disk if ledger and disk disagree, and roll the ledger back.
- [ ] **Step 3: Diff review against the spec** — walk `specs/2026-11-03-devto-publisher/spec.md` §1–§5 and the Files-touched list; every item maps to a landed commit or is explicitly marked out-of-scope in the ledger.
- [ ] **Step 4: Commit the ledger**

```bash
git add specs/2026-11-03-devto-publisher/LEDGER.md
git commit -m "docs(devto): ledger reconcile — all tasks evidenced"
```

## What's in flight after Task 9

- `npm run ready` is NOT a thing here — the draft→ready flip (status → `Implemented`, delete `plan.md` + `LEDGER.md`, `gh pr ready`) happens per the ONE-PR LIFECYCLE only after the internal review loops converge, then the bot gauntlet runs. Manual step by the controller, not a plan task.
- Remaining manual gates (never in this plan): `scripts/validate-devto.mjs` against real keys (Kurt provides keys via pass → `.env`); first live post waits on the ea-site merge.
