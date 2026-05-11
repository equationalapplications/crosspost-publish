import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { publishAll } from "./publishers/registry.js";

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

const app = express();

function parseFlag(v: unknown): boolean {
  return v === "1" || v === "true" || v === "on" || v === true;
}

app.post("/api/publish", upload.single("image"), async (req: Request, res: Response) => {
  try {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) {
      res.status(400).json({ error: "text is required" });
      return;
    }

    const targets = {
      bluesky: parseFlag(req.body?.bluesky),
      linkedin: parseFlag(req.body?.linkedin),
    };
    if (!targets.bluesky && !targets.linkedin) {
      res.status(400).json({ error: "Select at least one destination" });
      return;
    }

    const file = req.file;
    const ctx = {
      text,
      image:
        file && file.buffer.length
          ? { buffer: file.buffer, mimeType: file.mimetype }
          : undefined,
    };

    const results = await publishAll(ctx, targets);
    res.json({ results });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Publish failed";
    res.status(500).json({ error: msg });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
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
  const msg = err instanceof Error ? err.message : "Server error";
  res.status(500).json({ error: msg });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`API listening on http://127.0.0.1:${PORT}`);
});
