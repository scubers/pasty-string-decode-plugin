# Pasty Awesome Decode

Pasty v2 plugin that detects encoded text clipboard items and renders a compact decoded preview.

Supported decoders:

- JWT
- Escaped JSON strings
- Percent-encoded URLs
- Base64 / Base64URL text

## Current SDK Shape

This project has been migrated to the new source-based plugin template:

- Runtime entry: `src/plugin.ts` -> `dist/plugin.cjs`
- Detector return shape: `PluginDetectorArtifact[]`
- Text input shape: `input.content.kind === "text"` with `input.content.text`
- Renderer operation callbacks: removed. Renderer UI now uses `pasty.attachmentRenderer.onHostInvoke.on(...)`
- Host buttons: seeded and updated from UI with `pasty.attachmentRenderer.setButtons(...)`
- Height handling: UI calls `pasty.window.autoFit()` and the DOM `autoFit` helper

## Project Structure

```text
src/
├── plugin.ts
├── features/decode-renderer/
│   ├── detector.ts
│   ├── renderer.ts
│   ├── app.vue
│   ├── payload.ts
│   ├── detection.ts
│   └── decoders.ts
├── preview/
│   ├── PreviewShellApp.vue
│   └── scenarios/attachmentScenarios.ts
└── shared/
    ├── base.css
    ├── composables/useTopicRef.ts
    └── jsonHighlight.ts
```

## Commands

```sh
npm install
npm run dev
npm test
npm run build
```

In the Codex desktop environment used for this migration, the app-bundled `node` can fail to load Rollup's native optional package because of macOS code-signing. Use the Codex runtime Node path for build commands if that happens:

```sh
PATH="$PWD/node_modules/.bin:$PATH" /Users/bytedance/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node ./scripts/build-ui.mjs
```
