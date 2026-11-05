import "dotenv/config";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { publishAll } from "./publishers/registry.js";
import { validatePublishRequest, devtoIdentities } from "./publishers/devto-validation.js";
import type { PublishTargets } from "./publishers/types.js";

const PORT = Number(process.env.API_PORT ?? process.env.PORT ?? 3001);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      cb(new Error(`Unsupported image type: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
});

function parseFlag(v: unknown): boolean {
  return v === "1" || v === "true" || v === "on" || v === true;
}

export function createApp(): Express {
  const app = express();
  app.use(express.json({ limit: "2mb" })); // spec limit; normal text worst case ~1.2MB. Adversarial control-char/lone-surrogate content can serialize to ~2.4MB → 413, which is a deterministic 4xx and keeps the lock logic safe. Do not raise the limit (spec).

  app.post("/api/publish", upload.single("image"), async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      // Annotated PublishTargets: the devtoIdentity assignment below is a type error
      // on an inferred literal type (TS2339) — the annotation is required for tsc.
      const targets: PublishTargets = {
        bluesky: parseFlag(body.bluesky),
        linkedin: parseFlag(body.linkedin),
        devto: parseFlag(body.devto),
      };
      // Pass through UNCHANGED: a non-string devtoIdentity (42, ["tessera"], {}) must hit
      // the validator's unknown-identity 400, never silently default to Kurt — the
      // fail-open coercion would skip the Tessera disclosure guard.
      const devtoIdentity: unknown = body.devtoIdentity;
      const article = body.article;
      const file = req.file;
      const hasImage = Boolean(file && file.buffer.length);
      const rules = validatePublishRequest({ text: body.text, targets: { bluesky: targets.bluesky, linkedin: targets.linkedin, devto: targets.devto === true }, article, devtoIdentity, hasImage });
      if (!rules.ok) {
        res.status(rules.status).json({ error: rules.error });
        return;
      }
      if (targets.devto) targets.devtoIdentity = rules.identity;
      const ctx = {
        text: rules.text,
        article: rules.article,
        image: hasImage && file ? { buffer: file.buffer, mimeType: file.mimetype } : undefined,
      };
      const results = await publishAll(ctx, targets);
      res.json({ results });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Publish failed";
      res.status(500).json({ error: msg });
    }
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, devtoIdentities: devtoIdentities() });
  });

  const clientDist = join(process.cwd(), "dist", "client");
  if (existsSync(join(clientDist, "index.html"))) {
    app.use(express.static(clientDist));
    app.use((req: Request, res: Response) => {
      if (req.path.startsWith("/api")) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.sendFile(join(clientDist, "index.html"));
    });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({ error: `Image too large (max ${MAX_IMAGE_BYTES} bytes)` });
        return;
      }
    }
    if (err instanceof Error && err.message.startsWith("Unsupported image")) {
      res.status(400).json({ error: err.message });
      return;
    }
    // body-parser errors carry status/statusCode (400 malformed JSON, 413 over limit):
    const e = err as { status?: unknown; statusCode?: unknown; message?: unknown };
    const status = typeof e?.status === "number" ? e.status : typeof e?.statusCode === "number" ? e.statusCode : undefined;
    if (status !== undefined && status >= 400 && status < 500) {
      res.status(status).json({ error: typeof e.message === "string" ? e.message : "Request error" });
      return;
    }
    const msg = err instanceof Error ? err.message : "Server error";
    res.status(500).json({ error: msg });
  });

  return app;
}

// createApp() is import-safe under vitest because the listen call is gated on
// process.env.VITEST (vitest sets it; a production deploy never does — unlike
// NODE_ENV, which a deploy could set to "test" and silently produce a
// no-listener process, hence the explicit "not listening" log).
if (process.env.VITEST) {
  console.log("not listening (test mode)");
} else {
  createApp().listen(PORT, "127.0.0.1", () => {
    console.log(`API listening on http://127.0.0.1:${PORT}`);
  });
}
