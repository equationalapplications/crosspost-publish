#!/usr/bin/env node
/**
 * Standalone Node (ESM) helper: LinkedIn personal UGC via API version 202405.
 * No extra packages — uses global fetch (Node 20+). Loads `.env` from cwd when run via:
 *   node --import dotenv/config scripts/linkedin-ugc-post.mjs "caption" [image.jpg]
 *
 * Usage (from repo root, with .env present):
 *   npm run linkedin:post -- "Your caption"
 *   npm run linkedin:post -- "Your caption" ./photo.jpg
 *
 * Or without npm:
 *   node --import dotenv/config scripts/linkedin-ugc-post.mjs "Your caption"
 *   node --env-file=.env scripts/linkedin-ugc-post.mjs "Your caption"   # Node 20+, if you prefer
 *
 * Env (same as the app):
 *   LINKEDIN_ACCESS_TOKEN
 *   LINKEDIN_PERSON_URN   (urn:li:person:…)
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const LINKEDIN_VERSION = "202405";

function sleep(ms) {
  return new Promise((r) => {
    setTimeout(r, ms);
  });
}

function extractDigitalMediaAssetId(assetUrn) {
  const m = /^urn:li:digitalmediaAsset:(.+)$/i.exec(String(assetUrn).trim());
  return m?.[1] ?? null;
}

function hasAvailableRecipe(data) {
  if (!data || typeof data !== "object") return false;
  const recipes = data.recipes;
  if (!Array.isArray(recipes)) return false;
  return recipes.some((r) => r && typeof r === "object" && r.status === "AVAILABLE");
}

function unwrapRegisterValue(raw) {
  if (raw && typeof raw === "object" && "value" in raw) {
    const v = raw.value;
    if (v && typeof v === "object") return v;
  }
  if (raw && typeof raw === "object") return raw;
  return {};
}

async function linkedinJson(token, url, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("X-Restli-Protocol-Version", "2.0.0");
  headers.set("Linkedin-Version", LINKEDIN_VERSION);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let body;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const snippet = typeof body === "string" ? body.slice(0, 400) : JSON.stringify(body).slice(0, 400);
    throw new Error(`LinkedIn HTTP ${res.status}: ${snippet}`);
  }
  return body;
}

function uint8ToArrayBuffer(u8) {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

async function putUploadBinary(token, uploadUrl, bytes) {
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Content-Type", "application/octet-stream");
  headers.set("X-Restli-Protocol-Version", "2.0.0");
  headers.set("Linkedin-Version", LINKEDIN_VERSION);
  return fetch(uploadUrl, { method: "PUT", headers, body: uint8ToArrayBuffer(bytes) });
}

async function waitForImageAssetReady(token, assetUrn) {
  const id = extractDigitalMediaAssetId(assetUrn);
  if (!id) {
    await sleep(1500);
    return;
  }
  const url = `https://api.linkedin.com/rest/assets/${encodeURIComponent(id)}?fields=recipes,id`;
  for (let attempt = 0; attempt < 24; attempt++) {
    try {
      const data = await linkedinJson(token, url, { method: "GET" });
      if (hasAvailableRecipe(data)) return;
    } catch {
      if (attempt === 0) {
        await sleep(1500);
        return;
      }
    }
    await sleep(500);
  }
}

async function postTextOnly(token, personUrn, text) {
  const ugcBody = {
    author: personUrn,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text },
        shareMediaCategory: "NONE",
      },
    },
    visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
  };
  return linkedinJson(token, "https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ugcBody),
  });
}

async function postWithImage(token, personUrn, text, imageBytes) {
  const registerRaw = await linkedinJson(
    token,
    "https://api.linkedin.com/v2/assets?action=registerUpload",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        registerUploadRequest: {
          recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
          owner: personUrn,
          serviceRelationships: [
            {
              relationshipType: "OWNER",
              identifier: "urn:li:userGeneratedContent",
            },
          ],
        },
      }),
    },
  );

  const reg = unwrapRegisterValue(registerRaw);
  const mechanism = reg.uploadMechanism?.["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"];
  const uploadUrl = mechanism?.uploadUrl;
  const asset = reg.asset;
  if (!uploadUrl || !asset) {
    throw new Error("registerUpload response missing uploadUrl or asset");
  }

  const putRes = await putUploadBinary(token, uploadUrl, new Uint8Array(imageBytes));
  if (!putRes.ok) {
    const t = await putRes.text();
    throw new Error(`Image PUT failed (${putRes.status}): ${t.slice(0, 200)}`);
  }

  await waitForImageAssetReady(token, asset);

  const ugcBody = {
    author: personUrn,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text },
        shareMediaCategory: "IMAGE",
        media: [{ status: "READY", media: asset }],
      },
    },
    visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
  };

  return linkedinJson(token, "https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ugcBody),
  });
}

function printUsage() {
  console.error(`Usage:
  node --import dotenv/config scripts/linkedin-ugc-post.mjs "<caption text>" [path/to/image]
  node --env-file=.env scripts/linkedin-ugc-post.mjs "<caption text>" [path/to/image]   # alternative

Environment:
  LINKEDIN_ACCESS_TOKEN
  LINKEDIN_PERSON_URN  (e.g. urn:li:person:xxxxx)

Requires Node 20+ (fetch).`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 1 || argv[0] === "-h" || argv[0] === "--help") {
    printUsage();
    process.exit(argv.length < 1 ? 1 : 0);
  }

  const text = argv[0];
  const imagePath = argv[1];
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  const personUrn = process.env.LINKEDIN_PERSON_URN;

  if (!token || !personUrn) {
    console.error("Missing LINKEDIN_ACCESS_TOKEN or LINKEDIN_PERSON_URN.");
    printUsage();
    process.exit(1);
  }

  let result;
  if (imagePath) {
    const abs = resolve(process.cwd(), imagePath);
    const bytes = await readFile(abs);
    result = await postWithImage(token, personUrn, text, bytes);
  } else {
    result = await postTextOnly(token, personUrn, text);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
