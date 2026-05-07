import type { PromptImageAttachment } from "@wbd/protocol";

export const MAX_CHAT_IMAGES = 5;
export const MAX_CHAT_IMAGE_BYTES = 8 * 1024 * 1024;
export const ACCEPTED_IMAGE_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const MAX_NAME_LENGTH = 255;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

export type ParsedAttachment = PromptImageAttachment & {
  sizeBytes: number;
};

export type AttachmentParseError =
  | { code: "too_many"; message: string }
  | { code: "invalid_shape"; message: string }
  | { code: "invalid_mime"; message: string }
  | { code: "invalid_base64"; message: string }
  | { code: "too_large"; message: string };

export type ParseResult =
  | { ok: true; attachments: ParsedAttachment[] }
  | { ok: false; error: AttachmentParseError };

export function parseAttachmentsPayload(value: unknown): ParseResult {
  if (value === undefined || value === null) {
    return { ok: true, attachments: [] };
  }
  if (!Array.isArray(value)) {
    return {
      ok: false,
      error: { code: "invalid_shape", message: "attachments must be an array" },
    };
  }
  if (value.length > MAX_CHAT_IMAGES) {
    return {
      ok: false,
      error: {
        code: "too_many",
        message: `at most ${MAX_CHAT_IMAGES} attachments are allowed`,
      },
    };
  }

  const parsed: ParsedAttachment[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      return {
        ok: false,
        error: { code: "invalid_shape", message: "attachment must be an object" },
      };
    }
    const record = entry as Record<string, unknown>;
    const mimeType = typeof record.mimeType === "string" ? record.mimeType : "";
    const dataBase64 = typeof record.dataBase64 === "string" ? record.dataBase64 : "";
    const rawName = typeof record.name === "string" ? record.name.trim() : "";

    if (!ACCEPTED_IMAGE_MIME_TYPES.has(mimeType)) {
      return {
        ok: false,
        error: {
          code: "invalid_mime",
          message: `unsupported attachment mimeType: ${mimeType || "(missing)"}`,
        },
      };
    }
    if (!dataBase64 || !BASE64_RE.test(dataBase64)) {
      return {
        ok: false,
        error: { code: "invalid_base64", message: "attachment dataBase64 is invalid" },
      };
    }
    const sizeBytes = decodedByteLength(dataBase64);
    if (sizeBytes <= 0) {
      return {
        ok: false,
        error: { code: "invalid_base64", message: "attachment is empty" },
      };
    }
    if (sizeBytes > MAX_CHAT_IMAGE_BYTES) {
      return {
        ok: false,
        error: {
          code: "too_large",
          message: `attachment exceeds ${MAX_CHAT_IMAGE_BYTES} bytes`,
        },
      };
    }

    const name = rawName.slice(0, MAX_NAME_LENGTH) || `image-${parsed.length + 1}`;
    parsed.push({ name, mimeType, dataBase64, sizeBytes });
  }

  return { ok: true, attachments: parsed };
}

function decodedByteLength(base64: string): number {
  const trimmed = base64.replace(/[^A-Za-z0-9+/=]/g, "");
  if (trimmed.length === 0) return 0;
  const padding = trimmed.endsWith("==") ? 2 : trimmed.endsWith("=") ? 1 : 0;
  return Math.floor((trimmed.length * 3) / 4) - padding;
}
