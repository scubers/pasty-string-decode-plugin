"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..", "..");

function loadDetectorModule() {
  return require(path.resolve(projectRoot, "src/runtime/detectors/decodeDetector.js"));
}

function loadDetectionModule() {
  return require(path.resolve(projectRoot, "src/runtime/shared/detection.js"));
}

function loadDecodersModule() {
  return require(path.resolve(projectRoot, "src/runtime/shared/decoders.js"));
}

function loadPayloadModule() {
  return require(path.resolve(projectRoot, "src/runtime/shared/decodePayload.js"));
}

function makeTextInput(text) {
  return {
    item: { id: "id-1", type: "text", tags: [], sourceAppID: "test" },
    content: { kind: "text", payload: { text } },
    attachments: []
  };
}

// ─── Pre-computed fixtures ──────────────────────────────────────────────────

// JWT (HS256, payload = { sub, name, iat })
const JWT_VALID =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

// JWT with empty signature segment (legal per spec regex)
const JWT_NO_SIG =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhYmMifQ.";

// Base64
const B64_HELLO = "SGVsbG8sIFdvcmxkIQ=="; // "Hello, World!"
const B64_LONG =
  "VGhpcyBpcyBhIGxvbmdlciBwbGFpbnRleHQgdGVzdCB0aGF0IHNob3VsZCBiZSBkZXRlY3RlZCBhcyBiYXNlNjQu";
const B64_JSON = "eyJmb28iOiJiYXIiLCJjb3VudCI6NDJ9"; // {"foo":"bar","count":42}
const B64URL_HELLO = "SGVsbG8sIFdvcmxkIQ"; // unpadded URL-safe

// URL
const URL_ENCODED = "https%3A%2F%2Fexample.com%2Fpath%3Fname%3DJohn%20Doe%26filter%3Dfoo%20bar";
const URL_JSON = "%7B%22a%22%3A1%2C%22b%22%3A%22two%22%7D"; // {"a":1,"b":"two"}

// Escaped JSON (a JSON string literal)
const ESCAPED_JSON_PLAIN = '"Hello\\nWorld\\twith escapes"';
const ESCAPED_JSON_NESTED = '"{\\"nested\\":\\"json\\"}"';

// MIME-wrapped Base64 (76-char lines separated by \r\n)
const B64_MIME_LONG = Buffer.from("A".repeat(200)).toString("base64").match(/.{1,76}/g).join("\r\n");

// False positives
const HEX_32 = "0123456789abcdef0123456789abcdef"; // 32 hex chars
const UUID = "550e8400-e29b-41d4-a716-446655440000";
const SHORT_RANDOM_6 = "AbCdEf"; // length 6 (< 8)
const CHINESE = "你好世界这是中文测试";

// ─── Decoders (pure functions) ──────────────────────────────────────────────

test("decoders.tryDecodeJWT returns header+payload for a valid JWT", () => {
  const { tryDecodeJWT } = loadDecodersModule();
  const out = tryDecodeJWT(JWT_VALID);
  assert.ok(out, "expected decode result");
  assert.equal(out.header.alg, "HS256");
  assert.equal(out.payload.sub, "1234567890");
  assert.equal(out.payload.name, "John Doe");
});

test("decoders.tryDecodeJWT accepts empty signature segment", () => {
  const { tryDecodeJWT } = loadDecodersModule();
  const out = tryDecodeJWT(JWT_NO_SIG);
  assert.ok(out, "expected decode result for empty-signature JWT");
  assert.equal(out.header.alg, "HS256");
});

test("decoders.tryDecodeJWT returns null when header lacks alg field", () => {
  const { tryDecodeJWT } = loadDecodersModule();
  // header: {"typ":"JWT"} (no alg)
  const bad = "eyJ0eXAiOiJKV1QifQ.eyJzdWIiOiJhYmMifQ.sig";
  assert.equal(tryDecodeJWT(bad), null);
});

test("decoders.tryDecodeJWT returns null when not three segments", () => {
  const { tryDecodeJWT } = loadDecodersModule();
  assert.equal(tryDecodeJWT("only.two"), null);
  assert.equal(tryDecodeJWT("a.b.c.d"), null);
});

