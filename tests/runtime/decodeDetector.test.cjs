"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..", "..");

function loadDetectorModule() {
  return require(path.resolve(projectRoot, "src/features/decode-renderer/detector.ts"));
}

function loadDetectionModule() {
  return require(path.resolve(projectRoot, "src/features/decode-renderer/detection.ts"));
}

function loadDecodersModule() {
  return require(path.resolve(projectRoot, "src/features/decode-renderer/decoders.ts"));
}

function loadPayloadModule() {
  return require(path.resolve(projectRoot, "src/features/decode-renderer/payload.ts"));
}

function makeTextInput(text) {
  return {
    item: { id: "id-1", type: "text", tags: [], sourceAppID: "test" },
    content: { kind: "text", text },
    attachments: [],
  };
}

const JWT_VALID =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
const JWT_NO_SIG =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhYmMifQ.";
const B64_HELLO = "SGVsbG8sIFdvcmxkIQ==";
const B64_LONG =
  "VGhpcyBpcyBhIGxvbmdlciBwbGFpbnRleHQgdGVzdCB0aGF0IHNob3VsZCBiZSBkZXRlY3RlZCBhcyBiYXNlNjQu";
const B64_JSON = "eyJmb28iOiJiYXIiLCJjb3VudCI6NDJ9";
const B64URL_HELLO = "SGVsbG8sIFdvcmxkIQ";
const URL_ENCODED = "https%3A%2F%2Fexample.com%2Fpath%3Fname%3DJohn%20Doe%26filter%3Dfoo%20bar";
const URL_JSON = "%7B%22a%22%3A1%2C%22b%22%3A%22two%22%7D";
const ESCAPED_JSON_PLAIN = '"Hello\\nWorld\\twith escapes"';
const ESCAPED_JSON_NESTED = '"{\\"nested\\":\\"json\\"}"';
const B64_MIME_LONG = Buffer.from("A".repeat(200)).toString("base64").match(/.{1,76}/g).join("\r\n");
const HEX_32 = "0123456789abcdef0123456789abcdef";
const UUID = "550e8400-e29b-41d4-a716-446655440000";
const SHORT_RANDOM_6 = "AbCdEf";
const CHINESE = "你好世界这是中文测试";
const TS_SECONDS = "1716800000";
const TS_MILLIS = "1716800000000";
const TS_OUT_OF_RANGE = "9999999999";
const NINE_DIGITS = "123456789";
const DATE_ISO_DATE_ONLY = "2026-05-27";
const DATE_ISO_ZONED = "2026-05-27T10:00:00Z";
const VERSION_STRING = "1.2.3";

test("decoders.tryDecodeJWT returns header+payload for a valid JWT", () => {
  const { tryDecodeJWT } = loadDecodersModule();
  const out = tryDecodeJWT(JWT_VALID);
  assert.ok(out);
  assert.equal(out.header.alg, "HS256");
  assert.equal(out.payload.sub, "1234567890");
  assert.equal(out.payload.name, "John Doe");
});

test("decoders.tryDecodeJWT accepts empty signature segment", () => {
  const { tryDecodeJWT } = loadDecodersModule();
  const out = tryDecodeJWT(JWT_NO_SIG);
  assert.ok(out);
  assert.equal(out.header.alg, "HS256");
});

test("decoders.tryDecodeJWT returns null when header lacks alg field", () => {
  const { tryDecodeJWT } = loadDecodersModule();
  const bad = "eyJ0eXAiOiJKV1QifQ.eyJzdWIiOiJhYmMifQ.sig";
  assert.equal(tryDecodeJWT(bad), null);
});

test("decoders.tryDecodeEscapedJson returns the inner string", () => {
  const { tryDecodeEscapedJson } = loadDecodersModule();
  assert.equal(tryDecodeEscapedJson(ESCAPED_JSON_PLAIN), "Hello\nWorld\twith escapes");
  assert.equal(tryDecodeEscapedJson(ESCAPED_JSON_NESTED), '{"nested":"json"}');
});

