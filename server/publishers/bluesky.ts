import { BskyAgent } from "@atproto/api";
import type { PublishContext, PublishResult } from "./types.js";

const SERVICE = process.env.BLUESKY_SERVICE ?? "https://bsky.social";

export function isBlueskyConfigured(): boolean {
  return Boolean(process.env.BLUESKY_HANDLE && process.env.BLUESKY_APP_PASSWORD);
}

function errMsg(e: unknown, fallback: string): string {
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return fallback;
}

export async function publishBluesky(ctx: PublishContext): Promise<PublishResult> {
  const networkId = "bluesky";
  const handle = process.env.BLUESKY_HANDLE;
  const password = process.env.BLUESKY_APP_PASSWORD;
  if (!handle || !password) {
    return { networkId, ok: false, message: "Missing BLUESKY_HANDLE or BLUESKY_APP_PASSWORD" };
  }

  const agent = new BskyAgent({ service: SERVICE });
  try {
    await agent.login({ identifier: handle, password });
  } catch (e: unknown) {
    return { networkId, ok: false, message: errMsg(e, "Bluesky login failed") };
  }

  try {
    if (ctx.image) {
      const encoding = ctx.image.mimeType || "image/jpeg";
      const uploaded = await agent.uploadBlob(ctx.image.buffer, { encoding });
      const post = await agent.post({
        text: ctx.text,
        embed: {
          $type: "app.bsky.embed.images",
          images: [{ alt: "Attached image", image: uploaded.data.blob }],
        },
      });
      return { networkId, ok: true, externalId: post.uri };
    }
    const post = await agent.post({ text: ctx.text });
    return { networkId, ok: true, externalId: post.uri };
  } catch (e: unknown) {
    return { networkId, ok: false, message: errMsg(e, "Bluesky post failed") };
  }
}
