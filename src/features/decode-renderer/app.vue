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
import { useTopicRef } from "../../shared/composables/useTopicRef";
import { highlightJson } from "../../shared/jsonHighlight";
import { decodeDecodePayload, encodingLabel, type DecodePayload } from "./payload";
import { DEFAULT_TIME_FORMAT, formatEpoch } from "./timeFormat";

const TIMESTAMP_FORMAT_SETTING_KEY = "timestampFormat";

const MIN_HEIGHT = 32;
const MAX_HEIGHT = 480;
const HEIGHT_CHANGE_EPSILON = 1;

const rootEl = ref<HTMLElement | null>(null);
const attachmentPayload = useTopicRef(pasty.item.attachment);
const payload = computed<DecodePayload | null>(() =>
  decodeDecodePayload((attachmentPayload.value as PluginAttachmentPayload | undefined)?.attachment?.payloadJson),
);

const localExpanded = ref<boolean>(false);
const copied = ref<boolean>(false);
const timeFormat = ref<string>(DEFAULT_TIME_FORMAT);

const expanded = computed<boolean>(() => localExpanded.value);
const encoding = computed<string>(() => payload.value?.encoding ?? "");
const encodingLabelText = computed<string>(() => encodingLabel(encoding.value));

function formattedLocalTime(p: DecodePayload): string {
  return p.epochMs != null ? formatEpoch(p.epochMs, timeFormat.value, "local") : "";
}

const previewText = computed<string>(() => {
  const p = payload.value;
  if (!p) {
    return "";
  }
  if (p.encoding === "timestamp") {
    return formattedLocalTime(p);
  }
  if (p.encoding === "date") {
    return p.epochMs != null ? String(p.epochMs) : "";
  }
  return (p.decoded ?? "").replace(/\s+/g, " ").trim();
});

const renderedDecoded = computed<string>(() => {
  const p = payload.value;
  if (!p) {
    return "";
  }
  if (p.encoding === "timestamp" || p.encoding === "date") {
    return escapeHtml(buildTimeBody(p));
  }
  const text = p.decoded ?? "";
  const isJson = p.encoding === "jwt" || p.decodedIsJSON === true;
  return isJson ? highlightJson(text) : escapeHtml(text);
});

let unsubHostInvoke: (() => void) | null = null;
let copyResetTimer: ReturnType<typeof setTimeout> | null = null;
let resizeObserver: ResizeObserver | null = null;
let mutationObserver: MutationObserver | null = null;
let observedHeightTarget: HTMLElement | null = null;
let pendingHeightFrame: number | null = null;
let lastReportedHeight: number | null = null;
let forceNextHeightReport = false;

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

function buildTimeBody(p: DecodePayload): string {
  if (p.epochMs == null) {
    return "";
  }
  const epochMs = p.epochMs;
  const local = formatEpoch(epochMs, timeFormat.value, "local");
  const utc = formatEpoch(epochMs, timeFormat.value, "utc");
  const iso = new Date(epochMs).toISOString();
  if (p.encoding === "timestamp") {
    const unitNote = p.tsUnit === "s" ? "from 10-digit seconds" : "from 13-digit milliseconds";
    return [
      `Local  ${local}`,
      `UTC    ${utc}`,
      `ISO    ${iso}`,
      `Epoch  ${epochMs} ms (${unitNote})`,
    ].join("\n");
  }
  return [
    `Epoch (ms)  ${epochMs}`,
    `Epoch (s)   ${Math.floor(epochMs / 1000)}`,
    `Local       ${local}`,
    `UTC         ${utc}`,
  ].join("\n");
}

async function loadTimeFormat(): Promise<void> {
  try {
    const result = await pasty.settings.get({ key: TIMESTAMP_FORMAT_SETTING_KEY });
    const value = result?.value;
    if (typeof value === "string" && value.trim().length > 0) {
      timeFormat.value = value;
    }
  } catch {
    // Local preview may run without the host bridge; keep the default format.
  }
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
  let text: string;
  if (currentPayload.encoding === "timestamp" && currentPayload.epochMs != null) {
    text = formattedLocalTime(currentPayload);
  } else if (currentPayload.encoding === "date" && currentPayload.epochMs != null) {
    text = String(currentPayload.epochMs);
  } else {
    text = currentPayload.decoded;
  }
  await copyText(text);
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
  const heightSync = syncMeasuredHeight();
  await syncHostButtons();
  await heightSync;
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

function getHeightTarget(): HTMLElement | null {
  return rootEl.value?.querySelector<HTMLElement>(".decode-panel, .decode-empty") ?? null;
}

function clampHeight(height: number): number {
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(height)));
}

function measureTargetHeight(target: HTMLElement): number {
  const rectHeight = target.getBoundingClientRect().height;
  const fallbackHeight = Math.max(target.offsetHeight, target.scrollHeight);
  return clampHeight(rectHeight > 0 ? rectHeight : fallbackHeight);
}

function reportMeasuredHeight(): void {
  const target = getHeightTarget();
  if (!target) {
    return;
  }

  const height = measureTargetHeight(target);
  if (
    !forceNextHeightReport
    && lastReportedHeight !== null
    && Math.abs(height - lastReportedHeight) < HEIGHT_CHANGE_EPSILON
  ) {
    return;
  }
  forceNextHeightReport = false;
  lastReportedHeight = height;

  pasty.window.setHeight({ height }).catch(() => {
    // Local preview may run without the host WebView bridge.
  });
}

function scheduleMeasuredHeight(force = false): void {
  forceNextHeightReport = forceNextHeightReport || force;
  if (pendingHeightFrame !== null || typeof window === "undefined") {
    return;
  }

  pendingHeightFrame = window.requestAnimationFrame(() => {
    pendingHeightFrame = null;
    reportMeasuredHeight();
  });
}

function observeHeightTarget(target: HTMLElement | null): void {
  if (target === observedHeightTarget) {
    return;
  }

  resizeObserver?.disconnect();
  mutationObserver?.disconnect();
  resizeObserver = null;
  mutationObserver = null;
  observedHeightTarget = target;
  lastReportedHeight = null;

  if (!target) {
    return;
  }

  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => scheduleMeasuredHeight());
    resizeObserver.observe(target);
  }

  if (typeof MutationObserver !== "undefined") {
    mutationObserver = new MutationObserver(() => scheduleMeasuredHeight());
    mutationObserver.observe(target, { childList: true, subtree: true, characterData: true });
  }
}

async function syncMeasuredHeight(): Promise<void> {
  await nextTick();
  const target = getHeightTarget();
  observeHeightTarget(target);
  scheduleMeasuredHeight(true);
}

watch(
  () => payload.value?.expanded,
  async (value) => {
    localExpanded.value = value === true;
    const heightSync = syncMeasuredHeight();
    await syncHostButtons();
    await heightSync;
  },
  { immediate: true },
);

watch(payload, syncMeasuredHeight, { immediate: true });

onMounted(() => {
  unsubHostInvoke = pasty.attachmentRenderer.onHostInvoke.on(handleHostInvoke);
  void loadTimeFormat();
  void syncMeasuredHeight();
});

onUnmounted(() => {
  unsubHostInvoke?.();
  unsubHostInvoke = null;
  resizeObserver?.disconnect();
  resizeObserver = null;
  mutationObserver?.disconnect();
  mutationObserver = null;
  observedHeightTarget = null;
  if (pendingHeightFrame !== null) {
    window.cancelAnimationFrame(pendingHeightFrame);
    pendingHeightFrame = null;
  }
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
.chip--timestamp { --chip-hue: 260; }
.chip--date { --chip-hue: 350; }

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