test("decoders.tryDecodeEscapedJson returns the inner string", () => {
  const { tryDecodeEscapedJson } = loadDecodersModule();
  assert.equal(tryDecodeEscapedJson(ESCAPED_JSON_PLAIN), "Hello\nWorld\twith escapes");
  assert.equal(tryDecodeEscapedJson(ESCAPED_JSON_NESTED), '{"nested":"json"}');
});

test("decoders.tryDecodeEscapedJson returns null when input is not a quoted string", () => {
  const { tryDecodeEscapedJson } = loadDecodersModule();
  assert.equal(tryDecodeEscapedJson("not a json string"), null);
  assert.equal(tryDecodeEscapedJson('{"obj":1}'), null); // plain JSON object, no escape signals
  assert.equal(tryDecodeEscapedJson("12345"), null);
});

test("decoders.tryDecodeEscapedJson (Path B) decodes log-style escaped JSON without outer quotes", () => {
  const { tryDecodeEscapedJson } = loadDecodersModule();
  // User-reported sample: escaped JSON content with outer quotes stripped.
  const input =
    '{\\n    \\"dc_recv_count\\": 100,\\n    \\"net_recv_count\\": 200,\\n    \\"net_recv_bytes\\": 512000\\n}';
  const out = tryDecodeEscapedJson(input);
  assert.ok(typeof out === "string", "expected unescaped string");
  // After unescape we should have a parseable JSON object.
  const parsed = JSON.parse(out);
  assert.equal(parsed.dc_recv_count, 100);
  assert.equal(parsed.net_recv_count, 200);
  assert.equal(parsed.net_recv_bytes, 512000);
});

test("decoders.tryDecodeEscapedJson (Path B) decodes escaped JSON array", () => {
  const { tryDecodeEscapedJson } = loadDecodersModule();
  const input = '[\\n  \\"a\\",\\n  \\"b\\",\\n  \\"c\\"\\n]';
  const out = tryDecodeEscapedJson(input);
  assert.ok(typeof out === "string");
  assert.deepEqual(JSON.parse(out), ["a", "b", "c"]);
});

test("decoders.tryDecodeEscapedJson (Path B) rejects content that unescapes to a scalar", () => {
  const { tryDecodeEscapedJson } = loadDecodersModule();
  // `Hello \"yes\"!` has the `\"` signature but unescapes to plain prose, not JSON.
  assert.equal(tryDecodeEscapedJson('Hello \\"yes\\"!'), null);
  // `\"hello\"` unescapes to `"hello"` which parses as a JSON string scalar — rejected.
  assert.equal(tryDecodeEscapedJson('\\"hello\\"'), null);
});

test("decoders.tryDecodeEscapedJson (Path B) rejects input with no escape signal", () => {
  const { tryDecodeEscapedJson } = loadDecodersModule();
  // Plain JSON has no `\"` signature; Path B does not match.
  // (Path A doesn't either because no outer quotes.)
  assert.equal(tryDecodeEscapedJson('{"foo":1}'), null);
});

test("decoders.tryDecodeUrl decodes percent-encoded text", () => {
  const { tryDecodeUrl } = loadDecodersModule();
  assert.equal(
    tryDecodeUrl(URL_ENCODED),
    "https://example.com/path?name=John Doe&filter=foo bar"
  );
  assert.equal(tryDecodeUrl(URL_JSON), '{"a":1,"b":"two"}');
});

test("decoders.tryDecodeUrl returns null when no percent sequence present", () => {
  const { tryDecodeUrl } = loadDecodersModule();
  assert.equal(tryDecodeUrl("hello world"), null);
});

test("decoders.tryDecodeUrl returns null when decode result equals input", () => {
  const { tryDecodeUrl } = loadDecodersModule();
  // No %XX → no decoding actually happens
  assert.equal(tryDecodeUrl("nothing-to-decode"), null);
});

test("decoders.tryDecodeBase64 decodes a standard base64 string", () => {
  const { tryDecodeBase64 } = loadDecodersModule();
  assert.equal(tryDecodeBase64(B64_HELLO), "Hello, World!");
  assert.equal(tryDecodeBase64(B64_LONG), "This is a longer plaintext test that should be detected as base64.");
});

test("decoders.tryDecodeBase64 decodes a base64url (unpadded) string", () => {
  const { tryDecodeBase64 } = loadDecodersModule();
  assert.equal(tryDecodeBase64(B64URL_HELLO), "Hello, World!");
});

