import type {
  PluginContentEnvelope,
  PluginDetectorArtifact,
  PluginDetectorSearchProjection,
} from "@pasty/plugin-sdk/runtime";
import type { DetectionResult } from "./detection.ts";

export const ATTACHMENT_TYPE = "plugin.pasty.awesome.decode.preview";
export const ATTACHMENT_KEY = "primary";
export const ORIGINAL_TRUNCATION_BYTES = 4 * 1024;
const SEARCH_TEXT_DECODED_LIMIT = 4096;

export type DecodeEncoding = "jwt" | "escaped_json" | "url" | "base64" | "timestamp" | "date";

const ENCODING_LABELS: Record<DecodeEncoding, string> = Object.freeze({
  jwt: "JWT",
  escaped_json: "Escaped JSON",
  url: "URL",
  base64: "Base64",
  timestamp: "Timestamp",
  date: "Date",
});

export interface DecodePayload {
  kind: "decode_preview";
  version: 1;
  encoding: DecodeEncoding;
  original: string;
  truncated: boolean;
  decoded: string;
  decodedIsJSON: boolean;
  jwt: {
    header: Record<string, unknown>;
    payload: unknown;
    signature: string;
  } | null;
  epochMs: number | null;
  tsUnit: "s" | "ms" | null;
  originalLength: number;
  decodedLength: number;
  expanded: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDecodeEncoding(value: unknown): value is DecodeEncoding {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ENCODING_LABELS, value);
}

function isJsonString(text: string): boolean {
  if (text.length === 0) {
    return false;
  }
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function truncateOriginal(original: string): { value: string; truncated: boolean } {
  if (original.length <= ORIGINAL_TRUNCATION_BYTES) {
    return { value: original, truncated: false };
  }
  return { value: original.slice(0, ORIGINAL_TRUNCATION_BYTES), truncated: true };
}

export function createDecodePayload(detectionResult: DetectionResult & { original: string }): DecodePayload | null {
  const encoding = detectionResult.encoding;
  if (!isDecodeEncoding(encoding)) {
    return null;
  }

  const { value: originalForPayload, truncated } = truncateOriginal(detectionResult.original);
  const jwt = encoding === "jwt" && detectionResult.jwt
    ? {
        header: detectionResult.jwt.header,
        payload: detectionResult.jwt.payload,
        signature: detectionResult.jwt.signature,
      }
    : null;

  const decoded = encoding === "jwt" && jwt
    ? JSON.stringify(
        { header: jwt.header, payload: jwt.payload, signature: jwt.signature },
        null,
        2,
      )
    : detectionResult.decoded;

  const decodedIsJSON =
    encoding === "jwt"
      ? true
      : encoding === "timestamp" || encoding === "date"
        ? false
        : isJsonString(decoded);

  return {
    kind: "decode_preview",
    version: 1,
    encoding,
    original: originalForPayload,
    truncated,
    decoded,
    decodedIsJSON,
    jwt,
    epochMs: typeof detectionResult.epochMs === "number" ? detectionResult.epochMs : null,
    tsUnit: detectionResult.tsUnit ?? null,
    originalLength: detectionResult.original.length,
    decodedLength: decoded.length,
    expanded: false,
  };
}

export function decodeDecodePayload(payloadJson: string | null | undefined): DecodePayload | null {
  if (typeof payloadJson !== "string" || payloadJson.length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson) as unknown;
  } catch {
    return null;
  }
  if (!isPlainObject(parsed) || parsed.kind !== "decode_preview" || !isDecodeEncoding(parsed.encoding)) {
    return null;
  }
  if (typeof parsed.decoded !== "string") {
    return null;
  }

  const jwt = isPlainObject(parsed.jwt)
    ? {
        header: isPlainObject(parsed.jwt.header) ? parsed.jwt.header : {},
        payload: parsed.jwt.payload,
        signature: typeof parsed.jwt.signature === "string" ? parsed.jwt.signature : "",
      }
    : null;

  const epochMs =
    typeof parsed.epochMs === "number" && Number.isFinite(parsed.epochMs) ? parsed.epochMs : null;
  const tsUnit = parsed.tsUnit === "s" || parsed.tsUnit === "ms" ? parsed.tsUnit : null;

  return {
    kind: "decode_preview",
    version: 1,
    encoding: parsed.encoding,
    original: typeof parsed.original === "string" ? parsed.original : "",
    truncated: Boolean(parsed.truncated),
    decoded: parsed.decoded,
    decodedIsJSON: Boolean(parsed.decodedIsJSON),
    jwt,
    epochMs,
    tsUnit,
    originalLength: Number(parsed.originalLength) || 0,
    decodedLength: Number(parsed.decodedLength) || 0,
    expanded: typeof parsed.expanded === "boolean" ? parsed.expanded : false,
  };
}

export function encodingLabel(encoding: unknown): string {
  return isDecodeEncoding(encoding) ? ENCODING_LABELS[encoding] : String(encoding || "");
}

export function buildSearchProjection(payload: DecodePayload): PluginDetectorSearchProjection | undefined {
  const label = encodingLabel(payload.encoding);
  const decodedPreview = payload.decoded.slice(0, SEARCH_TEXT_DECODED_LIMIT);
  const searchText = `${label} ${decodedPreview}`.trim();
  if (searchText.length === 0) {
    return undefined;
  }
  return {
    scope: "pasty_awesome_decode",
    searchText,
    label,
  };
}

export function readTextContent(content: PluginContentEnvelope | unknown): string | null {
  if (!isPlainObject(content) || content.kind !== "text") {
    return null;
  }
  if (typeof content.text === "string") {
    return content.text;
  }
  const legacyPayload = content.payload;
  if (isPlainObject(legacyPayload) && typeof legacyPayload.text === "string") {
    return legacyPayload.text;
  }
  return null;
}

export function buildDecodeArtifact(payload: DecodePayload): PluginDetectorArtifact {
  return {
    attachmentType: ATTACHMENT_TYPE,
    attachmentKey: ATTACHMENT_KEY,
    payloadJson: JSON.stringify(payload),
    searchProjection: buildSearchProjection(payload),
    attachmentSyncScope: "syncable",
  };
}
