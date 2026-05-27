"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..", "..");

function loadTimeFormat() {
  return require(path.resolve(projectRoot, "src/features/decode-renderer/timeFormat.ts"));
}

test("formatEpoch renders the default format in UTC", () => {
  const { formatEpoch, DEFAULT_TIME_FORMAT } = loadTimeFormat();
  assert.equal(formatEpoch(0, DEFAULT_TIME_FORMAT, "utc"), "1970-01-01 00:00:00");
});

test("formatEpoch pads two-digit tokens and supports SSS millis", () => {
  const { formatEpoch } = loadTimeFormat();
  const epochMs = Date.UTC(2026, 2, 5, 7, 8, 9, 123); // 2026-03-05T07:08:09.123Z
  assert.equal(formatEpoch(epochMs, "yyyy-MM-dd HH:mm:ss", "utc"), "2026-03-05 07:08:09");
  assert.equal(formatEpoch(epochMs, "yyyy-MM-dd HH:mm:ss.SSS", "utc"), "2026-03-05 07:08:09.123");
});

test("formatEpoch single-letter tokens drop leading zeros", () => {
  const { formatEpoch } = loadTimeFormat();
  const epochMs = Date.UTC(2026, 2, 5, 7, 8, 9); // single-digit month/day/h/m/s
  assert.equal(formatEpoch(epochMs, "yyyy-M-d H:m:s", "utc"), "2026-3-5 7:8:9");
  assert.equal(formatEpoch(epochMs, "yy", "utc"), "26");
});

test("formatEpoch handles leap day and arbitrary custom formats", () => {
  const { formatEpoch } = loadTimeFormat();
  const leap = Date.UTC(2024, 1, 29, 0, 0, 0); // 2024-02-29
  assert.equal(formatEpoch(leap, "yyyy/MM/dd", "utc"), "2024/02/29");
  assert.equal(formatEpoch(leap, "dd-MM-yyyy", "utc"), "29-02-2024");
});

test("formatEpoch local zone round-trips a locally constructed instant", () => {
  const { formatEpoch } = loadTimeFormat();
  // Both construction and formatting use local time, so this is timezone-independent.
  const epochMs = new Date(2026, 2, 5, 7, 8, 9).getTime();
  assert.equal(formatEpoch(epochMs, "yyyy-MM-dd HH:mm:ss", "local"), "2026-03-05 07:08:09");
});

test("formatEpoch returns empty string for non-finite input", () => {
  const { formatEpoch } = loadTimeFormat();
  assert.equal(formatEpoch(Number.NaN, "yyyy", "utc"), "");
  assert.equal(formatEpoch(Number.POSITIVE_INFINITY, "yyyy", "utc"), "");
});