test("decoders.tryDecodeBase64 strips internal whitespace (MIME-style wrapping)", () => {
  const { tryDecodeBase64 } = loadDecodersModule();
  assert.equal(tryDecodeBase64(B64_MIME_LONG), "A".repeat(200));
});

test("decoders.tryDecodeBase64 rejects strings under 8 chars", () => {
  const { tryDecodeBase64 } = loadDecodersModule();
  assert.equal(tryDecodeBase64("YWI="), null); // "ab"
  assert.equal(tryDecodeBase64("YQ=="), null); // "a"
});

test("decoders.tryDecodeBase64 rejects hex strings (would decode to garbage bytes)", () => {
  const { tryDecodeBase64 } = loadDecodersModule();
  // 32-hex string — passes charset but decodes to non-printable bytes
  assert.equal(tryDecodeBase64(HEX_32), null);
});

test("decoders.tryDecodeBase64 rejects strings with non-base64 characters", () => {
  const { tryDecodeBase64 } = loadDecodersModule();
  assert.equal(tryDecodeBase64("!!not-base64!!"), null);
});

// ─── Preprocess ─────────────────────────────────────────────────────────────

test("preprocess trims leading/trailing whitespace", () => {
  const { preprocess } = loadDetectionModule();
  const out = preprocess("   hello world\n\n");
  assert.equal(out.trimmed, "hello world");
  assert.equal(out.bail, false);
});

test("preprocess bails on empty string", () => {
  const { preprocess } = loadDetectionModule();
  assert.equal(preprocess("").bail, true);
  assert.equal(preprocess("   \n\t").bail, true);
});

test("preprocess bails when input exceeds 256 KB after trim", () => {
  const { preprocess } = loadDetectionModule();
  const huge = "x".repeat(256 * 1024 + 1);
  assert.equal(preprocess(huge).bail, true);
});

test("preprocess does not bail at exactly 256 KB", () => {
  const { preprocess } = loadDetectionModule();
  const big = "x".repeat(256 * 1024);
  const out = preprocess(big);
  assert.equal(out.bail, false);
  assert.equal(out.trimmed.length, 256 * 1024);
});

// ─── Priority chain ────────────────────────────────────────────────────────

test("priority chain: JWT wins over any other interpretation", () => {
  const { runPriorityChain } = loadDetectionModule();
  const out = runPriorityChain(JWT_VALID);
  assert.ok(out);
  assert.equal(out.encoding, "jwt");
  assert.ok(out.jwt);
  assert.equal(out.jwt.header.alg, "HS256");
});

test("priority chain: Escaped JSON wins over URL/Base64", () => {
  const { runPriorityChain } = loadDetectionModule();
  const out = runPriorityChain(ESCAPED_JSON_PLAIN);
  assert.ok(out);
  assert.equal(out.encoding, "escaped_json");
});

test("priority chain: URL wins over Base64 when both would conceivably match", () => {
  const { runPriorityChain } = loadDetectionModule();
  // %XX makes URL match; base64 charset excludes '%' so wouldn't qualify anyway,
  // but this verifies URL wins in the chain.
  const out = runPriorityChain(URL_JSON);
  assert.ok(out);
  assert.equal(out.encoding, "url");
});

test("priority chain: Base64 matches when no higher priority hits", () => {
  const { runPriorityChain } = loadDetectionModule();
  const out = runPriorityChain(B64_LONG);
  assert.ok(out);
  assert.equal(out.encoding, "base64");
  assert.equal(out.decoded, "This is a longer plaintext test that should be detected as base64.");
});

// ─── Detector: end-to-end ──────────────────────────────────────────────────

test("detector emits one JWT artifact with correct payload shape", async () => {
  const { createDecodeDetector } = loadDetectorModule();
  const detector = createDecodeDetector();
  const { artifacts } = await detector.detect(makeTextInput(JWT_VALID));

  assert.equal(artifacts.length, 1);
  const artifact = artifacts[0];
  assert.equal(artifact.attachmentType, "plugin.pasty.awesome.decode.preview");
  assert.equal(artifact.attachmentKey, "primary");
  assert.equal(artifact.attachmentSyncScope, "syncable");
  assert.ok(artifact.searchProjection);
  assert.equal(artifact.searchProjection.scope, "pasty_awesome_decode");
  assert.equal(artifact.searchProjection.label, "JWT");

  const payload = JSON.parse(artifact.payloadJson);
  assert.equal(payload.kind, "decode_preview");
  assert.equal(payload.version, 1);
  assert.equal(payload.encoding, "jwt");
  assert.equal(payload.decodedIsJSON, true);
  assert.ok(payload.jwt);
  assert.equal(payload.jwt.header.alg, "HS256");
  assert.equal(payload.jwt.payload.sub, "1234567890");

  const decodedParsed = JSON.parse(payload.decoded);
  assert.equal(decodedParsed.header.alg, "HS256");
  assert.equal(decodedParsed.payload.name, "John Doe");
});

