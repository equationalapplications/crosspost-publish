export type ImagePayload = {
  buffer: Buffer;
  mimeType: string;
};

export type DevtoIdentity = "kurt" | "tessera";

export type DevtoArticle = {
  title: string;
  bodyMarkdown: string;
  canonicalUrl?: string;
  description?: string;
  tags?: string[];
};

export type PublishContext = {
  text: string;
  image?: ImagePayload;
  article?: DevtoArticle;
};

export type PublishResult = {
  networkId: string;
  ok: boolean;
  message?: string;
  externalId?: string;
  url?: string;
  resultKind?: "created" | "rejected" | "unknown";
};

export type PublishTargets = {
  bluesky: boolean;
  linkedin: boolean;
  devto?: boolean;
  devtoIdentity?: DevtoIdentity;
};
