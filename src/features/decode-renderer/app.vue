<template>
  <div ref="rootEl" class="decode-shell">
    <div
      v-if="payload"
      class="decode-panel"
      :class="`decode-panel--${encoding}`"
    >
      <div class="decode-row" @click="onToggle">
        <span class="chip" :class="`chip--${encoding}`">{{ encodingLabelText }}</span>
        <span class="preview" :title="previewText">{{ previewText }}</span>

        <button
          type="button"
          class="icon-btn"
          :aria-label="copied ? 'Copied' : 'Copy decoded'"
          @click.stop="onCopyDecoded"
        >
          <svg v-if="copied" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>

        <button
          type="button"
          class="icon-btn"
          :aria-label="expanded ? 'Collapse' : 'Expand'"
          :aria-expanded="expanded"
          @click.stop="onToggle"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            :class="{ 'chevron-rotated': expanded }"
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      <pre
        v-if="expanded"
        class="code"
        v-html="renderedDecoded"
      />
    </div>

    <p v-else class="decode-empty">No decoded payload available.</p>
    <span aria-live="polite" class="sr-only">{{ copied ? "Copied" : "" }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { pasty } from "@pasty/plugin-sdk/ui";
import type { PluginAttachmentPayload } from "@pasty/plugin-sdk/ui";
import { autoFit } from "@pasty/plugin-sdk/dom";
import { useTopicRef } from "../../shared/composables/useTopicRef";
import { highlightJson } from "../../shared/jsonHighlight";
import { decodeDecodePayload, encodingLabel, type DecodePayload } from "./payload";

const MIN_HEIGHT = 60;
const MAX_HEIGHT = 480;

const rootEl = ref<HTMLElement | null>(null);
const attachmentPayload = useTopicRef(pasty.item.attachment);
const payload = computed<DecodePayload | null>(() =>
  decodeDecodePayload((attachmentPayload.value as PluginAttachmentPayload | undefined)?.attachment?.payloadJson),
);

const localExpanded = ref<boolean>(false);
const copied = ref<boolean>(false);

const expanded = computed<boolean>(() => localExpanded.value);
const encoding = computed<string>(() => payload.value?.encoding ?? "");
const encodingLabelText = computed<string>(() => encodingLabel(encoding.value));

const previewText = computed<string>(() => {
  const text = payload.value?.decoded ?? "";
  return text.replace(/\s+/g, " ").trim();
});

const renderedDecoded = computed<string>(() => {
  const text = payload.value?.decoded ?? "";
  const isJson = payload.value?.encoding === "jwt" || payload.value?.decodedIsJSON === true;
  if (isJson) {
    return highlightJson(text);
  }
  return escapeHtml(text);
});

let disconnectAutoFit: (() => void) | null = null;
let unsubHostInvoke: (() => void) | null = null;
let copyResetTimer: ReturnType<typeof setTimeout> | null = null;

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

function buttonsForCurrentState(): Array<{ id: string; title: string; isEnabled: boolean }> {
  const currentPayload = payload.value;
  if (!currentPayload) {
    return [];
  }

  const buttons = [{ id: "copy-decoded", title: "Copy", isEnabled: true }];
  if (currentPayload.encoding === "jwt" || currentPayload.decodedIsJSON === true) {
    buttons.push({ id: "copy-json", title: "Copy as JSON", isEnabled: true });
  }
  buttons.push({
    id: "toggle-expand",
    title: expanded.value ? "Show Less" : "Show More",
    isEnabled: true,
  });
  return buttons;
}

async function syncHostButtons(): Promise<void> {
  try {
    await pasty.attachmentRenderer.setButtons({ buttons: buttonsForCurrentState() });
  } catch {
    // Local preview may run without the host WebView bridge.
  }
}

async function requestAutoFit(): Promise<void> {
  await nextTick();
  try {
    await pasty.window.autoFit();
  } catch {
    // The DOM helper below still drives height in hosts that expose setHeight.
  }
}

async function copyText(text: string): Promise<void> {
  try {
    await pasty.clipboard.copyText({ text });
  } catch {
    await navigator.clipboard?.writeText(text);
  }
}

function markCopied(): void {
  copied.value = true;
  if (copyResetTimer) {
    clearTimeout(copyResetTimer);
  }
  copyResetTimer = setTimeout(() => {
    copied.value = false;
    copyResetTimer = null;
  }, 1200);
}

async function onCopyDecoded(): Promise<void> {
  const currentPayload = payload.value;
  if (!currentPayload) {
    return;
  }
  await copyText(currentPayload.decoded);
  markCopied();
}

async function onCopyJson(): Promise<void> {
  const currentPayload = payload.value;
  if (!currentPayload) {
    return;
  }
  try {
    const parsed = JSON.parse(currentPayload.decoded) as unknown;
    await copyText(JSON.stringify(parsed, null, 2));
  } catch {
    await copyText(currentPayload.decoded);
  }
  markCopied();
}

async function onToggle(): Promise<void> {
  localExpanded.value = !localExpanded.value;
  await syncHostButtons();
  await requestAutoFit();
}

async function handleHostInvoke(detail: { buttonID?: string } | null | undefined): Promise<void> {
  if (detail?.buttonID === "copy-decoded") {
    await onCopyDecoded();
  } else if (detail?.buttonID === "copy-json") {
    await onCopyJson();
  } else if (detail?.buttonID === "toggle-expand") {
    await onToggle();
  }
}

async function attachAutoFitIfReady(): Promise<void> {
  if (disconnectAutoFit || !payload.value) {
    return;
  }
  await nextTick();
  const target = rootEl.value?.querySelector(".decode-panel") as HTMLElement | null;
  if (!target) {
    return;
  }
  disconnectAutoFit = autoFit({ min: MIN_HEIGHT, max: MAX_HEIGHT, target });
}

watch(
  () => payload.value?.expanded,
  async (value) => {
    localExpanded.value = value === true;
    await syncHostButtons();
    await requestAutoFit();
  },
  { immediate: true },
);

onMounted(() => {
  unsubHostInvoke = pasty.attachmentRenderer.onHostInvoke.on(handleHostInvoke);
  watch(payload, attachAutoFitIfReady, { immediate: true });
});

onUnmounted(() => {
  unsubHostInvoke?.();
  unsubHostInvoke = null;
  disconnectAutoFit?.();
  disconnectAutoFit = null;
  if (copyResetTimer) {
    clearTimeout(copyResetTimer);
    copyResetTimer = null;
  }
});
</script>

<style>
.jh-key { color: oklch(0.82 0.18 145); }
.jh-string { color: oklch(0.92 0.04 80); }
.jh-number { color: oklch(0.78 0.15 50); }
.jh-bool { color: oklch(0.75 0.15 230); }
.jh-null { color: oklch(0.70 0.15 25); }
.jh-punct { color: oklch(0.55 0.02 250); }

@media (prefers-color-scheme: light) {
  .jh-key { color: oklch(0.45 0.18 145); }
  .jh-string { color: oklch(0.40 0.05 80); }
  .jh-number { color: oklch(0.55 0.18 50); }
  .jh-bool { color: oklch(0.45 0.20 230); }
  .jh-null { color: oklch(0.50 0.18 25); }
  .jh-punct { color: oklch(0.55 0.02 250); }
}
</style>

<style scoped>
.decode-shell {
  background: transparent;
  padding: 0;
  margin: 0;
}

.decode-panel {
  background: transparent;
  margin: 0;
}

.decode-row {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  height: 32px;
  min-height: 32px;
  user-select: none;
}

.chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
  flex-shrink: 0;
  background: oklch(0.32 0.10 var(--chip-hue));
  color: oklch(0.92 0.18 var(--chip-hue));
}