test("detector emits one Base64 artifact (plaintext payload)", async () => {
  const { createDecodeDetector } = loadDetectorModule();
  const detector = createDecodeDetector();
  const { artifacts } = await detector.detect(makeTextInput(B64_LONG));

  assert.equal(artifacts.length, 1);
  const payload = JSON.parse(artifacts[0].payloadJson);
  assert.equal(payload.encoding, "base64");
  assert.equal(payload.decoded, "This is a longer plaintext test that should be detected as base64.");
  assert.equal(payload.decodedIsJSON, false);
  assert.equal(artifacts[0].searchProjection.label, "Base64");
});

test("detector emits one Base64 artifact (JSON payload)", async () => {
  const { createDecodeDetector } = loadDetectorModule();
  const detector = createDecodeDetector();
  const { artifacts } = await detector.detect(makeTextInput(B64_JSON));

  assert.equal(artifacts.length, 1);
  const payload = JSON.parse(artifacts[0].payloadJson);
  assert.equal(payload.encoding, "base64");
  assert.equal(payload.decoded, '{"foo":"bar","count":42}');
  assert.equal(payload.decodedIsJSON, true);
});

test("detector emits Base64URL (unpadded) artifact", async () => {
  const { createDecodeDetector } = loadDetectorModule();
  const detector = createDecodeDetector();
  const { artifacts } = await detector.detect(makeTextInput(B64URL_HELLO));

  assert.equal(artifacts.length, 1);
  const payload = JSON.parse(artifacts[0].payloadJson);
  assert.equal(payload.encoding, "base64");
  assert.equal(payload.decoded, "Hello, World!");
});

test("detector emits URL artifact for percent-encoded text", async () => {
  const { createDecodeDetector } = loadDetectorModule();
  const detector = createDecodeDetector();
  const { artifacts } = await detector.detect(makeTextInput(URL_ENCODED));

  assert.equal(artifacts.length, 1);
  const payload = JSON.parse(artifacts[0].payloadJson);
  assert.equal(payload.encoding, "url");
  assert.equal(payload.decoded, "https://example.com/path?name=John Doe&filter=foo bar");
  assert.equal(payload.decodedIsJSON, false);
  assert.equal(artifacts[0].searchProjection.label, "URL");
});

test("detector emits URL artifact when decoded is JSON", async () => {
  const { createDecodeDetector } = loadDetectorModule();
  const detector = createDecodeDetector();
  const { artifacts } = await detector.detect(makeTextInput(URL_JSON));

  assert.equal(artifacts.length, 1);
  const payload = JSON.parse(artifacts[0].payloadJson);
  assert.equal(payload.encoding, "url");
  assert.equal(payload.decodedIsJSON, true);
});

test("detector emits Escaped JSON artifact (plain inner string)", async () => {
  const { createDecodeDetector } = loadDetectorModule();
  const detector = createDecodeDetector();
  const { artifacts } = await detector.detect(makeTextInput(ESCAPED_JSON_PLAIN));

  assert.equal(artifacts.length, 1);
  const payload = JSON.parse(artifacts[0].payloadJson);
  assert.equal(payload.encoding, "escaped_json");
  assert.equal(payload.decoded, "Hello\nWorld\twith escapes");
  assert.equal(payload.decodedIsJSON, false);
  assert.equal(artifacts[0].searchProjection.label, "Escaped JSON");
});

test("detector emits Escaped JSON artifact (nested JSON inner string)", async () => {
  const { createDecodeDetector } = loadDetectorModule();
  const detector = createDecodeDetector();
  const { artifacts } = await detector.detect(makeTextInput(ESCAPED_JSON_NESTED));

  assert.equal(artifacts.length, 1);
  const payload = JSON.parse(artifacts[0].payloadJson);
  assert.equal(payload.encoding, "escaped_json");
  assert.equal(payload.decoded, '{"nested":"json"}');
  assert.equal(payload.decodedIsJSON, true);
});

