import type { PublishContext, PublishResult } from "./types.js";

const LINKEDIN_VERSION = "202405";

function errMsg(e: unknown, fallback: string): string {
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return fallback;
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
      const registerRaw = await linkedinJson<unknown>(
        token,
        "https://api.linkedin.com/v2/assets?action=registerUpload",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            registerUploadRequest: {
              owner: personUrn,
              recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
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

      const putHeaders: Record<string, string> = {
        "Content-Type": ctx.image.mimeType,
        ...(mechanism.headers ?? {}),
      };
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: putHeaders,
        body: new Uint8Array(ctx.image.buffer),
      });
      if (!putRes.ok) {
        const t = await putRes.text();
        return { networkId, ok: false, message: `LinkedIn image upload failed (${putRes.status}): ${t.slice(0, 200)}` };
      }

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
                description: { text: " " },
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
