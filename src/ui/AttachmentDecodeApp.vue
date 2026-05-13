<template>
  <div class="decode-shell">
    <div
      v-if="payload"
      class="decode-panel"
      :class="`decode-panel--${encoding}`"
    >
      <!-- Row: always visible -->
      <div class="decode-row" @click="onToggle">
        <span class="chip" :class="`chip--${encoding}`">{{ encodingLabel }}</span>

        <span class="preview" :title="previewText">{{ previewText }}</span>

        <!-- Inline copy -->
        <button
          type="button"
          class="icon-btn"
          :aria-label="copied ? 'Copied' : 'Copy decoded'"
          @click.stop="onCopy"
        >
          <!-- Check icon -->
          <svg v-if="copied" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <!-- Copy icon -->
          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>

        <!-- Chevron toggle -->
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

      <!-- Expanded code block -->
      <pre
        v-if="expanded"
        class="code"
        v-html="renderedDecoded"
      />
    </div>

    <p v-else class="decode-empty">No decoded payload available.</p>

    <!-- Accessibility live region -->
    <span aria-live="polite" class="sr-only">{{ copied ? "Copied" : "" }}</span>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { pasty } from "@pasty/plugin-sdk/ui";
import { usePluginAttachmentSession } from "./composables/usePluginAttachmentSession";
import { highlightJson } from "./shared/jsonHighlight.js";

const ENCODING_LABELS = {
  jwt: "JWT",
  escaped_json: "Escaped JSON",
  url: "URL",
  base64: "Base64"
};

const MIN_HEIGHT = 60;
const MAX_HEIGHT = 480;

const { payload } = usePluginAttachmentSession();

const localExpanded = ref(false);
const copied = ref(false);

watch(
  () => payload.value?.expanded,
  (val) => {
    if (typeof val === "boolean") localExpanded.value = val;
  },
  { immediate: true }
);

const expanded = computed(() => localExpanded.value);
const encoding = computed(() => payload.value?.encoding ?? "");
const encodingLabel = computed(() => ENCODING_LABELS[encoding.value] || encoding.value);

// Preview: flatten whitespace, ellipsis via CSS
const previewText = computed(() => {
  const t = payload.value?.decoded ?? "";
  return t.replace(/\s+/g, " ").trim();
});

// Highlighted or plain-escaped decoded content
const renderedDecoded = computed(() => {
  const text = payload.value?.decoded ?? "";
  const isJson =
    payload.value?.encoding === "jwt" || payload.value?.decodedIsJSON === true;
  if (isJson) return highlightJson(text);
  return text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
});

// --- Copy ---
async function onCopy() {
  if (!payload.value) return;
  try {
    await navigator.clipboard.writeText(payload.value.decoded);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 1200);
  } catch {
    /* swallow: clipboard permission denied etc. */
  }
}

// --- Toggle expand (webview-initiated) ---
async function onToggle() {
  const next = !localExpanded.value;
  localExpanded.value = next;

  const current = pasty.item.attachment.current();
  if (!current) return;
  let parsed;
  try {
    parsed = JSON.parse(current.payloadJson || "{}");
  } catch {
    return;
  }
  parsed.expanded = next;
  try {
    await pasty.item.setAttachments({
      attachments: [
        {
          attachmentType: current.attachmentType,
          attachmentKey: current.attachmentKey,
          payloadJson: JSON.stringify(parsed),
          attachmentSyncScope: "syncable"
        }
      ]
    });
  } catch (e) {
    if (typeof console !== "undefined") {
      console.warn("[decode-renderer] setAttachments failed:", e);
    }
  }
}

// --- Host-initiated toggle ---
// The native button click runs runtime.invokeOperation which calls
// setAttachments → payload.expanded eventually echoes back through the watcher.
// We anticipate the new value (derived from current payload, not local state)
// for immediate UI response without depending on round-trip timing. If the
// echo arrives later with the same value, the watcher assignment is a no-op
// (Vue ref skips identical primitive writes), so no double-flip risk.
function handleHostAction(detail) {
  if (detail?.actionID !== "toggle-expand") return;
  const current = payload.value?.expanded === true;
  localExpanded.value = !current;
}

// --- AutoFit ---
let disposeAutoFit = null;
let unsubHostInvoke = null;

async function attachAutoFitIfReady() {
  if (disposeAutoFit || !payload.value) return;
  await nextTick();
  const target = document.querySelector(".decode-panel");
  if (!target) return;
  try {
    disposeAutoFit = pasty.window.autoFit({
      min: MIN_HEIGHT,
      max: MAX_HEIGHT,
      target
    });
  } catch (error) {
    if (typeof console !== "undefined") {
      console.warn("[decode-renderer] autoFit failed:", error);
    }
  }
}

onMounted(() => {
  unsubHostInvoke = pasty.item.attachment.onHostInvoke(handleHostAction);
  watch(payload, attachAutoFitIfReady, { immediate: true });
});

onBeforeUnmount(() => {
  if (typeof unsubHostInvoke === "function") {
    unsubHostInvoke();
    unsubHostInvoke = null;
  }
  if (typeof disposeAutoFit === "function") {
    disposeAutoFit();
    disposeAutoFit = null;
  }
});
</script>

<!--
  Global: jh-* spans are injected via v-html and won't match scoped selectors.
  Two palettes — dark (default) and light (via prefers-color-scheme). Colors
  are fixed (independent of host accent/success/warning tokens) so JSON tokens
  read consistently regardless of which theme color the host happens to use.
-->
<style>
.jh-key    { color: oklch(0.82 0.18 145); }
.jh-string { color: oklch(0.92 0.04 80);  }
.jh-number { color: oklch(0.78 0.15 50);  }
.jh-bool   { color: oklch(0.75 0.15 230); }
.jh-null   { color: oklch(0.70 0.15 25);  }
.jh-punct  { color: oklch(0.55 0.02 250); }

@media (prefers-color-scheme: light) {
  .jh-key    { color: oklch(0.45 0.18 145); }
  .jh-string { color: oklch(0.40 0.05 80);  }
  .jh-number { color: oklch(0.55 0.18 50);  }
  .jh-bool   { color: oklch(0.45 0.20 230); }
  .jh-null   { color: oklch(0.50 0.18 25);  }
  .jh-punct  { color: oklch(0.55 0.02 250); }
}
</style>

<style scoped>
/* Outer shell: transparent so host theme shows through */
.decode-shell {
  background: transparent;
  padding: 0;
  margin: 0;
}

/* Panel — no own border/padding; native card already provides the frame */
.decode-panel {
  background: transparent;
  margin: 0;
}

/* Row: always visible */
.decode-row {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  height: 32px;
  min-height: 32px;
  user-select: none;
}

/* Chip — fixed oklch family, only hue varies per encoding */
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
  color:      oklch(0.92 0.18 var(--chip-hue));
}
.chip--jwt          { --chip-hue: 290; }
.chip--escaped_json { --chip-hue: 145; }
.chip--url          { --chip-hue: 220; }
.chip--base64       { --chip-hue: 30;  }

/* Preview text — uses host theme secondary text token */
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

/* Icon buttons — uses host tertiary text + divider for hover */
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

/* Chevron rotation for expanded state */
.chevron-rotated {
  transform: rotate(180deg);
  transition: transform 0.15s;
}

/* Expanded code block — uses host surface token for background */
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

/* Empty state */
.decode-empty {
  margin: 0;
  padding: 8px 4px;
  font-size: 12px;
  color: var(--pasty-text-tertiary, inherit);
}

/* Accessibility: visually hidden live region */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