test("decoders.tryDecodeEscapedJson decodes log-style escaped JSON without outer quotes", () => {
  const { tryDecodeEscapedJson } = loadDecodersModule();
  const input =
    '{\\n    \\"dc_recv_count\\": 100,\\n    \\"net_recv_count\\": 200,\\n    \\"net_recv_bytes\\": 512000\\n}';
  const out = tryDecodeEscapedJson(input);
  assert.ok(typeof out === "string");
  assert.equal(JSON.parse(out).dc_recv_count, 100);
});

test("decoders.tryDecodeEscapedJson rejects scalar escaped prose", () => {
  const { tryDecodeEscapedJson } = loadDecodersModule();
  assert.equal(tryDecodeEscapedJson('Hello \\"yes\\"!'), null);
  assert.equal(tryDecodeEscapedJson('\\"hello\\"'), null);
});

test("decoders.tryDecodeUrl decodes percent-encoded text", () => {
  const { tryDecodeUrl } = loadDecodersModule();
  assert.equal(
    tryDecodeUrl(URL_ENCODED),
    "https://example.com/path?name=John Doe&filter=foo bar",
  );
  assert.equal(tryDecodeUrl(URL_JSON), '{"a":1,"b":"two"}');
});

test("decoders.tryDecodeUrl returns null when no percent sequence present", () => {
  const { tryDecodeUrl } = loadDecodersModule();
  assert.equal(tryDecodeUrl("hello world"), null);
});

test("decoders.tryDecodeBase64 decodes standard and url-safe base64 strings", () => {
  const { tryDecodeBase64 } = loadDecodersModule();
  assert.equal(tryDecodeBase64(B64_HELLO), "Hello, World!");
  assert.equal(tryDecodeBase64(B64_LONG), "This is a longer plaintext test that should be detected as base64.");
  assert.equal(tryDecodeBase64(B64URL_HELLO), "Hello, World!");
});

test("decoders.tryDecodeBase64 strips MIME-style wrapping", () => {
  const { tryDecodeBase64 } = loadDecodersModule();
  assert.equal(tryDecodeBase64(B64_MIME_LONG), "A".repeat(200));
});

test("decoders.tryDecodeBase64 rejects common false positives", () => {
  const { tryDecodeBase64 } = loadDecodersModule();
  assert.equal(tryDecodeBase64("YWI="), null);
  assert.equal(tryDecodeBase64(HEX_32), null);
  assert.equal(tryDecodeBase64("!!not-base64!!"), null);
});

test("preprocess trims and enforces the 256 KB cap", () => {
  const { preprocess } = loadDetectionModule();
  assert.deepEqual(preprocess("   hello world\n\n"), { trimmed: "hello world", bail: false });
  assert.equal(preprocess("").bail, true);
  assert.equal(preprocess("x".repeat(256 * 1024 + 1)).bail, true);
  assert.equal(preprocess("x".repeat(256 * 1024)).bail, false);
});

test("priority chain keeps JWT, escaped JSON, URL, Base64 order", () => {
  const { runPriorityChain } = loadDetectionModule();
  assert.equal(runPriorityChain(JWT_VALID).encoding, "jwt");
  assert.equal(runPriorityChain(ESCAPED_JSON_PLAIN).encoding, "escaped_json");
  assert.equal(runPriorityChain(URL_JSON).encoding, "url");
  assert.equal(runPriorityChain(B64_LONG).encoding, "base64");
});

