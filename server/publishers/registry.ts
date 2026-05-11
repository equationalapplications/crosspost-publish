import { publishBluesky, isBlueskyConfigured } from "./bluesky.js";
import { publishLinkedIn, isLinkedInConfigured } from "./linkedin.js";
import type { PublishContext, PublishResult, PublishTargets } from "./types.js";

export async function publishAll(ctx: PublishContext, targets: PublishTargets): Promise<PublishResult[]> {
  const jobs: Promise<PublishResult>[] = [];

  if (targets.bluesky) {
    if (isBlueskyConfigured()) jobs.push(publishBluesky(ctx));
    else
      jobs.push(
        Promise.resolve({
          networkId: "bluesky",
          ok: false,
          message: "Bluesky not configured: set BLUESKY_HANDLE and BLUESKY_APP_PASSWORD in .env",
        }),
      );
  }

  if (targets.linkedin) {
    if (isLinkedInConfigured()) jobs.push(publishLinkedIn(ctx));
    else
      jobs.push(
        Promise.resolve({
          networkId: "linkedin",
          ok: false,
          message: "LinkedIn not configured: set LINKEDIN_ACCESS_TOKEN and LINKEDIN_PERSON_URN in .env",
        }),
      );
  }

  return Promise.all(jobs);
}
