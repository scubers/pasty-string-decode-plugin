// Preview-host scenarios for the decode renderer.
//
// Each scenario's `bootstrap.attachment.payloadJson` mirrors the exact shape
// produced by `createDecodePayload` in src/runtime/shared/decodePayload.js,
// so the preview workbench renders the same thing the runtime would emit.
// We can't import the runtime detector here because it depends on Node's
// `Buffer`; instead we hand-author the payload objects to match.

function createDecodeScenario({
  id,
  label,
  original,
  payload,
  copyJsonEnabled
}) {
  return {
    id,
    label,
    rendererComponent: "decode",
    searchTerms: [],
    accentHex: null,
    bootstrap: {
      pluginID: "plugin.pasty.awesome.decode",
      rendererID: "decode-renderer",
      item: {
        id: `item-${id}`,
        type: "text",
        text: original,
        tags: [],
        sourceAppID: "com.preview.editor"
      },
      attachment: {
        owner: "plugin.pasty.awesome.decode",
        attachmentType: "plugin.pasty.awesome.decode.preview",
        attachmentKey: "primary",
        payloadJson: JSON.stringify(payload)
      },
      buttons: [
        { id: "copy-decoded", title: "Copy Decoded", isEnabled: true },
        { id: "copy-json", title: "Copy as JSON", isEnabled: copyJsonEnabled },
        { id: "toggle-expand", title: "Show More", isEnabled: true }
      ]
    }
  };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const JWT_ORIGINAL =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

const JWT_HEADER = { alg: "HS256", typ: "JWT" };
const JWT_PAYLOAD = { sub: "1234567890", name: "John Doe", iat: 1516239022 };

const JWT_DECODED = JSON.stringify(
  { header: JWT_HEADER, payload: JWT_PAYLOAD },
  null,
  2
);

const BASE64_PLAINTEXT_ORIGINAL =
  "VGhpcyBpcyBhIGxvbmdlciBwbGFpbnRleHQgdGVzdCB0aGF0IHNob3VsZCBiZSBkZXRlY3RlZCBhcyBiYXNlNjQu";
const BASE64_PLAINTEXT_DECODED =
  "This is a longer plaintext test that should be detected as base64.";

const BASE64_JSON_ORIGINAL = "eyJmb28iOiJiYXIiLCJjb3VudCI6NDJ9";
const BASE64_JSON_DECODED = '{"foo":"bar","count":42}';

const URL_ORIGINAL =
  "https%3A%2F%2Fexample.com%2Fpath%3Fname%3DJohn%20Doe%26filter%3Dfoo%20bar";
const URL_DECODED = "https://example.com/path?name=John Doe&filter=foo bar";

// JSON-escaped string literal: source text is `"{\"nested\":\"json\"}"`.
const ESCAPED_JSON_ORIGINAL = '"{\\"nested\\":\\"json\\"}"';
const ESCAPED_JSON_DECODED = '{"nested":"json"}';

// Path B sample: log-style escaped JSON whose outer quotes were stripped.
const ESCAPED_JSON_LOG_ORIGINAL =
  '{\\n    \\"dc_recv_count\\": 100,\\n    \\"net_recv_count\\": 200,\\n    \\"net_recv_bytes\\": 512000,\\n    \\"c_fps\\": 60,\\n    \\"frame_size_width\\": 1920\\n}';
const ESCAPED_JSON_LOG_DECODED =
  '{\n    "dc_recv_count": 100,\n    "net_recv_count": 200,\n    "net_recv_bytes": 512000,\n    "c_fps": 60,\n    "frame_size_width": 1920\n}';

export const attachmentScenarios = [
  createDecodeScenario({
    id: "jwt",
    label: "JWT",
    original: JWT_ORIGINAL,
    payload: {
      kind: "decode_preview",
      version: 1,
      encoding: "jwt",
      original: JWT_ORIGINAL,
      truncated: false,
      decoded: JWT_DECODED,
      decodedIsJSON: true,
      jwt: { header: JWT_HEADER, payload: JWT_PAYLOAD },
      originalLength: JWT_ORIGINAL.length,
      decodedLength: JWT_DECODED.length,
      expanded: false
    },
    copyJsonEnabled: true
  }),
  createDecodeScenario({
    id: "base64-plaintext",
    label: "Base64 (plaintext)",
    original: BASE64_PLAINTEXT_ORIGINAL,
    payload: {
      kind: "decode_preview",
      version: 1,
      encoding: "base64",
      original: BASE64_PLAINTEXT_ORIGINAL,
      truncated: false,
      decoded: BASE64_PLAINTEXT_DECODED,
      decodedIsJSON: false,
      jwt: null,
      originalLength: BASE64_PLAINTEXT_ORIGINAL.length,
      decodedLength: BASE64_PLAINTEXT_DECODED.length,
      expanded: false
    },
    copyJsonEnabled: false
  }),
  createDecodeScenario({
    id: "base64-json",
    label: "Base64 (JSON)",
    original: BASE64_JSON_ORIGINAL,
    payload: {
      kind: "decode_preview",
      version: 1,
      encoding: "base64",
      original: BASE64_JSON_ORIGINAL,
      truncated: false,
      decoded: BASE64_JSON_DECODED,
      decodedIsJSON: true,
      jwt: null,
      originalLength: BASE64_JSON_ORIGINAL.length,
      decodedLength: BASE64_JSON_DECODED.length,
      expanded: false
    },
    copyJsonEnabled: true
  }),
  createDecodeScenario({
    id: "url-encoded",
    label: "URL encoded",
    original: URL_ORIGINAL,
    payload: {
      kind: "decode_preview",
      version: 1,
      encoding: "url",
      original: URL_ORIGINAL,
      truncated: false,
      decoded: URL_DECODED,
      decodedIsJSON: false,
      jwt: null,
      originalLength: URL_ORIGINAL.length,
      decodedLength: URL_DECODED.length,
      expanded: false
    },
    copyJsonEnabled: false
  }),
  createDecodeScenario({
    id: "escaped-json",
    label: "Escaped JSON (Path A — quoted literal)",
    original: ESCAPED_JSON_ORIGINAL,
    payload: {
      kind: "decode_preview",
      version: 1,
      encoding: "escaped_json",
      original: ESCAPED_JSON_ORIGINAL,
      truncated: false,
      decoded: ESCAPED_JSON_DECODED,
      decodedIsJSON: true,
      jwt: null,
      originalLength: ESCAPED_JSON_ORIGINAL.length,
      decodedLength: ESCAPED_JSON_DECODED.length,
      expanded: false
    },
    copyJsonEnabled: true
  }),
  createDecodeScenario({
    id: "escaped-json-log",
    label: "Escaped JSON (Path B — log-style, no outer quotes)",
    original: ESCAPED_JSON_LOG_ORIGINAL,
    payload: {
      kind: "decode_preview",
      version: 1,
      encoding: "escaped_json",
      original: ESCAPED_JSON_LOG_ORIGINAL,
      truncated: false,
      decoded: ESCAPED_JSON_LOG_DECODED,
      decodedIsJSON: true,
      jwt: null,
      originalLength: ESCAPED_JSON_LOG_ORIGINAL.length,
      decodedLength: ESCAPED_JSON_LOG_DECODED.length,
      expanded: false
    },
    copyJsonEnabled: true
  })
];
