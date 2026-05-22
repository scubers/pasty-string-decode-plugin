<template>
  <main class="workbench" :data-theme="selectedTheme">
    <section class="workbench__controls">
      <label class="workbench__control">
        <span>Scenario</span>
        <select v-model="selectedScenarioID">
          <option
            v-for="scenario in attachmentScenarios"
            :key="scenario.id"
            :value="scenario.id"
          >
            {{ scenario.label }}
          </option>
        </select>
      </label>

      <label class="workbench__control">
        <span>Theme</span>
        <select v-model="selectedTheme">
          <option value="dark">Dark Host</option>
          <option value="light">Light Host</option>
        </select>
      </label>
    </section>

    <section class="workbench__canvas">
      <div class="host-frame">
        <div class="host-frame__title">
          <span>Attachment Renderer</span>
          <span>{{ frameSizeLabel }}</span>
        </div>

        <div class="host-frame__surface">
          <div class="host-frame__viewport-shell">
            <div class="host-frame__viewport" :style="viewportStyle">
              <div class="host-frame__webview">
                <DecodeRendererApp :key="componentKey" />
              </div>
            </div>

            <div class="host-frame__chrome">
              <span class="host-frame__chrome-label">Host resize</span>
              <button
                class="host-frame__resize-handle"
                type="button"
                aria-label="Resize host preview viewport"
                @pointerdown="startResize"
              />
            </div>
          </div>

          <div class="host-frame__strip">
            <button
              v-for="button in activeButtons"
              :key="button.id"
              class="host-frame__button"
              type="button"
              :disabled="button.isEnabled === false"
              @click="previewHostButton(button)"
            >
              {{ button.title }}
            </button>
          </div>
        </div>
      </div>

      <aside class="workbench__notes">
        <p class="workbench__notes-title">Preview Notes</p>
        <p class="workbench__notes-body">
          This workbench simulates Pasty attachment bootstrap, host buttons, clipboard, theme, and window height calls.
        </p>
        <p class="workbench__notes-status">{{ statusMessage }}</p>
      </aside>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import DecodeRendererApp from "../features/decode-renderer/app.vue";
import { attachmentScenarios } from "./scenarios/attachmentScenarios";

type ThemeKey = "light" | "dark";

interface HostButton {
  id: string;
  title: string;
  isEnabled?: boolean;
}

interface BridgeFrame {
  method: string;
  payload?: unknown;
}

interface PreviewWebKitWindow extends Window {
  webkit?: {
    messageHandlers?: {
      pastyPluginCall?: {
        postMessage(frame: BridgeFrame): Promise<unknown>;
      };
    };
  };
}

const query = new URLSearchParams(window.location.search);
const selectedTheme = ref<ThemeKey>(query.get("theme") === "light" ? "light" : "dark");
const selectedScenarioID = ref<string>(resolveInitialScenarioID());
const statusMessage = ref<string>("Ready for local UI iteration.");
const activeButtons = ref<HostButton[]>([]);

const viewportSize = reactive({ width: 560, height: 96 });
const minimumViewportSize = { width: 320, height: 60 };

installPreviewBridge();

const activeScenario = computed(() => attachmentScenarios.find(
  (scenario) => scenario.id === selectedScenarioID.value,
) ?? attachmentScenarios[0]);

const componentKey = computed<string>(() => activeScenario.value?.id ?? "unknown");

const viewportStyle = computed(() => ({
  width: `${viewportSize.width}px`,
  height: `${viewportSize.height}px`,
}));

const frameSizeLabel = computed<string>(() => `${viewportSize.width} x ${viewportSize.height}`);

watch(
  [selectedScenarioID, selectedTheme],
  () => {
    applyPreviewState();
    syncQuery();
  },
  { immediate: true },
);

