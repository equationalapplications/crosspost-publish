import { describe, it, expect, vi, afterEach } from "vitest";
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
  afterEach(() => vi.unstubAllEnvs()); // "defaults an omitted identity" stubs DEVTO_API_KEY — keep it from leaking
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
