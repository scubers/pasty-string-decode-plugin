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

const TIMESTAMP_SECONDS_RE = /^\d{10}$/;
const TIMESTAMP_MILLIS_RE = /^\d{13}$/;
// Plausible epoch window: [2001-01-01, 2100-01-01) in ms. Anything outside is
// almost certainly an ID / counter, not a timestamp.
const MIN_PLAUSIBLE_EPOCH_MS = Date.UTC(2001, 0, 1);
const MAX_PLAUSIBLE_EPOCH_MS = Date.UTC(2100, 0, 1);

export interface TimestampDecodeResult {
  epochMs: number;
  unit: "s" | "ms";
}

export function tryDecodeTimestamp(input: string): TimestampDecodeResult | null {
  let epochMs: number;
  let unit: "s" | "ms";
  if (TIMESTAMP_MILLIS_RE.test(input)) {
    epochMs = Number(input);
    unit = "ms";
  } else if (TIMESTAMP_SECONDS_RE.test(input)) {
    epochMs = Number(input) * 1000;
    unit = "s";
  } else {
    return null;
  }

  if (!Number.isFinite(epochMs) || epochMs < MIN_PLAUSIBLE_EPOCH_MS || epochMs >= MAX_PLAUSIBLE_EPOCH_MS) {
    return null;
  }
  return { epochMs, unit };
}

const PURE_NUMBER_RE = /^\d+$/;
// A date string must carry at least one date/time separator or a month name —
// this filters out bare tokens / version numbers that `Date.parse` would coerce.
const DATE_SIGNAL_RE = /[-/:]|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i;
// ISO date-only (`2026-05-27`) is parsed as UTC midnight by the spec; we want
// "no time zone means local", so detect and construct it as local instead.
const ISO_DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_PLAUSIBLE_DATE_YEAR = 1900;
const MAX_PLAUSIBLE_DATE_YEAR = 2200;

export interface DateStringDecodeResult {
  epochMs: number;
}

export function tryDecodeDateString(input: string): DateStringDecodeResult | null {
  // Pure numbers are handled by the timestamp decoder; keep the two mutually exclusive.
  if (PURE_NUMBER_RE.test(input)) {
    return null;
  }
  if (!DATE_SIGNAL_RE.test(input)) {
    return null;
  }

  let epochMs: number;
  const isoDateOnly = ISO_DATE_ONLY_RE.exec(input);
  if (isoDateOnly) {
    const year = Number(isoDateOnly[1]);
    const month = Number(isoDateOnly[2]);
    const day = Number(isoDateOnly[3]);
    const local = new Date(year, month - 1, day);
    // Reject calendar overflow such as 2026-13-40 that Date silently rolls over.
    if (local.getFullYear() !== year || local.getMonth() !== month - 1 || local.getDate() !== day) {
      return null;
    }
    epochMs = local.getTime();
  } else {
    epochMs = Date.parse(input);
  }

  if (!Number.isFinite(epochMs)) {
    return null;
  }
  const year = new Date(epochMs).getFullYear();
  if (year < MIN_PLAUSIBLE_DATE_YEAR || year > MAX_PLAUSIBLE_DATE_YEAR) {
    return null;
  }
  return { epochMs };
}
