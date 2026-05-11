import type { PublishContext, PublishResult } from "./types.js";

const LINKEDIN_VERSION = "202405";

function errMsg(e: unknown, fallback: string): string {
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** `urn:li:digitalmediaAsset:C5400AQHpR1ANqMWqNA` → `C5400AQHpR1ANqMWqNA` for REST asset status checks. */
function extractDigitalMediaAssetId(assetUrn: string): string | null {
  const m = /^urn:li:digitalmediaAsset:(.+)$/i.exec(assetUrn.trim());
  return m?.[1] ?? null;
}

function hasAvailableRecipe(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const recipes = (data as { recipes?: unknown }).recipes;
  if (!Array.isArray(recipes)) return false;
  return recipes.some(
    (r) =>
      !!r &&
      typeof r === "object" &&
      (r as { status?: string }).status === "AVAILABLE",
  );
}

export function isLinkedInConfigured(): boolean {
  return Boolean(process.env.LINKEDIN_ACCESS_TOKEN && process.env.LINKEDIN_PERSON_URN);
}

type MediaUploadRequest = {
  uploadUrl?: string;
  headers?: Record<string, string>;
};

type RegisterUploadValue = {
  uploadMechanism?: {
    "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"?: MediaUploadRequest;
  };
  asset?: string;
};

async function linkedinJson<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("X-Restli-Protocol-Version", "2.0.0");
  headers.set("Linkedin-Version", LINKEDIN_VERSION);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const snippet = typeof body === "string" ? body.slice(0, 400) : JSON.stringify(body).slice(0, 400);
    throw new Error(`LinkedIn HTTP ${res.status}: ${snippet}`);
  }
  return body as T;
}

function uint8ToArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

/**
 * Step 2 (202405): PUT raw bytes to the upload URL.
 * Per LinkedIn guidance: Authorization + Content-Type application/octet-stream.
 */
async function putUploadBinary(token: string, uploadUrl: string, bytes: Uint8Array): Promise<Response> {
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Content-Type", "application/octet-stream");
  headers.set("X-Restli-Protocol-Version", "2.0.0");
  headers.set("Linkedin-Version", LINKEDIN_VERSION);
  return fetch(uploadUrl, { method: "PUT", headers, body: uint8ToArrayBuffer(bytes) });
}

/**
 * After Step 2, confirm processing when possible via REST asset status (recipes[].status === AVAILABLE).
 * If this endpoint is not available for the token/app, fall back to a short delay before Step 3.
 */
async function waitForImageAssetReady(token: string, assetUrn: string): Promise<void> {
  const id = extractDigitalMediaAssetId(assetUrn);
  if (!id) {
    await sleep(1500);
    return;
  }

  const url = `https://api.linkedin.com/rest/assets/${encodeURIComponent(id)}?fields=recipes,id`;

  for (let attempt = 0; attempt < 24; attempt++) {
    try {
      const data = await linkedinJson<unknown>(token, url, { method: "GET" });
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

function unwrapRegisterValue(raw: unknown): RegisterUploadValue {
  if (raw && typeof raw === "object" && "value" in raw) {
    const v = (raw as { value: unknown }).value;
    if (v && typeof v === "object") return v as RegisterUploadValue;
  }
  if (raw && typeof raw === "object") return raw as RegisterUploadValue;
  return {};
}

export async function publishLinkedIn(ctx: PublishContext): Promise<PublishResult> {
  const networkId = "linkedin";
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  const personUrn = process.env.LINKEDIN_PERSON_URN;
  if (!token || !personUrn) {
    return { networkId, ok: false, message: "Missing LINKEDIN_ACCESS_TOKEN or LINKEDIN_PERSON_URN" };
  }

  try {
    if (ctx.image) {
      // Step 1: registerUpload (v2)
      const registerRaw = await linkedinJson<unknown>(
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
        return { networkId, ok: false, message: "LinkedIn registerUpload missing uploadUrl or asset" };
      }

      // Step 2: binary upload (Bearer + octet-stream)
      const putRes = await putUploadBinary(token, uploadUrl, new Uint8Array(ctx.image.buffer));
      if (!putRes.ok) {
        const t = await putRes.text();
        return { networkId, ok: false, message: `LinkedIn image upload failed (${putRes.status}): ${t.slice(0, 200)}` };
      }

      // Status: poll REST assets when possible, else brief delay before UGC create
      await waitForImageAssetReady(token, asset);

      // Step 3: UGC post (body shape per 202405 examples)
      const ugcBody = {
        author: personUrn,
        lifecycleState: "PUBLISHED",
        specificContent: {
          "com.linkedin.ugc.ShareContent": {
            shareCommentary: { text: ctx.text },
            shareMediaCategory: "IMAGE",
            media: [
              {
                status: "READY",
                media: asset,
              },
            ],
          },
        },
        visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
      };

      const postRaw = await linkedinJson<unknown>(token, "https://api.linkedin.com/v2/ugcPosts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ugcBody),
      });

      const id =
        postRaw && typeof postRaw === "object" && "id" in postRaw && typeof (postRaw as { id: unknown }).id === "string"
          ? (postRaw as { id: string }).id
          : undefined;
      return { networkId, ok: true, externalId: id };
    }

    const ugcBody = {
      author: personUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: ctx.text },
          shareMediaCategory: "NONE",
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    };

    const postRaw = await linkedinJson<unknown>(token, "https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ugcBody),
    });

    const id =
      postRaw && typeof postRaw === "object" && "id" in postRaw && typeof (postRaw as { id: unknown }).id === "string"
        ? (postRaw as { id: string }).id
        : undefined;
    return { networkId, ok: true, externalId: id };
  } catch (e: unknown) {
    return { networkId, ok: false, message: errMsg(e, "LinkedIn publish failed") };
  }
}
