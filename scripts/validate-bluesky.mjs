// Read-only Bluesky credential check: login, print handle + DID, immediately done.
// Never prints the app password or tokens.
import "dotenv/config";
import { BskyAgent } from "@atproto/api";

const handle = process.env.BLUESKY_HANDLE;
const password = process.env.BLUESKY_APP_PASSWORD;
if (!handle || !password) {
  console.error("MISSING: BLUESKY_HANDLE / BLUESKY_APP_PASSWORD not set");
  process.exit(2);
}
const agent = new BskyAgent({ service: process.env.BLUESKY_SERVICE ?? "https://bsky.social" });
try {
  await agent.login({ identifier: handle, password });
  console.log(JSON.stringify({
    ok: true,
    handle: agent.session?.handle,
    did: agent.session?.did,
  }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
  process.exit(1);
}
