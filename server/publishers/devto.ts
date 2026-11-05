import type { DevtoIdentity, PublishContext, PublishResult } from "./types.js";
import { normalizeTags, devtoEnvName, resolveDevtoIdentityKey } from "./devto-validation.js";

export const DEVTO_API_BASE = "https://dev.to/api";
const TIMEOUT_MS = 30_000;

function base(): string {
  // Test-only override, gated on VITEST (which vitest itself sets and production
  // deployments do not — stronger than NODE_ENV, which a deploy can set to "test").
  // A stray env var in production therefore cannot redirect the api-key header.
  if (process.env.VITEST && process.env.DEVTO_API_BASE_OVERRIDE) {
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

function unknownOutcome(identity: DevtoIdentity, reason: string): PublishResult {
  return {
    networkId: "devto",
    ok: false,
    resultKind: "unknown",
    // The identity is in EVERY message (spec §per-network reporting): with two
    // accounts, "check your dashboard" without a name invites checking the wrong one.
    message:
      `dev.to (${identity}): ${reason}. dev.to publishes are never auto-retried — the article may have been created. ` +
      "Check this identity's dev.to dashboard or GET /api/articles/me before re-posting.",
  };
}

export async function publishDevto(ctx: PublishContext, identity: DevtoIdentity): Promise<PublishResult> {
  const networkId = "devto";
  const key = resolveDevtoIdentityKey(identity);
  if (!key) {
    const envName = devtoEnvName(identity);
    return {
      networkId,
      ok: false,
      resultKind: "rejected", // deterministic, nothing sent — UI auto-unlocks
      message: `dev.to (${identity}): not configured for this identity — set ${envName} in .env`,
    };
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
    return unknownOutcome(identity, errMsg(e, "Request to dev.to failed"));
  }
  if (res.status >= 500) {
    return unknownOutcome(identity, `dev.to returned ${res.status}`);
  }
  if (res.status === 429) {
    // A rate limit says nothing about whether an earlier request landed — same
    // unknown-outcome treatment as 5xx so the UI lock never auto-releases on it.
    return unknownOutcome(identity, "dev.to rate-limited the request (429)");
  }
  let parsed: { id?: number; url?: string; error?: string; status?: string } = {};
  try {
    parsed = (JSON.parse(bodyText) ?? {}) as typeof parsed; // null body → {} (a JSON `null` would throw on .id/.error below)
  } catch {
    // non-JSON body: fall through to the status-based branches
  }
  if (!res.ok) {
    return {
      networkId,
      ok: false,
      resultKind: "rejected",
      message: `dev.to (${identity}): rejected the article (${res.status}): ${parsed.error ?? bodyText.slice(0, 200)}`,
    };
  }
  if (typeof parsed.id !== "number") {
    // A 2xx we cannot tie to a numeric article id (captive-portal HTML,
    // id-less success, or a non-numeric/null `id` — the cast above validates
    // nothing at runtime) is an UNKNOWN outcome, never a success — reporting
    // `created` here would auto-unlock the UI duplicate guard on a
    // possibly-double-posted article.
    return unknownOutcome(identity, "dev.to returned an unparseable or id-less success response");
  }
  return {
    networkId,
    ok: true,
    resultKind: "created",
    externalId: String(parsed.id),
    url: parsed.url,
  };
}
