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