test("detector emits Escaped JSON artifact for log-style content without outer quotes", async () => {
  const { createDecodeDetector } = loadDetectorModule();
  const detector = createDecodeDetector();
  // Real-world sample: a JSON string printed to a log, outer quotes stripped on copy.
  const input =
    '{\\n    \\"dc_recv_count\\": 100,\\n    \\"net_recv_count\\": 200,\\n    \\"net_recv_bytes\\": 512000,\\n    \\"c_fps\\": 60,\\n    \\"total_elapse_avg\\": 30.5,\\n    \\"frame_size_width\\": 1920\\n}\\n';
  const { artifacts } = await detector.detect(makeTextInput(input));

  assert.equal(artifacts.length, 1);
  const payload = JSON.parse(artifacts[0].payloadJson);
  assert.equal(payload.encoding, "escaped_json");
  assert.equal(payload.decodedIsJSON, true);
  const decodedAsObject = JSON.parse(payload.decoded);
  assert.equal(decodedAsObject.dc_recv_count, 100);
  assert.equal(decodedAsObject.frame_size_width, 1920);
});

// ─── False positives ───────────────────────────────────────────────────────

test("detector ignores 32-char hex string", async () => {
  const { createDecodeDetector } = loadDetectorModule();
  const detector = createDecodeDetector();
  const { artifacts } = await detector.detect(makeTextInput(HEX_32));
  assert.deepEqual(artifacts, []);
});

test("detector ignores UUIDs", async () => {
  const { createDecodeDetector } = loadDetectorModule();
  const detector = createDecodeDetector();
  const { artifacts } = await detector.detect(makeTextInput(UUID));
  assert.deepEqual(artifacts, []);
});

test("detector ignores short random strings under 8 chars", async () => {
  const { createDecodeDetector } = loadDetectorModule();
  const detector = createDecodeDetector();
  const { artifacts } = await detector.detect(makeTextInput(SHORT_RANDOM_6));
  assert.deepEqual(artifacts, []);
});

test("detector ignores plain Chinese text", async () => {
  const { createDecodeDetector } = loadDetectorModule();
  const detector = createDecodeDetector();
  const { artifacts } = await detector.detect(makeTextInput(CHINESE));
  assert.deepEqual(artifacts, []);
});

// ─── Preprocess edge cases ─────────────────────────────────────────────────

test("detector trims leading/trailing whitespace before detecting", async () => {
  const { createDecodeDetector } = loadDetectorModule();
  const detector = createDecodeDetector();
  const { artifacts } = await detector.detect(makeTextInput("\n  " + B64_LONG + "  \n"));
  assert.equal(artifacts.length, 1);
  const payload = JSON.parse(artifacts[0].payloadJson);
  assert.equal(payload.encoding, "base64");
});

test("detector handles MIME-wrapped Base64 (CRLF every 76 chars)", async () => {
  const { createDecodeDetector } = loadDetectorModule();
  const detector = createDecodeDetector();
  const { artifacts } = await detector.detect(makeTextInput(B64_MIME_LONG));
  assert.equal(artifacts.length, 1);
  const payload = JSON.parse(artifacts[0].payloadJson);
  assert.equal(payload.encoding, "base64");
  assert.equal(payload.decoded, "A".repeat(200));
});

test("detector returns empty for empty string", async () => {
  const { createDecodeDetector } = loadDetectorModule();
  const detector = createDecodeDetector();
  const { artifacts } = await detector.detect(makeTextInput(""));
  assert.deepEqual(artifacts, []);
});

test("detector returns empty for input larger than 256 KB", async () => {
  const { createDecodeDetector } = loadDetectorModule();
  const detector = createDecodeDetector();
  const huge = "A".repeat(300 * 1024);
  const { artifacts } = await detector.detect(makeTextInput(huge));
  assert.deepEqual(artifacts, []);
});

// ─── Non-text input ────────────────────────────────────────────────────────

test("detector returns empty artifacts for image input kind", async () => {
  const { createDecodeDetector } = loadDetectorModule();
  const detector = createDecodeDetector();
  const { artifacts } = await detector.detect({
    item: { id: "i", type: "image", tags: [], sourceAppID: "test" },
    content: { kind: "image", payload: { bytes: 0, width: 0, height: 0, format: "png" } },
    attachments: []
  });
  assert.deepEqual(artifacts, []);
});