function resolveInitialScenarioID(): string {
  const requestedScenarioID = query.get("scenario");
  return attachmentScenarios.some((scenario) => scenario.id === requestedScenarioID)
    ? (requestedScenarioID as string)
    : attachmentScenarios[0].id;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function dispatchEvent(name: string, detail: unknown): void {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function buildThemeSnapshot(): { scheme: string; tokens: Record<string, string> } {
  const isLight = selectedTheme.value === "light";
  return {
    scheme: selectedTheme.value,
    tokens: {
      surface: isLight ? "#ffffff" : "#111827",
      surfaceElevated: isLight ? "#f8fafc" : "#1f2937",
      textPrimary: isLight ? "#0f172a" : "#f8fafc",
      textSecondary: isLight ? "#475569" : "#cbd5e1",
      textTertiary: isLight ? "#64748b" : "#94a3b8",
      accent: "#2563eb",
      accentContrast: "#ffffff",
      border: isLight ? "rgba(226, 232, 240, 0.9)" : "rgba(148, 163, 184, 0.26)",
      divider: isLight ? "rgba(148, 163, 184, 0.4)" : "rgba(148, 163, 184, 0.22)",
      success: "#16a34a",
      warning: "#f59e0b",
      danger: "#dc2626",
    },
  };
}

function applyPreviewState(): void {
  const scenario = activeScenario.value;
  if (!scenario) {
    return;
  }

  const bootstrap = clone(scenario.bootstrap) as Record<string, unknown>;
  const context = { mode: "attachmentRenderer", pluginID: "plugin.pasty.awesome.decode" };
  const itemPayload = bootstrap.item;
  const attachmentPayload = {
    item: bootstrap.item,
    attachment: bootstrap.attachment,
  };
  const themeSnapshot = buildThemeSnapshot();

  window.__PASTY_PLUGIN_CONTEXT__ = context;
  window.__PASTY_PLUGIN_ITEM__ = itemPayload;
  window.__PASTY_PLUGIN_ATTACHMENT__ = attachmentPayload;
  window.__PASTY_PLUGIN_THEME__ = themeSnapshot;
  window.__PASTY_PLUGIN_DRAFT__ = null;

  dispatchEvent("pasty-plugin-context", context);
  dispatchEvent("pasty-plugin-item", itemPayload);
  dispatchEvent("pasty-plugin-attachment", attachmentPayload);
  dispatchEvent("pasty-plugin-theme", themeSnapshot);

  activeButtons.value = [];
  viewportSize.height = 96;
  statusMessage.value = `Renderer preview loaded: ${scenario.label}`;
}

function syncQuery(): void {
  const next = new URL(window.location.href);
  next.searchParams.set("view", "renderer");
  next.searchParams.set("scenario", selectedScenarioID.value);
  next.searchParams.set("theme", selectedTheme.value);
  window.history.replaceState({}, "", next);
}

function previewHostButton(button: HostButton): void {
  window.dispatchEvent(new CustomEvent("pasty-plugin-attachment-host-invoke", {
    detail: { buttonID: button.id },
  }));
}

function installPreviewBridge(): void {
  const previewWindow = window as PreviewWebKitWindow;
  previewWindow.webkit = {
    messageHandlers: {
      pastyPluginCall: {
        async postMessage(frame: BridgeFrame): Promise<unknown> {
          const payload = frame.payload as Record<string, unknown> | undefined;
          if (frame.method === "attachmentRenderer.setButtons") {
            activeButtons.value = Array.isArray(payload?.buttons)
              ? payload.buttons as HostButton[]
              : [];
            return {};
          }
          if (frame.method === "clipboard.copyText") {
            const text = typeof payload?.text === "string" ? payload.text : "";
            statusMessage.value = `Copied ${text.length} characters`;
            try {
              await navigator.clipboard?.writeText(text);
            } catch {
              // Browser preview may deny clipboard access.
            }
            return {};
          }
          if (frame.method === "window.setHeight") {
            const height = Number(payload?.height);
            if (Number.isFinite(height)) {
              viewportSize.height = Math.max(minimumViewportSize.height, Math.min(480, Math.round(height)));
            }
            return {};
          }
          if (frame.method === "window.autoFit") {
            await nextTick();
            fitViewportToContent();
            return {};
          }
          if (frame.method === "console.log") {
            return {};
          }
          throw new Error(`Unsupported preview bridge method: ${frame.method}`);
        },
      },
    },
  };
}

function fitViewportToContent(): void {
  const webview = document.querySelector(".host-frame__webview") as HTMLElement | null;
  const contentHeight = webview?.scrollHeight ?? viewportSize.height;
  viewportSize.height = Math.max(minimumViewportSize.height, Math.min(480, Math.ceil(contentHeight)));
}

interface ResizeSession {
  startPointerX: number;
  startPointerY: number;
  startWidth: number;
  startHeight: number;
}

let resizeSession: ResizeSession | null = null;

function startResize(event: PointerEvent): void {
  event.preventDefault();
  stopResize();

  resizeSession = {
    startPointerX: event.clientX,
    startPointerY: event.clientY,
    startWidth: viewportSize.width,
    startHeight: viewportSize.height,
  };

  window.addEventListener("pointermove", handleResizePointerMove);
  window.addEventListener("pointerup", stopResize);
  window.addEventListener("pointercancel", stopResize);
}

function stopResize(): void {
  resizeSession = null;
  window.removeEventListener("pointermove", handleResizePointerMove);
  window.removeEventListener("pointerup", stopResize);
  window.removeEventListener("pointercancel", stopResize);
}

function handleResizePointerMove(event: PointerEvent): void {
  if (!resizeSession) {
    return;
  }

  viewportSize.width = Math.max(
    minimumViewportSize.width,
    Math.round(resizeSession.startWidth + (event.clientX - resizeSession.startPointerX)),
  );
  viewportSize.height = Math.max(
    minimumViewportSize.height,
    Math.round(resizeSession.startHeight + (event.clientY - resizeSession.startPointerY)),
  );
}

onBeforeUnmount(() => {
  stopResize();
});
</script>

<style scoped>
.workbench {
  min-height: 100%;
  padding: 24px;
  color: #e2e8f0;
  background: linear-gradient(180deg, #111827, #0f172a);
}

.workbench[data-theme="light"] {
  color: #0f172a;
  background: linear-gradient(180deg, #e2e8f0, #cbd5e1);
}

.workbench__controls {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}

.workbench__control {
  display: grid;
  gap: 6px;
}

.workbench__control span {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(226, 232, 240, 0.72);
}

.workbench[data-theme="light"] .workbench__control span {
  color: rgba(15, 23, 42, 0.62);
}

.workbench__control select {
  min-width: 180px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.26);
  background: rgba(15, 23, 42, 0.48);
  color: inherit;
}

.workbench[data-theme="light"] .workbench__control select {
  background: rgba(255, 255, 255, 0.82);
}

.workbench__canvas {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 260px;
  gap: 20px;
  align-items: start;
}

.host-frame {
  padding: 18px;
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.34);
  border: 1px solid rgba(45, 212, 191, 0.2);
  overflow: auto;
}

.workbench[data-theme="light"] .host-frame {
  background: rgba(248, 250, 252, 0.52);
  border-color: rgba(148, 163, 184, 0.28);
}

.host-frame__title {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  font-size: 12px;
  font-weight: 700;
  color: rgba(226, 232, 240, 0.8);
}

.workbench[data-theme="light"] .host-frame__title {
  color: rgba(15, 23, 42, 0.7);
}

.host-frame__surface,
.host-frame__viewport-shell {
  display: grid;
  gap: 12px;
  justify-items: start;
}

.host-frame__viewport {
  flex: none;
  padding: 12px;
  border-radius: 8px;
  background: var(--pasty-surface, rgba(255, 255, 255, 0.96));
}

.host-frame__webview {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.host-frame__chrome {
  width: 100%;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  padding-right: 4px;
}

.host-frame__chrome-label {
  font-size: 11px;
  font-weight: 700;
  color: rgba(148, 163, 184, 0.88);
}

.host-frame__resize-handle {
  width: 20px;
  height: 20px;
  border: 0;
  padding: 0;
  border-radius: 999px;
  background:
    linear-gradient(135deg, transparent 0 48%, rgba(148, 163, 184, 0.82) 48% 56%, transparent 56% 100%),
    rgba(15, 23, 42, 0.78);
  cursor: nwse-resize;
}

.host-frame__strip {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.host-frame__button {
  appearance: none;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 8px;
  padding: 9px 14px;
  background: rgba(30, 41, 59, 0.54);
  color: #cbd5e1;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.host-frame__button:disabled {
  opacity: 0.55;
  cursor: default;
}

.workbench[data-theme="light"] .host-frame__button {
  background: rgba(255, 255, 255, 0.82);
  color: #334155;
}

.workbench__notes {
  padding: 16px;
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.42);
  border: 1px solid rgba(148, 163, 184, 0.16);
}

.workbench[data-theme="light"] .workbench__notes {
  background: rgba(255, 255, 255, 0.76);
}

.workbench__notes-title {
  margin: 0;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.workbench__notes-body,
.workbench__notes-status {
  margin: 10px 0 0;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(226, 232, 240, 0.78);
}

.workbench[data-theme="light"] .workbench__notes-body,
.workbench[data-theme="light"] .workbench__notes-status {
  color: rgba(15, 23, 42, 0.72);
}

.workbench__notes-status {
  font-weight: 600;
}

@media (max-width: 980px) {
  .workbench__canvas {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
