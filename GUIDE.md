# Pasty Awesome Decode Migration Guide

This plugin is intentionally small: one detector and one attachment renderer.

## Runtime

`src/plugin.ts` registers:

- `decode-detector`
- `decode-renderer`

The manifest points at `dist/plugin.cjs`, produced from `src/plugin.ts` by `scripts/build-runtime.mjs`.

## Detector Contract

The new SDK passes content as a flat envelope:

```ts
input.content.kind === "text";
input.content.text;
```

`createDecodeDetector().detect(input)` returns a plain `PluginDetectorArtifact[]`. It no longer returns `{ artifacts }`.

During migration, `readTextContent()` still accepts the old `{ kind: "text", payload: { text } }` shape so older local tests and preview fixtures do not fail abruptly.

## Renderer Contract

The new SDK removed renderer `invokeOperation`. Runtime renderer code only implements:

```ts
resolveAttachment(input)
```

Renderer UI owns interaction:

- `pasty.attachmentRenderer.setButtons(...)` seeds and updates native host buttons.
- `pasty.attachmentRenderer.onHostInvoke.on(...)` receives native button clicks.
- `pasty.clipboard.copyText({ text })` copies decoded output.
- `pasty.window.autoFit()` plus the DOM `autoFit()` helper adjusts height when expanding or collapsing.

Expanded state is local UI state. It is not written back to attachment payload because it is only presentation state.

## Build Notes

The production artifact must contain:

- `dist/plugin.cjs`
- `dist/ui/renderers/decode-renderer/index.html`
- `dist/ui/renderers/decode-renderer/index.js`
- `dist/ui/renderers/decode-renderer/index.css`

`scripts/verify-build.mjs` checks those files and verifies page-local asset references.
