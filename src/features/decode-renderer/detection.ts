import {
  tryDecodeBase64,
  tryDecodeEscapedJson,
  tryDecodeJWT,
  tryDecodeUrl,
  type JWTDecodeResult,
} from "./decoders.ts";

export const MAX_INPUT_CHARS = 256 * 1024;

export interface DetectionResult {
  encoding: "jwt" | "escaped_json" | "url" | "base64";
  decoded: string;
  jwt?: JWTDecodeResult;
}

export function preprocess(rawText: string): { trimmed: string; bail: boolean } {
  const trimmed = rawText.trim();
  if (trimmed.length === 0) {
    return { trimmed: "", bail: true };
  }
  if (trimmed.length > MAX_INPUT_CHARS) {
    return { trimmed, bail: true };
  }
  return { trimmed, bail: false };
}

export function runPriorityChain(trimmed: string): DetectionResult | null {
  if (trimmed.length === 0) {
    return null;
  }

  const jwt = tryDecodeJWT(trimmed);
  if (jwt) {
    return {
      encoding: "jwt",
      decoded: JSON.stringify({ header: jwt.header, payload: jwt.payload }, null, 2),
      jwt,
    };
  }

  const escapedJson = tryDecodeEscapedJson(trimmed);
  if (escapedJson !== null) {
    return {
      encoding: "escaped_json",
      decoded: escapedJson,
    };
  }

  const url = tryDecodeUrl(trimmed);
  if (url !== null) {
    return {
      encoding: "url",
      decoded: url,
    };
  }

  const base64 = tryDecodeBase64(trimmed);
  if (base64 !== null) {
    return {
      encoding: "base64",
      decoded: base64,
    };
  }

  return null;
}