test("detector emits one JWT artifact with the new array return shape", async () => {
  const { createDecodeDetector } = loadDetectorModule();
  const detector = createDecodeDetector();
  const artifacts = await detector.detect(makeTextInput(JWT_VALID));

  assert.equal(artifacts.length, 1);
  const artifact = artifacts[0];
  assert.equal(artifact.attachmentType, "plugin.pasty.awesome.decode.preview");
  assert.equal(artifact.attachmentKey, "primary");
  assert.equal(artifact.attachmentSyncScope, "syncable");
  assert.equal(artifact.searchProjection.scope, "pasty_awesome_decode");
  assert.equal(artifact.searchProjection.label, "JWT");

  const payload = JSON.parse(artifact.payloadJson);
  assert.equal(payload.kind, "decode_preview");
  assert.equal(payload.encoding, "jwt");
  assert.equal(payload.decodedIsJSON, true);
  assert.equal(payload.jwt.header.alg, "HS256");
  assert.equal(payload.jwt.payload.sub, "1234567890");
});

test("detector emits Base64, URL, and Escaped JSON artifacts", async () => {
  const { createDecodeDetector } = loadDetectorModule();
  const detector = createDecodeDetector();

  const base64Payload = JSON.parse((await detector.detect(makeTextInput(B64_JSON)))[0].payloadJson);
  assert.equal(base64Payload.encoding, "base64");
  assert.equal(base64Payload.decoded, '{"foo":"bar","count":42}');
  assert.equal(base64Payload.decodedIsJSON, true);

  const urlPayload = JSON.parse((await detector.detect(makeTextInput(URL_ENCODED)))[0].payloadJson);
  assert.equal(urlPayload.encoding, "url");
  assert.equal(urlPayload.decoded, "https://example.com/path?name=John Doe&filter=foo bar");

  const escapedPayload = JSON.parse((await detector.detect(makeTextInput(ESCAPED_JSON_NESTED)))[0].payloadJson);
  assert.equal(escapedPayload.encoding, "escaped_json");
  assert.equal(escapedPayload.decoded, '{"nested":"json"}');
  assert.equal(escapedPayload.decodedIsJSON, true);
});

test("detector ignores false positives and non-text inputs", async () => {
  const { createDecodeDetector } = loadDetectorModule();
  const detector = createDecodeDetector();

  assert.deepEqual(await detector.detect(makeTextInput(HEX_32)), []);
  assert.deepEqual(await detector.detect(makeTextInput(UUID)), []);
  assert.deepEqual(await detector.detect(makeTextInput(SHORT_RANDOM_6)), []);
  assert.deepEqual(await detector.detect(makeTextInput(CHINESE)), []);
  assert.deepEqual(await detector.detect({
    item: { id: "i", type: "image", tags: [], sourceAppID: "test" },
    content: { kind: "image", bytes: 0, width: 0, height: 0, format: "png" },
    attachments: [],
  }), []);
});

test("detector accepts legacy text payload envelope during migration", async () => {
  const { createDecodeDetector } = loadDetectorModule();
  const detector = createDecodeDetector();
  const artifacts = await detector.detect({
    item: { id: "legacy", type: "text", tags: [], sourceAppID: "test" },
    content: { kind: "text", payload: { text: B64_HELLO } },
    attachments: [],
  });
  assert.equal(artifacts.length, 1);
  assert.equal(JSON.parse(artifacts[0].payloadJson).decoded, "Hello, World!");
});

test("payload.original is truncated when input exceeds 4 KB", async () => {
  const { createDecodeDetector } = loadDetectorModule();
  const detector = createDecodeDetector();
  const plain = "ABC ".repeat(2000);
  const longB64 = Buffer.from(plain).toString("base64");
  const artifacts = await detector.detect(makeTextInput(longB64));
  const payload = JSON.parse(artifacts[0].payloadJson);
  assert.equal(payload.truncated, true);
  assert.ok(payload.original.length <= 4096);
  assert.equal(payload.originalLength, longB64.length);
});

