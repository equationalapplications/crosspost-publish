import type { DevtoArticle, DevtoIdentity } from "./types.js";

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
  if (article.description !== undefined && typeof article.description !== "string") {
    errors.push("description must be a string");
  }
  return errors;
}

export function isDisclosurePresent(bodyMarkdown: string): boolean {
  return normalizeForMatch(bodyMarkdown).includes(normalizeForMatch(DISCLOSURE_LINE));
}

export function normalizeForMatch(s: string): string {
  // \u2019 (curly right single quote) → straight apostrophe: rich-text editors emit
  // curly quotes and a compliant Tessera post must not 400 on paste.
  return s.toLowerCase().replace(/[\u2018\u2019\u02BC]/g, "'").replace(/\s+/g, " ").trim();
}

const IDENTITY_ENV: Record<DevtoIdentity, string> = {
  kurt: "DEVTO_API_KEY",
  tessera: "DEVTO_API_KEY_TESSERA",
};

/** Single source of truth for the env-var name of an identity (spec §identities). */
export function devtoEnvName(identity: DevtoIdentity): string {
  return IDENTITY_ENV[identity];
}

export function isDevtoKeyConfigured(identity: DevtoIdentity): boolean {
  return Boolean(process.env[IDENTITY_ENV[identity]]);
}

export function resolveDevtoIdentityKey(identity: DevtoIdentity): string | undefined {
  // An empty env value counts as unconfigured, matching isDevtoKeyConfigured.
  const key = process.env[IDENTITY_ENV[identity]];
  return key ? key : undefined;
}

export function devtoIdentities(): DevtoIdentity[] {
  return (["kurt", "tessera"] as DevtoIdentity[]).filter((id) => isDevtoKeyConfigured(id));
}

function isDevtoIdentity(v: unknown): v is DevtoIdentity {
  return v === "kurt" || v === "tessera";
}

export type PublishRequestRulesInput = {
  text?: unknown;
  targets: { bluesky: boolean; linkedin: boolean; devto: boolean };
  article?: unknown;
  devtoIdentity?: unknown;
  hasImage: boolean;
};

export type PublishRequestRulesResult =
  | { ok: true; text: string; article?: DevtoArticle; identity?: DevtoIdentity }
  | { ok: false; status: 400; error: string };

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
