export type ImagePayload = {
  buffer: Buffer;
  mimeType: string;
};

export type PublishContext = {
  text: string;
  image?: ImagePayload;
};

export type PublishResult = {
  networkId: string;
  ok: boolean;
  message?: string;
  externalId?: string;
};

export type PublishTargets = {
  bluesky: boolean;
  linkedin: boolean;
};
