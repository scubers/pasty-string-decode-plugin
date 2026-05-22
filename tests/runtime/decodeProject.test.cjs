"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..", "..");

function loadJSON(relativePath) {
  return JSON.parse(fs.readFileSync(path.resolve(projectRoot, relativePath), "utf8"));
}

test("manifest registers the decode plugin on the new dist/plugin.cjs runtime entry", () => {
  const manifest = loadJSON("manifest.json");
  assert.equal(manifest.plugin.id, "plugin.pasty.awesome.decode");
  assert.equal(manifest.plugin.title, "Pasty Awesome Decode");
  assert.equal(manifest.runtime.nodeEntry, "dist/plugin.cjs");
  assert.deepEqual(manifest.permissions, ["setAttachment"]);

  assert.equal(manifest.attachmentRenderers.length, 1);
  assert.equal(manifest.attachmentRenderers[0].id, "decode-renderer");
  assert.equal(manifest.attachmentRenderers[0].attachmentType, "plugin.pasty.awesome.decode.preview");
  assert.deepEqual(manifest.attachmentRenderers[0].height, { min: 60, max: 480 });
  assert.equal(manifest.attachmentRenderers[0].uiEntry, "renderers/decode-renderer/index.html");

  assert.equal(manifest.detectors.length, 1);
  assert.equal(manifest.detectors[0].id, "decode-detector");
  assert.deepEqual(manifest.detectors[0].supportedInputKinds, ["text"]);
  assert.deepEqual(manifest.detectors[0].attachmentTypes, ["plugin.pasty.awesome.decode.preview"]);
  assert.equal(manifest.actions, undefined);
});

test("package keeps decode identity and verification scripts", () => {
  const packageJSON = loadJSON("package.json");
  assert.equal(packageJSON.name, "@pasty/awesome-decode");
  assert.ok(packageJSON.scripts["build:runtime"]);
  assert.ok(packageJSON.scripts["build:ui"]);
  assert.ok(packageJSON.scripts["verify:build"]);
  assert.ok(packageJSON.scripts.typecheck);
  assert.ok(packageJSON.scripts.lint);
});

test("runtime setup registers decode handlers only", () => {
  const { createDecodeDetector } = require(path.resolve(projectRoot, "src/features/decode-renderer/detector.ts"));
  const { createDecodeRenderer } = require(path.resolve(projectRoot, "src/features/decode-renderer/renderer.ts"));
  const runtime = {
    detectors: { "decode-detector": createDecodeDetector() },
    attachmentRenderers: { "decode-renderer": createDecodeRenderer() },
  };

  assert.ok(runtime.detectors["decode-detector"]);
  assert.ok(runtime.attachmentRenderers["decode-renderer"]);
  assert.equal(runtime.actions, undefined);
});

test("decode UI uses SDK APIs instead of removed bridge APIs", () => {
  const source = fs.readFileSync(path.resolve(projectRoot, "src/features/decode-renderer/app.vue"), "utf8");
  assert.ok(source.includes("pasty.attachmentRenderer.onHostInvoke.on"));
  assert.ok(source.includes("pasty.attachmentRenderer.setButtons"));
  assert.ok(source.includes("pasty.window.autoFit"));
  assert.ok(!source.includes("pasty.ready"));
  assert.ok(!source.includes("pasty.item.setAttachments"));
  assert.ok(!source.includes("window.webkit.messageHandlers"));
  assert.ok(!source.includes("addEventListener(\"pasty-plugin-"));
});
