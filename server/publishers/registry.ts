import { publishBluesky, isBlueskyConfigured } from "./bluesky.js";
import { publishLinkedIn, isLinkedInConfigured } from "./linkedin.js";
import { publishDevto } from "./devto.js";
import { devtoEnvName, isDevtoKeyConfigured } from "./devto-validation.js";
import type { DevtoIdentity, PublishContext, PublishResult, PublishTargets } from "./types.js";

type Job = { label: string; networkId: string; promise: Promise<PublishResult> };

// Full publishAll — bluesky/linkedin branches keep their existing logic, wrapped as
// Jobs so the allSettled fallback can name the network on a rejected promise. devto
// jobs carry an identity label so even a fallback row names the account (spec
// §per-network reporting: EVERY devto message names the identity).
export async function publishAll(ctx: PublishContext, targets: PublishTargets): Promise<PublishResult[]> {
  const jobs: Job[] = [];

  if (targets.bluesky) {
    if (isBlueskyConfigured()) {
      jobs.push({ label: "bluesky", networkId: "bluesky", promise: publishBluesky(ctx) });
    } else {
      jobs.push({
        label: "bluesky",
        networkId: "bluesky",
        promise: Promise.resolve({
          networkId: "bluesky",
          ok: false,
          message: "Bluesky not configured: set BLUESKY_HANDLE and BLUESKY_APP_PASSWORD in .env",
        }),
      });
    }
  }

  if (targets.linkedin) {
    if (isLinkedInConfigured()) {
      jobs.push({ label: "linkedin", networkId: "linkedin", promise: publishLinkedIn(ctx) });
    } else {
      jobs.push({
        label: "linkedin",
        networkId: "linkedin",
        promise: Promise.resolve({
          networkId: "linkedin",
          ok: false,
          message: "LinkedIn not configured: set LINKEDIN_ACCESS_TOKEN and LINKEDIN_PERSON_URN in .env",
        }),
      });
    }
  }

  // devto branch — identity comes from targets ONLY. No re-defaulting here: the route
  // sets targets.devtoIdentity from rules.identity, so validation and publishing cannot
  // disagree about identity.
  if (targets.devto) {
    const identity: DevtoIdentity | undefined = targets.devtoIdentity;
    if (identity && isDevtoKeyConfigured(identity)) {
      jobs.push({ label: `dev.to (${identity})`, networkId: "devto", promise: publishDevto(ctx, identity) });
    } else {
      const envName = identity ? devtoEnvName(identity) : "DEVTO_API_KEY";
      jobs.push({
        label: `dev.to (${identity ?? "unresolved"})`,
        networkId: "devto",
        promise: Promise.resolve({
          networkId: "devto",
          ok: false,
          resultKind: "rejected" as const, // deterministic, nothing sent — UI auto-unlocks
          message: `dev.to (${identity ?? "unresolved"}): not configured for this identity — set ${envName} in .env`,
        }),
      });
    }
  }

  // collection: allSettled, so a rejecting publisher can never drop another network's
  // row — and the fallback row carries the JOB's networkId (and the devto identity
  // label), so the UI's devto rules still fire and the message still names the account.
  const settled = await Promise.allSettled(jobs.map((j) => j.promise));
  return settled.map((s, i) =>
    s.status === "fulfilled"
      ? s.value
      : {
          networkId: jobs[i].networkId,
          ok: false,
          // resultKind only on devto rows (only devto rows carry it); other
          // networks' fallback rows leave it undefined — the UI's devto rules
          // read devto rows only, and undefined is fail-closed for them anyway.
          ...(jobs[i].networkId === "devto" ? { resultKind: "unknown" as const } : {}),
          message: `Internal error (${jobs[i].label}): ${String(s.reason)}`,
        },
  );
}
