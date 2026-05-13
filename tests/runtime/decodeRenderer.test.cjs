"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..", "..");

function loadRenderer() {
  return require(path.resolve(projectRoot, "src/runtime/renderers/decodeRenderer.js"));
}

function buildPayloadJson(overrides = {}) {
  const base = {
    kind: "decode_preview",
    version: 1,
    encoding: "base64",
    original: "SGVsbG8sIFdvcmxkIQ==",
    truncated: false,
    decoded: "Hello, World!",
    decodedIsJSON: false,
    jwt: null,
    originalLength: 20,
    decodedLength: 13,
    expanded: false
  };
  return JSON.stringify({ ...base, ...overrides });
}

function captureClipboardCtx() {
  let copied = null;
  let setAttachmentsCalls = [];
  const ctx = {
    host: {
      clipboard: {
        async copyText(value) {
          copied = value;
        }
      },
      item: {
        async setAttachments(payload) {
          setAttachmentsCalls.push(payload);
        }
      }
    }
  };
  return {
    ctx,
    getCopied: () => copied,
    getSetAttachmentsCalls: () => setAttachmentsCalls
  };
}

// ─── resolveAttachment ──────────────────────────────────────────────────────

test("resolveAttachment returns Copy Decoded enabled + Copy as JSON disabled for plain Base64", () => {
  const { resolveAttachment } = loadRenderer();
  const out = resolveAttachment({
    attachment: { payloadJson: buildPayloadJson({ encoding: "base64", decodedIsJSON: false }) }
  });
  assert.ok(out.displayName);
  const buttonIDs = out.buttons.map((b) => b.id);
  assert.deepEqual(buttonIDs, ["copy-decoded", "copy-json", "toggle-expand"]);
  const copyDecoded = out.buttons.find((b) => b.id === "copy-decoded");
  const copyJson = out.buttons.find((b) => b.id === "copy-json");
  assert.equal(copyDecoded.isEnabled, true);
  assert.equal(copyJson.isEnabled, false);
});

test("resolveAttachment does not set encoding-specific tintHex (host accent applies)", () => {
  const { resolveAttachment } = loadRenderer();
  for (const encoding of ["jwt", "escaped_json", "url", "base64"]) {
    const out = resolveAttachment({
      attachment: { payloadJson: buildPayloadJson({ encoding }) }
    });
    // Either omitted or null — never a hardcoded color.
    if ("tintHex" in out) {
      assert.equal(out.tintHex, null, `encoding ${encoding} should have null tintHex`);
    }
  }
});

test("resolveAttachment toggle-expand title reflects payload.expanded flag", () => {
  const { resolveAttachment } = loadRenderer();
  const collapsed = resolveAttachment({
    attachment: { payloadJson: buildPayloadJson({ expanded: false }) }
  });
  const toggleCollapsed = collapsed.buttons.find((b) => b.id === "toggle-expand");
  assert.ok(toggleCollapsed);
  assert.equal(toggleCollapsed.title, "Show More");
  assert.equal(toggleCollapsed.isEnabled, true);

  const expanded = resolveAttachment({
    attachment: { payloadJson: buildPayloadJson({ expanded: true }) }
  });
  const toggleExpanded = expanded.buttons.find((b) => b.id === "toggle-expand");
  assert.ok(toggleExpanded);
  assert.equal(toggleExpanded.title, "Show Less");
  assert.equal(toggleExpanded.isEnabled, true);
});

test("resolveAttachment enables Copy as JSON when decodedIsJSON is true", () => {
  const { resolveAttachment } = loadRenderer();
  const out = resolveAttachment({
    attachment: { payloadJson: buildPayloadJson({ encoding: "base64", decodedIsJSON: true }) }
  });
  const copyJson = out.buttons.find((b) => b.id === "copy-json");
  assert.equal(copyJson.isEnabled, true);
});

test("resolveAttachment enables Copy as JSON for JWT regardless of decodedIsJSON flag", () => {
  const { resolveAttachment } = loadRenderer();
  const out = resolveAttachment({
    attachment: {
      payloadJson: buildPayloadJson({
        encoding: "jwt",
        decoded: '{"header":{"alg":"HS256"},"payload":{"sub":"a"}}',
        decodedIsJSON: true,
        jwt: { header: { alg: "HS256" }, payload: { sub: "a" } }
      })
    }
  });
  const copyJson = out.buttons.find((b) => b.id === "copy-json");
  assert.equal(copyJson.isEnabled, true);
});

test("resolveAttachment for URL with non-JSON decoded leaves Copy as JSON disabled", () => {
  const { resolveAttachment } = loadRenderer();
  const out = resolveAttachment({
    attachment: {
      payloadJson: buildPayloadJson({
        encoding: "url",
        decoded: "https://example.com/path?x=y z",
        decodedIsJSON: false
      })
    }
  });
  const copyJson = out.buttons.find((b) => b.id === "copy-json");
  assert.equal(copyJson.isEnabled, false);
});

test("resolveAttachment for Escaped JSON with inner-JSON enables Copy as JSON", () => {
  const { resolveAttachment } = loadRenderer();
  const out = resolveAttachment({
    attachment: {
      payloadJson: buildPayloadJson({
        encoding: "escaped_json",
        decoded: '{"a":1}',
        decodedIsJSON: true
      })
    }
  });
  const copyJson = out.buttons.find((b) => b.id === "copy-json");
  assert.equal(copyJson.isEnabled, true);
});