test("decoders.tryDecodeTimestamp accepts 10-digit seconds and 13-digit millis", () => {
  const { tryDecodeTimestamp } = loadDecodersModule();
  assert.deepEqual(tryDecodeTimestamp(TS_SECONDS), { epochMs: 1716800000000, unit: "s" });
  assert.deepEqual(tryDecodeTimestamp(TS_MILLIS), { epochMs: 1716800000000, unit: "ms" });
});

test("decoders.tryDecodeTimestamp rejects out-of-range and wrong-length numbers", () => {
  const { tryDecodeTimestamp } = loadDecodersModule();
  assert.equal(tryDecodeTimestamp(TS_OUT_OF_RANGE), null); // seconds → year 2286
  assert.equal(tryDecodeTimestamp(NINE_DIGITS), null); // 9 digits
  assert.equal(tryDecodeTimestamp("123456789012"), null); // 12 digits
});

test("decoders.tryDecodeDateString parses zoned and date-only strings", () => {
  const { tryDecodeDateString } = loadDecodersModule();
  // Zoned input is timezone-independent.
  assert.equal(tryDecodeDateString(DATE_ISO_ZONED).epochMs, Date.parse(DATE_ISO_ZONED));
  // Date-only with no zone is interpreted as local midnight, not UTC.
  assert.equal(tryDecodeDateString(DATE_ISO_DATE_ONLY).epochMs, new Date(2026, 4, 27).getTime());
});

test("decoders.tryDecodeDateString rejects pure numbers, version strings, and overflow dates", () => {
  const { tryDecodeDateString } = loadDecodersModule();
  assert.equal(tryDecodeDateString(TS_SECONDS), null); // pure number → timestamp's job
  assert.equal(tryDecodeDateString(VERSION_STRING), null); // no date separator char
  assert.equal(tryDecodeDateString("2026-13-40"), null); // calendar overflow
  assert.equal(tryDecodeDateString(UUID), null); // unparseable
});

test("priority chain places timestamp and date before Base64", () => {
  const { runPriorityChain } = loadDetectionModule();
  assert.equal(runPriorityChain(TS_MILLIS).encoding, "timestamp");
  assert.equal(runPriorityChain(TS_SECONDS).encoding, "timestamp");
  assert.equal(runPriorityChain(DATE_ISO_ZONED).encoding, "date");
  assert.equal(runPriorityChain(B64_LONG).encoding, "base64");
});

test("detector emits timestamp and date artifacts carrying epochMs", async () => {
  const { createDecodeDetector } = loadDetectorModule();
  const detector = createDecodeDetector();

  const tsPayload = JSON.parse((await detector.detect(makeTextInput(TS_SECONDS)))[0].payloadJson);
  assert.equal(tsPayload.encoding, "timestamp");
  assert.equal(tsPayload.epochMs, 1716800000000);
  assert.equal(tsPayload.tsUnit, "s");
  assert.equal(tsPayload.decodedIsJSON, false);

  const dateArtifacts = await detector.detect(makeTextInput(DATE_ISO_ZONED));
  const datePayload = JSON.parse(dateArtifacts[0].payloadJson);
  assert.equal(datePayload.encoding, "date");
  assert.equal(datePayload.epochMs, Date.parse(DATE_ISO_ZONED));
  assert.equal(datePayload.decodedIsJSON, false);
  assert.equal(dateArtifacts[0].searchProjection.label, "Date");
});

test("decodePayload helpers validate and label payloads", () => {
  const { createDecodePayload, decodeDecodePayload, encodingLabel } = loadPayloadModule();
  const payload = createDecodePayload({
    encoding: "base64",
    decoded: "Hello, World!",
    original: B64_HELLO,
  });
  assert.equal(payload.kind, "decode_preview");
  assert.equal(payload.expanded, false);
  assert.equal(decodeDecodePayload(JSON.stringify({ ...payload, expanded: true })).expanded, true);
  assert.equal(decodeDecodePayload("not json"), null);
  assert.equal(encodingLabel("escaped_json"), "Escaped JSON");
});
