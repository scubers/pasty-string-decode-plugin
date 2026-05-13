"use strict";

const ORIGINAL_TRUNCATION_BYTES = 4 * 1024;
const SEARCH_TEXT_DECODED_LIMIT = 4096;

const ENCODING_LABELS = Object.freeze({
  jwt: "JWT",
  escaped_json: "Escaped JSON",
  url: "URL",
  base64: "Base64"
});

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isJsonString(text) {
  if (typeof text !== "string" || text.length === 0) {
    return false;
  }
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function truncateOriginal(original) {
  if (typeof original !== "string") {
    return { value: "", truncated: false };
  }
  if (original.length <= ORIGINAL_TRUNCATION_BYTES) {
    return { value: original, truncated: false };
  }
  return { value: original.slice(0, ORIGINAL_TRUNCATION_BYTES), truncated: true };
}

function createDecodePayload(detectionResult) {
  if (!detectionResult || typeof detectionResult !== "object") {
    return null;
  }
  const encoding = String(detectionResult.encoding || "");
  if (!ENCODING_LABELS[encoding]) {
    return null;
  }
  const decoded = String(detectionResult.decoded ?? "");
  const original = String(detectionResult.original ?? "");

  const { value: originalForPayload, truncated } = truncateOriginal(original);

  const decodedIsJSON =
    encoding === "jwt" ? true : isJsonString(decoded);

  const jwt = encoding === "jwt" && detectionResult.jwt
    ? {
        header: detectionResult.jwt.header,
        payload: detectionResult.jwt.payload
      }
    : null;

  return {
    kind: "decode_preview",
    version: 1,
    encoding,
    original: originalForPayload,
    truncated,
    decoded,
    decodedIsJSON,
    jwt,
    originalLength: original.length,
    decodedLength: decoded.length,
    expanded: false
  };
}

function decodeDecodePayload(payloadJson) {
  if (typeof payloadJson !== "string" || payloadJson.length === 0) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) {
    return null;
  }
  if (parsed.kind !== "decode_preview") {
    return null;
  }
  if (!ENCODING_LABELS[String(parsed.encoding || "")]) {
    return null;
  }
  if (typeof parsed.decoded !== "string") {
    return null;
  }
  return {
    kind: "decode_preview",
    version: Number(parsed.version) || 1,
    encoding: String(parsed.encoding),
    original: typeof parsed.original === "string" ? parsed.original : "",
    truncated: Boolean(parsed.truncated),
    decoded: parsed.decoded,
    decodedIsJSON: Boolean(parsed.decodedIsJSON),
    jwt: isPlainObject(parsed.jwt) ? parsed.jwt : null,
    originalLength: Number(parsed.originalLength) || 0,
    decodedLength: Number(parsed.decodedLength) || 0,
    // Forward-compat: older payloads without `expanded` default to compact.
    expanded:
      typeof parsed.expanded === "boolean" ? parsed.expanded : false
  };
}

function encodingLabel(encoding) {
  return ENCODING_LABELS[encoding] || String(encoding || "");
}

function buildSearchProjection(payload) {
  if (!payload) {
    return null;
  }
  const label = encodingLabel(payload.encoding);
  const decodedPreview =
    typeof payload.decoded === "string"
      ? payload.decoded.slice(0, SEARCH_TEXT_DECODED_LIMIT)
      : "";
  const searchText = `${label} ${decodedPreview}`.trim();
  if (searchText.length === 0) {
    return null;
  }
  return {
    scope: "pasty_awesome_decode",
    searchText,
    label
  };
}

module.exports = {
  createDecodePayload,
  decodeDecodePayload,
  buildSearchProjection,
  encodingLabel,
  ORIGINAL_TRUNCATION_BYTES
};
