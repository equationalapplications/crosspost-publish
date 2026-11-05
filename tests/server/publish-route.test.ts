import { describe, it, expect, afterAll, beforeAll, beforeEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../../server/index.js";

// Deterministic bluesky failure via module mock — and it REJECTS (throws), not
// resolves-false, so Promise.allSettled's rejected branch is actually exercised.
vi.mock("../../server/publishers/bluesky.js", () => ({
  isBlueskyConfigured: () => true,
  publishBluesky: async () => { throw new Error("boom"); },
}));

let appUrl = "";
let foreseen: { apiKey?: string; body?: string } = {};

const forem: Server = createServer((req, res) => {
  foreseen = { apiKey: req.headers["api-key"] as string | undefined, body: "" };
  req.on("data", (c: Buffer) => { foreseen.body += c.toString(); });
  req.on("end", () => {
    res.writeHead(201, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: 42, url: "https://dev.to/t/article" }));
  });
});

beforeAll(async () => {
  forem.listen(0, "127.0.0.1");
  await new Promise<void>((r) => forem.on("listening", r));
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

beforeEach(() => {
  foreseen = {}; // module-level stub state must not leak between tests
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
    expect(foreseen.apiKey).toBe("tessera-route-key"); // NOT kurt-route-key
  });

  it("defaults an omitted identity to Kurt", async () => {
    const res = await fetch(`${appUrl}/api/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ devto: true, article }),
    });
    await res.json();
    expect(foreseen.apiKey).toBe("kurt-route-key");
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

  it("400s on a non-string devtoIdentity instead of defaulting to Kurt", async () => {
    const res = await fetch(`${appUrl}/api/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ devto: true, devtoIdentity: 42, article }),
    });
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toMatch(/Unknown dev\.to identity/);
    expect(foreseen.apiKey).toBeUndefined(); // nothing reached dev.to
  });

  it("400s on devtoIdentity null (the UI must omit the key, never send null)", async () => {
    const res = await fetch(`${appUrl}/api/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ devto: true, devtoIdentity: null, article }),
    });
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toMatch(/Unknown dev\.to identity/);
  });

  it("keeps 400 for malformed JSON (no 500 rewrite)", async () => {
    const res = await fetch(`${appUrl}/api/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });

  it("keeps 413 for an over-limit body (no 500 rewrite)", async () => {
    const res = await fetch(`${appUrl}/api/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ devto: true, article: { title: "T", bodyMarkdown: "x", pad: "y".repeat(3_200_000) } }),
    });
    expect(res.status).toBe(413);
  });

  it("returns per-network rows even when a publisher rejects", async () => {
    const res = await fetch(`${appUrl}/api/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ devto: true, bluesky: true, text: "hello", article }),
    });
    const json = await res.json() as { results: Array<{ networkId: string; ok: boolean }> };
    const rows = json.results.map((r) => r.networkId).sort();
    expect(rows).toEqual(["bluesky", "devto"]); // both rows present despite the bluesky THROW
    expect(json.results.find((r) => r.networkId === "bluesky")?.ok).toBe(false);
    expect(json.results.find((r) => r.networkId === "devto")?.ok).toBe(true); // devto row survived the rejection
  });

  it("health exposes the configured identity list", async () => {
    const res = await fetch(`${appUrl}/api/health`);
    const json = await res.json() as { devtoIdentities: string[] };
    expect(json.devtoIdentities).toEqual(["kurt", "tessera"]);
  });
});