.chip--jwt { --chip-hue: 290; }
.chip--escaped_json { --chip-hue: 145; }
.chip--url { --chip-hue: 220; }
.chip--base64 { --chip-hue: 30; }

.preview {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: "SF Mono", "Menlo", "Consolas", "Liberation Mono", monospace;
  font-size: 12px;
  color: var(--pasty-text-secondary, inherit);
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  padding: 4px;
  border: none;
  border-radius: 4px;
  background: none;
  cursor: pointer;
  color: var(--pasty-text-tertiary, inherit);
  transition: background 0.1s;
}

.icon-btn:hover {
  background: var(--pasty-divider, rgba(127, 127, 127, 0.12));
}

.chevron-rotated {
  transform: rotate(180deg);
  transition: transform 0.15s;
}

.code {
  margin-top: 8px;
  margin-bottom: 0;
  padding: 12px;
  background: var(--pasty-surface, transparent);
  border: 1px solid var(--pasty-border, transparent);
  border-radius: 4px;
  font-family: "SF Mono", "Menlo", "Consolas", "Liberation Mono", monospace;
  font-size: 12px;
  line-height: 1.45;
  max-height: 360px;
  overflow: auto;
  white-space: pre;
  color: var(--pasty-text-primary, inherit);
}

.decode-empty {
  margin: 0;
  padding: 8px 4px;
  font-size: 12px;
  color: var(--pasty-text-tertiary, inherit);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
