import { describe, it, expect, afterAll, beforeEach, afterEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { publishDevto, DEVTO_API_BASE } from "../../server/publishers/devto.js";

let requests = 0;
let mode: "ok" | "500" | "hang" | "422" | "429" | "html201" | "badid" = "ok";
let badId: unknown = null;

const server: Server = createServer((req, res) => {
  requests += 1;
  if (mode === "ok") {
    res.writeHead(201, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: 42, url: "https://dev.to/kurt/test-article" }));
  } else if (mode === "html201") {
    // captive-portal / proxy style: 2xx with a non-JSON body
    res.writeHead(201, { "content-type": "text/html" });
    res.end("<html>ok</html>");
  } else if (mode === "badid") {
    // hostile 2xx: JSON body whose id is not a real Forem article id — the
    // runtime guard must treat it as an unknown outcome (the static cast
    // validates nothing)
    res.writeHead(201, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: badId, url: "https://dev.to/kurt/test-article" }));
  } else if (mode === "422") {
    res.writeHead(422, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Validation failed", status: "422" }));
  } else if (mode === "429") {
    res.writeHead(429, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Too many requests", status: "429" }));
  } else if (mode === "500") {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "boom" }));
  } else {
    // hang until the client's AbortSignal fires
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); // listen is async — wait for the port
const port = (server.address() as { port: number }).port;
const base = `http://127.0.0.1:${port}`;
afterAll(() => server.close());

beforeEach(() => {
  vi.stubEnv("DEVTO_API_BASE_OVERRIDE", base); // stubEnv: unstubAllEnvs restores setup.ts's closed-port guard
  vi.stubEnv("DEVTO_API_KEY", "test-kurt-key");
  vi.stubEnv("DEVTO_API_KEY_TESSERA", "test-tessera-key");
  requests = 0;
});
afterEach(() => {
  vi.unstubAllEnvs(); // restores setup.ts's closed-port override — never delete it
});

const ctx = {
  text: "",
  article: { title: "T", bodyMarkdown: `Intro.\n\nPosted by Tessera, Kurt VanDusen's executive AI agent at Equational Applications.` },
};

describe("publishDevto", () => {
  it("posts the article and returns id + url", async () => {
    mode = "ok";
    const r = await publishDevto(ctx, "kurt");
    expect(requests).toBe(1);
    expect(r.ok).toBe(true);
    expect(r.resultKind).toBe("created");
    expect(r.externalId).toBe("42");
    expect(r.url).toBe("https://dev.to/kurt/test-article");
  });

  it("never auto-retries on a 5xx unknown outcome", async () => {
    mode = "500";
    const r = await publishDevto(ctx, "tessera");
    expect(requests).toBe(1); // exactly one outbound request
    expect(r.ok).toBe(false);
    expect(r.resultKind).toBe("unknown");
    expect(r.message).toMatch(/check this identity's dev\.to dashboard|api\/articles\/me/i);
    expect(r.message).toMatch(/tessera/i); // identity in EVERY devto message (spec requirement)
  });

  it("times out after 30s max and reports an unknown outcome, once", async () => {
    mode = "hang";
    const r = await publishDevto(ctx, "kurt");
    expect(requests).toBe(1);
    expect(r.ok).toBe(false);
    expect(r.resultKind).toBe("unknown");
  }, 40_000);

  it("maps a deterministic 4xx to a rejected result with the API error", async () => {
    mode = "422";
    const r = await publishDevto(ctx, "kurt");
    expect(requests).toBe(1);
    expect(r.ok).toBe(false);
    expect(r.resultKind).toBe("rejected");
    expect(r.message).toMatch(/Validation failed/);
  });

  it("maps a 429 rate limit to an unknown outcome (must NOT auto-unlock the UI)", async () => {
    mode = "429";
    const r = await publishDevto(ctx, "kurt");
    expect(requests).toBe(1);
    expect(r.ok).toBe(false);
    expect(r.resultKind).toBe("unknown");
    expect(r.message).toMatch(/429/);
  });

  it("maps a 2xx with an unparseable body to an unknown outcome, never `created`", async () => {
    mode = "html201";
    const r = await publishDevto(ctx, "kurt");
    expect(requests).toBe(1);
    expect(r.ok).toBe(false);
    expect(r.resultKind).toBe("unknown"); // the UI duplicate guard must stay locked
  });

  it.each([
    [null, "null"],
    [0, "zero"],
    [-5, "negative"],
    [1.5, "fractional"],
    [2 ** 53, "unsafe-integer"],
  ])("maps a 2xx with a non-article id (%s: %s) to an unknown outcome, never `created`", async (id) => {
    mode = "badid";
    badId = id;
    const r = await publishDevto(ctx, "kurt");
    expect(requests).toBe(1);
    expect(r.ok).toBe(false);
    expect(r.resultKind).toBe("unknown"); // cannot identify a real article — guard stays locked
  });

  it("returns a missing-key failure naming the env var when the identity key is absent", async () => {
    vi.stubEnv("DEVTO_API_KEY_TESSERA", "");
    mode = "ok";
    const r = await publishDevto(ctx, "tessera");
    expect(requests).toBe(0); // no outbound request without a key
    expect(r.ok).toBe(false);
    expect(r.resultKind).toBe("rejected"); // deterministic, nothing sent — UI auto-unlocks
    expect(r.message).toMatch(/DEVTO_API_KEY_TESSERA/);
  });

  it("sends the api-key header and the Forem body shape", async () => {
    mode = "ok";
    let seen: { headers: Record<string, string | string[] | undefined>; body: string } | null = null;
    const probe: Server = createServer((req, res) => {
      seen = { headers: req.headers, body: "" };
      req.on("data", (c: Buffer) => { (seen as NonNullable<typeof seen>).body += c.toString(); });
      req.on("end", () => {
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: 1, url: "https://dev.to/x" }));
      });
    });
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const pport = (probe.address() as { port: number }).port;
    process.env.DEVTO_API_BASE_OVERRIDE = `http://127.0.0.1:${pport}`;
    await publishDevto(ctx, "tessera");
    probe.close();
    const s = seen as NonNullable<typeof seen>;
    expect(s.headers["api-key"]).toBe("test-tessera-key"); // DEVTO_API_KEY_TESSERA for the tessera identity
    const parsed = JSON.parse(s.body);
    expect(parsed.article.published).toBe(true);
    expect(parsed.article.body_markdown).toContain("Tessera");
    expect(parsed.article.title).toBe("T");
  });
});
