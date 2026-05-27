export type TimeZoneMode = "local" | "utc";

export const DEFAULT_TIME_FORMAT = "yyyy-MM-dd HH:mm:ss";

interface DateParts {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
  millis: number;
}

function extractParts(date: Date, zone: TimeZoneMode): DateParts {
  if (zone === "utc") {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hours: date.getUTCHours(),
      minutes: date.getUTCMinutes(),
      seconds: date.getUTCSeconds(),
      millis: date.getUTCMilliseconds(),
    };
  }
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hours: date.getHours(),
    minutes: date.getMinutes(),
    seconds: date.getSeconds(),
    millis: date.getMilliseconds(),
  };
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, "0");
}

// Longer tokens first so `yyyy` is not consumed as two `yy`, etc.
const TOKEN_RE = /yyyy|yy|MM|M|dd|d|HH|H|mm|m|ss|s|SSS/g;

/**
 * Format an epoch-milliseconds instant using LDML-style tokens
 * (`yyyy yy MM M dd d HH H mm m ss s SSS`) in the given time zone.
 * Returns an empty string for non-finite / invalid instants.
 */
export function formatEpoch(epochMs: number, format: string, zone: TimeZoneMode): string {
  if (!Number.isFinite(epochMs)) {
    return "";
  }
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const parts = extractParts(date, zone);
  const tokenValues: Record<string, string> = {
    yyyy: pad(parts.year, 4),
    yy: pad(parts.year % 100, 2),
    MM: pad(parts.month, 2),
    M: String(parts.month),
    dd: pad(parts.day, 2),
    d: String(parts.day),
    HH: pad(parts.hours, 2),
    H: String(parts.hours),
    mm: pad(parts.minutes, 2),
    m: String(parts.minutes),
    ss: pad(parts.seconds, 2),
    s: String(parts.seconds),
    SSS: pad(parts.millis, 3),
  };

  return format.replace(TOKEN_RE, (token) => tokenValues[token] ?? token);
}
