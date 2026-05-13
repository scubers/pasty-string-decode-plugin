<template>
  <main class="decode-shell">
    <template v-if="payload">
      <header class="decode-header">
        <span
          class="decode-badge"
          :class="`decode-badge--${payload.encoding}`"
        >{{ encodingLabel }}</span>
        <span class="decode-sizes" aria-hidden="true">
          {{ payload.originalLength }} → {{ payload.decodedLength }}
        </span>
      </header>

      <section
        class="decode-body"
        :class="{ 'decode-body--compact': !isExpanded }"
      >
        <template v-if="payload.encoding === 'jwt' && payload.jwt">
          <div class="decode-section">
            <p class="decode-section-label">Header</p>
            <pre class="decode-code">{{ headerPretty }}</pre>
          </div>
          <div class="decode-section">
            <p class="decode-section-label">Payload</p>
            <pre class="decode-code">{{ payloadPretty }}</pre>
          </div>
        </template>
        <template v-else>
          <pre class="decode-code">{{ bodyText }}</pre>
        </template>
        <div
          v-if="!isExpanded"
          class="decode-body__fade"
          aria-hidden="true"
        />
      </section>
    </template>

    <p v-else class="decode-empty">No decoded payload available.</p>
  </main>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { pasty } from "@pasty/plugin-sdk/ui";
import { usePluginAttachmentSession } from "./composables/usePluginAttachmentSession";

const ENCODING_LABELS = {
  jwt: "JWT",
  escaped_json: "Escaped JSON",
  url: "URL",
  base64: "Base64"
};

const MIN_HEIGHT = 60;
const MAX_HEIGHT = 480;

const { payload } = usePluginAttachmentSession();

// Local UI state for compact/expanded. Initialized from payload.expanded
// (so a freshly-bootstrapped attachment that already has expanded=true
// renders correctly), then driven directly by the host's renderer-action
// event. This decouples the UI from the round-trip through runtime
// invokeOperation → setAttachments → host broadcast, which some host
// versions don't push back to the same webview.
const localExpanded = ref(false);
const isExpanded = computed(() => localExpanded.value);

watch(
  () => payload.value?.expanded,
  (val) => {
    if (typeof val === "boolean") localExpanded.value = val;
  },
  { immediate: true }
);

const encodingLabel = computed(
  () => ENCODING_LABELS[payload.value?.encoding] || ""
);

function safeStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

const headerPretty = computed(() => safeStringify(payload.value?.jwt?.header ?? null));
const payloadPretty = computed(() => safeStringify(payload.value?.jwt?.payload ?? null));
const bodyText = computed(() => payload.value?.decoded ?? "");

let disposeAutoFit = null;
let unsubHostInvoke = null;

// AutoFit must observe an inner content element (NOT document.body): some
// hosts size body to the viewport (height: 100%), pinning body.scrollHeight
// to the viewport height even when content overflows. We observe the
// .decode-shell <main> so growth AND shrink are tracked. The element is
// rendered with v-if="payload" so we have to wait until payload arrives.
async function attachAutoFitIfReady() {
  if (disposeAutoFit || !payload.value) return;
  await nextTick();
  const target = document.querySelector(".decode-shell");
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

// Host-initiated button clicks fire `pasty-plugin-renderer-action` which the
// SDK turns into this stream. Handle `toggle-expand` directly in the webview
// so the layout flip is instant and doesn't depend on the runtime's
// setAttachments round-trip making it back to this WebView.
async function handleHostAction(detail) {
  if (detail?.actionID !== "toggle-expand") return;
  const next = !localExpanded.value;
  localExpanded.value = next;

  // Persist back into the attachment so the host can re-fetch
  // resolveAttachment and flip the native button title between
  // "Show More" / "Show Less". Best-effort: if the host's setAttachments
  // bridge isn't available (e.g. dev preview), the content still toggles.
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
  } catch (error) {
    if (typeof console !== "undefined") {
      console.warn("[decode-renderer] setAttachments failed:", error);
    }
  }
}

onMounted(() => {
  unsubHostInvoke = pasty.item.attachment.onHostInvoke(handleHostAction);
  // Attach autoFit when the payload first becomes truthy (the wrapping
  // element only exists at that point).
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

<style scoped>
.decode-shell {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 4px;
  color: var(--pasty-text-primary, #0f172a);
  background: transparent;
}

.decode-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 4px 8px;
  border-bottom: 1px solid var(--pasty-divider, rgba(148, 163, 184, 0.24));
}

.decode-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--pasty-accent-contrast, #ffffff);
  background: var(--pasty-accent, #2563eb);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.08);
}

.decode-sizes {
  font-size: 11px;
  color: var(--pasty-text-tertiary, #64748b);
  font-variant-numeric: tabular-nums;
}

.decode-body {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px;
}

.decode-body--compact {
  max-height: 120px;
  overflow: hidden;
}

.decode-body__fade {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 48px;
  pointer-events: none;
  background: linear-gradient(
    to bottom,
    transparent,
    var(--pasty-surface, rgba(255, 255, 255, 0.96))
  );
}

.decode-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-left: 8px;
  border-left: 2px solid var(--pasty-accent, #2563eb);
}

.decode-section-label {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--pasty-text-tertiary, #64748b);
}

.decode-section-label::before {
  content: "";
  display: inline-block;
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: var(--pasty-accent, #2563eb);
}

.decode-code {
  margin: 0;
  padding: 0;
  font-family: "SF Mono", "Menlo", "Consolas", "Liberation Mono", monospace;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--pasty-text-primary, #0f172a);
}

.decode-empty {
  margin: 0;
  padding: 8px 4px;
  font-size: 12px;
  color: var(--pasty-text-tertiary, #64748b);
}
</style>