test("detector returns empty artifacts for path_reference input kind", async () => {
  const { createDecodeDetector } = loadDetectorModule();
  const detector = createDecodeDetector();
  const { artifacts } = await detector.detect({
    item: { id: "p", type: "path_reference", tags: [], sourceAppID: "finder" },
    content: { kind: "path_reference", payload: { entries: [] } },
    attachments: []
  });
  assert.deepEqual(artifacts, []);
});

test("detector returns empty artifacts when payload.text is null", async () => {
  const { createDecodeDetector } = loadDetectorModule();
  const detector = createDecodeDetector();
  const { artifacts } = await detector.detect({
    item: { id: "x", type: "text", tags: [], sourceAppID: "test" },
    content: { kind: "text", payload: { text: null } },
    attachments: []
  });
  assert.deepEqual(artifacts, []);
});

// ─── Payload truncation ────────────────────────────────────────────────────

test("payload.original is truncated when input exceeds 4 KB", async () => {
  const { createDecodeDetector } = loadDetectorModule();
  const detector = createDecodeDetector();
  // Build a long base64 with detectable plaintext
  const plain = "ABC ".repeat(2000); // 8000 chars
  const longB64 = Buffer.from(plain).toString("base64");
  const { artifacts } = await detector.detect(makeTextInput(longB64));
  assert.equal(artifacts.length, 1);
  const payload = JSON.parse(artifacts[0].payloadJson);
  assert.equal(payload.encoding, "base64");
  assert.equal(payload.truncated, true);
  assert.ok(payload.original.length <= 4096);
  assert.equal(payload.originalLength, longB64.length);
});

// ─── Payload helpers ───────────────────────────────────────────────────────

test("decodePayload.createDecodePayload encodes detection result correctly", () => {
  const { createDecodePayload } = loadPayloadModule();
  const detection = {
    encoding: "base64",
    decoded: "Hello, World!",
    original: B64_HELLO
  };
  const payload = createDecodePayload(detection);
  assert.equal(payload.kind, "decode_preview");
  assert.equal(payload.version, 1);
  assert.equal(payload.encoding, "base64");
  assert.equal(payload.decoded, "Hello, World!");
  assert.equal(payload.originalLength, B64_HELLO.length);
  assert.equal(payload.decodedLength, "Hello, World!".length);
  assert.equal(payload.decodedIsJSON, false);
  assert.equal(payload.truncated, false);
  assert.equal(payload.jwt, null);
  // New attachments start in compact mode.
  assert.equal(payload.expanded, false);
});

test("decodePayload.decodeDecodePayload preserves expanded flag when present", () => {
  const { decodeDecodePayload } = loadPayloadModule();
  const json = JSON.stringify({
    kind: "decode_preview",
    version: 1,
    encoding: "base64",
    original: "abcd",
    truncated: false,
    decoded: "x",
    decodedIsJSON: false,
    jwt: null,
    originalLength: 4,
    decodedLength: 1,
    expanded: true
  });
  const out = decodeDecodePayload(json);
  assert.ok(out);
  assert.equal(out.expanded, true);
});

test("decodePayload.decodeDecodePayload defaults expanded to false when absent", () => {
  const { decodeDecodePayload } = loadPayloadModule();
  const json = JSON.stringify({
    kind: "decode_preview",
    version: 1,
    encoding: "base64",
    original: "abcd",
    truncated: false,
    decoded: "x",
    decodedIsJSON: false,
    jwt: null,
    originalLength: 4,
    decodedLength: 1
    // expanded intentionally omitted
  });
  const out = decodeDecodePayload(json);
  assert.ok(out);
  assert.equal(out.expanded, false);
});

test("decodePayload.encodingLabel returns the display label", () => {
  const { encodingLabel } = loadPayloadModule();
  assert.equal(encodingLabel("jwt"), "JWT");
  assert.equal(encodingLabel("escaped_json"), "Escaped JSON");
  assert.equal(encodingLabel("url"), "URL");
  assert.equal(encodingLabel("base64"), "Base64");
});

test("decodePayload.decodeDecodePayload returns null on invalid JSON", () => {
  const { decodeDecodePayload } = loadPayloadModule();
  assert.equal(decodeDecodePayload("not json"), null);
  assert.equal(decodeDecodePayload(""), null);
  assert.equal(decodeDecodePayload('{"kind":"something_else"}'), null);
});
