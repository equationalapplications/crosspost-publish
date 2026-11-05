// Read-only dev.to credential check: GET /api/articles/me with each CONFIGURED key,
// print the per-identity result, never print a key.
// Usage: node scripts/validate-devto.mjs [kurt|tessera]   (identity arg optional;
// without it, every identity whose env var is set gets checked)
import "dotenv/config";

const keys = {
  kurt: process.env.DEVTO_API_KEY,
  tessera: process.env.DEVTO_API_KEY_TESSERA,
};
const only = process.argv[2];
if (only && !(only in keys)) {
  console.error(`Unknown identity: ${only} (use kurt or tessera)`);
  process.exit(2);
}

const targets = Object.entries(keys).filter(([id, key]) => key && (only ? id === only : true));
if (targets.length === 0) {
  console.error("MISSING: DEVTO_API_KEY / DEVTO_API_KEY_TESSERA not set (for the requested identity)");
  process.exit(2);
}

let failed = false;
for (const [identity, key] of targets) {
  try {
    const res = await fetch("https://dev.to/api/articles/me", {
      headers: { "api-key": key },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.log(JSON.stringify({ ok: false, status: res.status, identity }));
      failed = true;
      continue;
    }
    const articles = await res.json();
    console.log(JSON.stringify({ ok: true, identity, articleCount: Array.isArray(articles) ? articles.length : null }));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: String(e?.message ?? e), identity }));
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