test("resolveAttachment returns failure-state buttons when payloadJson is invalid", () => {
  const { resolveAttachment } = loadRenderer();
  const out = resolveAttachment({ attachment: { payloadJson: "not-json" } });
  assert.ok(Array.isArray(out.buttons));
  for (const button of out.buttons) {
    assert.equal(button.isEnabled, false);
  }
});

test("invokeOperation toggle-expand flips expanded flag via setAttachments", async () => {
  const { invokeOperation } = loadRenderer();
  const { ctx, getSetAttachmentsCalls } = captureClipboardCtx();
  const result = await invokeOperation(
    {
      attachment: {
        attachmentType: "plugin.pasty.awesome.decode.preview",
        attachmentKey: "primary",
        payloadJson: buildPayloadJson({ expanded: false })
      },
      buttonID: "toggle-expand"
    },
    ctx
  );
  assert.equal(result.success, true);
  const calls = getSetAttachmentsCalls();
  assert.equal(calls.length, 1);
  const arg = calls[0];
  assert.ok(arg && Array.isArray(arg.attachments));
  assert.equal(arg.attachments.length, 1);
  const updated = arg.attachments[0];
  assert.equal(updated.attachmentType, "plugin.pasty.awesome.decode.preview");
  assert.equal(updated.attachmentKey, "primary");
  const parsed = JSON.parse(updated.payloadJson);
  assert.equal(parsed.expanded, true);
  assert.match(result.userMessage || "", /Expanded/);
});

test("invokeOperation toggle-expand flips expanded=true back to false", async () => {
  const { invokeOperation } = loadRenderer();
  const { ctx, getSetAttachmentsCalls } = captureClipboardCtx();
  const result = await invokeOperation(
    {
      attachment: {
        attachmentType: "plugin.pasty.awesome.decode.preview",
        attachmentKey: "primary",
        payloadJson: buildPayloadJson({ expanded: true })
      },
      buttonID: "toggle-expand"
    },
    ctx
  );
  assert.equal(result.success, true);
  const calls = getSetAttachmentsCalls();
  assert.equal(calls.length, 1);
  const parsed = JSON.parse(calls[0].attachments[0].payloadJson);
  assert.equal(parsed.expanded, false);
  assert.match(result.userMessage || "", /Collapsed/);
});

// ─── invokeOperation ───────────────────────────────────────────────────────

test("invokeOperation copy-decoded copies payload.decoded verbatim", async () => {
  const { invokeOperation } = loadRenderer();
  const { ctx, getCopied } = captureClipboardCtx();
  const result = await invokeOperation(
    {
      attachment: { payloadJson: buildPayloadJson({ decoded: "Hello, World!" }) },
      buttonID: "copy-decoded"
    },
    ctx
  );
  assert.equal(result.success, true);
  assert.equal(getCopied(), "Hello, World!");
});

test("invokeOperation copy-decoded for JWT copies the {header,payload} JSON string", async () => {
  const { invokeOperation } = loadRenderer();
  const { ctx, getCopied } = captureClipboardCtx();
  const decoded = JSON.stringify(
    { header: { alg: "HS256" }, payload: { sub: "1" } },
    null,
    2
  );
  const result = await invokeOperation(
    {
      attachment: {
        payloadJson: buildPayloadJson({
          encoding: "jwt",
          decoded,
          decodedIsJSON: true,
          jwt: { header: { alg: "HS256" }, payload: { sub: "1" } }
        })
      },
      buttonID: "copy-decoded"
    },
    ctx
  );
  assert.equal(result.success, true);
  assert.equal(getCopied(), decoded);
});

test("invokeOperation copy-json pretty-prints parsed JSON", async () => {
  const { invokeOperation } = loadRenderer();
  const { ctx, getCopied } = captureClipboardCtx();
  const result = await invokeOperation(
    {
      attachment: {
        payloadJson: buildPayloadJson({
          encoding: "base64",
          decoded: '{"foo":"bar","count":42}',
          decodedIsJSON: true
        })
      },
      buttonID: "copy-json"
    },
    ctx
  );
  assert.equal(result.success, true);
  const expected = JSON.stringify({ foo: "bar", count: 42 }, null, 2);
  assert.equal(getCopied(), expected);
});

test("invokeOperation copy-json fallback when JSON.parse fails copies raw", async () => {
  const { invokeOperation } = loadRenderer();
  const { ctx, getCopied } = captureClipboardCtx();
  // Encoding is JWT (so Copy as JSON is enabled), but decoded is malformed JSON.
  const result = await invokeOperation(
    {
      attachment: {
        payloadJson: buildPayloadJson({
          encoding: "jwt",
          decoded: "not actually json",
          decodedIsJSON: false,
          jwt: { header: { alg: "x" }, payload: {} }
        })
      },
      buttonID: "copy-json"
    },
    ctx
  );
  assert.equal(result.success, true);
  assert.equal(getCopied(), "not actually json");
  assert.match(result.userMessage || "", /JSON parse failed/i);
});

test("invokeOperation returns failure when payloadJson is invalid", async () => {
  const { invokeOperation } = loadRenderer();
  const { ctx } = captureClipboardCtx();
  const result = await invokeOperation(
    { attachment: { payloadJson: "garbage" }, buttonID: "copy-decoded" },
    ctx
  );
  assert.equal(result.success, false);
  assert.match(result.userMessage || "", /Invalid decode payload/);
});

// ─── createDecodeRenderer wrapper ──────────────────────────────────────────

test("createDecodeRenderer exposes resolveAttachment and invokeOperation", () => {
  const { createDecodeRenderer } = loadRenderer();
  const renderer = createDecodeRenderer();
  assert.equal(typeof renderer.resolveAttachment, "function");
  assert.equal(typeof renderer.invokeOperation, "function");
});
