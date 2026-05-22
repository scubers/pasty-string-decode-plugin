"use strict";

const JWT_REGEX = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

export interface JWTDecodeResult {
  header: Record<string, unknown>;
  payload: unknown;
  signature: string;
}

function base64UrlDecodeToBuffer(segment: string): Buffer | null {
  const remainder = segment.length % 4;
  const padded = remainder === 0 ? segment : segment + "=".repeat(4 - remainder);
  try {
    return Buffer.from(padded, "base64url");
  } catch {
    return null;
  }
}

function safeJsonParse(text: string): { ok: true; value: unknown } | { ok: false; value: null } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, value: null };
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function tryDecodeJWT(input: string): JWTDecodeResult | null {
  if (!JWT_REGEX.test(input)) {
    return null;
  }
  const segments = input.split(".");
  const [headerSeg, payloadSeg] = segments;

  const headerBuf = base64UrlDecodeToBuffer(headerSeg);
  const payloadBuf = base64UrlDecodeToBuffer(payloadSeg);
  if (!headerBuf || !payloadBuf) {
    return null;
  }

  if (segments[2] !== undefined && segments[2] !== "") {
    const sigBuf = base64UrlDecodeToBuffer(segments[2]);
    if (!sigBuf) {
      return null;
    }
  }

  const headerParse = safeJsonParse(headerBuf.toString("utf8"));
  if (!headerParse.ok || !isPlainObject(headerParse.value)) {
    return null;
  }
  if (typeof headerParse.value.alg !== "string" || headerParse.value.alg.length === 0) {
    return null;
  }

  const payloadParse = safeJsonParse(payloadBuf.toString("utf8"));
  if (!payloadParse.ok) {
    return null;
  }

  return {
    header: headerParse.value,
    payload: payloadParse.value,
    signature: segments[2] ?? "",
  };
}

export function tryDecodeEscapedJson(input: string): string | null {
  if (input.length >= 2 && input[0] === '"' && input[input.length - 1] === '"') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input) as unknown;
    } catch {
      parsed = undefined;
    }
    if (typeof parsed === "string") {
      return parsed;
    }
  }

  if (input.includes('\\"')) {
    let unescaped: unknown;
    try {
      unescaped = JSON.parse('"' + input + '"') as unknown;
    } catch {
      return null;
    }
    if (typeof unescaped !== "string") {
      return null;
    }
    let validated: unknown;
    try {
      validated = JSON.parse(unescaped) as unknown;
    } catch {
      return null;
    }
    if (validated === null || typeof validated !== "object") {
      return null;
    }
    return unescaped;
  }

  return null;
}

const URL_PERCENT_RE = /%[0-9A-Fa-f]{2}/;

export function tryDecodeUrl(input: string): string | null {
  if (!URL_PERCENT_RE.test(input)) {
    return null;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    return null;
  }
  return decoded === input ? null : decoded;
}

const BASE64_STANDARD_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const BASE64_URLSAFE_RE = /^[A-Za-z0-9_-]+={0,2}$/;
const CONTROL_RE = /\p{C}/u;

function isPrintableChar(codePoint: number | undefined, char: string): boolean {
  if (codePoint !== undefined && codePoint >= 0x20 && codePoint <= 0x7e) {
    return true;
  }
  if (char === "\t" || char === "\n" || char === "\r") {
    return true;
  }
  return !CONTROL_RE.test(char);
}

function printableRatio(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  let printable = 0;
  let total = 0;
  for (const ch of text) {
    total += 1;
    if (isPrintableChar(ch.codePointAt(0), ch)) {
      printable += 1;
    }
  }
  return total === 0 ? 0 : printable / total;
}

export function tryDecodeBase64(input: string): string | null {
  const stripped = input.replace(/\s+/g, "");
  if (stripped.length < 8) {
    return null;
  }

  const matchesStandard = BASE64_STANDARD_RE.test(stripped);
  const matchesUrlsafe = BASE64_URLSAFE_RE.test(stripped);
  if (!matchesStandard && !matchesUrlsafe) {
    return null;
  }

  const containsUrlSafeOnlyChar = /[_-]/.test(stripped);
  const lengthMultipleOfFour = stripped.length % 4 === 0;
  const useUrlSafe = containsUrlSafeOnlyChar || (!lengthMultipleOfFour && matchesUrlsafe);

  if (!useUrlSafe && !lengthMultipleOfFour) {
    return null;
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(stripped, useUrlSafe ? "base64url" : "base64");
  } catch {
    return null;
  }

  if (buffer.length === 0) {
    return null;
  }

  const decoded = buffer.toString("utf8");
  const roundTrip = Buffer.from(decoded, "utf8");
  if (!roundTrip.equals(buffer)) {
    return null;
  }

  return printableRatio(decoded) < 0.95 ? null : decoded;
}
