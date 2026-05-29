<template>
  <div ref="rootEl" class="ie-shell">
    <p v-if="errorMsg" class="ie-error">{{ errorMsg }}</p>

    <!-- 图片 + 裁剪框（仅拖拽设定选区） -->
    <div v-if="previewUrl" class="ie-stage">
      <img
        ref="imgEl"
        class="ie-img"
        :src="previewUrl"
        alt=""
        draggable="false"
        @load="onImageLoad"
        @error="onImageError"
      />
      <div
        v-if="box && displayWidth > 0"
        ref="cropBoxEl"
        class="ie-crop"
        :style="boxStyle"
        @pointerdown="startDrag('move', $event)"
        @pointermove="onDrag"
        @pointerup="endDrag"
        @pointercancel="endDrag"
      >
        <!-- 四角为 L 形角标、四边为透明热区（样式见 CSS） -->
        <span
          v-for="h in HANDLES"
          :key="h"
          class="ie-handle"
          :class="`ie-handle--${h}`"
          @pointerdown.stop="startDrag(h, $event)"
        />
      </div>
    </div>

    <!-- 设置参数：Quality / Crop（只读）/ Output（可编辑·锁裁剪框比例） -->
    <div class="ie-controls">
      <label class="ie-quality">
        <span class="ie-row-label">Quality</span>
        <input
          v-model.number="quality"
          class="ie-slider"
          type="range"
          min="1"
          max="100"
          step="1"
          :style="{ '--ie-pct': quality + '%' }"
        />
        <span class="ie-quality-value">{{ quality }}%</span>
      </label>
      <p v-if="formatNote" class="ie-format-note">{{ formatNote }}</p>

      <template v-if="cropOriginal">
        <!-- Crop：只读读数（仅靠拖拽改变） -->
        <div class="ie-readout-row">
          <span class="ie-row-label">Crop</span>
          <span class="ie-crop-size">{{ cropOriginal.width }} × {{ cropOriginal.height }} px</span>
          <span class="ie-ratio">{{ ratioLabel }}</span>
        </div>

        <!-- Output：压缩分辨率，等比缩小、≤ 裁剪框 -->
        <div class="ie-readout-row">
          <span class="ie-row-label">Output</span>
          <label class="ie-dim-field">
            <span class="ie-dim-unit">W</span>
            <input
              v-model="resWInput"
              class="ie-dim-input"
              type="number"
              min="1"
              :max="cropOriginal.width"
              step="1"
              inputmode="numeric"
              @input="applyResW"
              @focus="onResFocus"
              @blur="onResBlur"
              @keyup.enter="blurOnEnter"
            />
          </label>

          <span class="ie-dims-sep">×</span>

          <label class="ie-dim-field">
            <span class="ie-dim-unit">H</span>
            <input
              v-model="resHInput"
              class="ie-dim-input"
              type="number"
              min="1"
              :max="cropOriginal.height"
              step="1"
              inputmode="numeric"
              @input="applyResH"
              @focus="onResFocus"
              @blur="onResBlur"
              @keyup.enter="blurOnEnter"
            />
          </label>

          <span class="ie-dim-suffix">px</span>
          <span class="ie-scale-pct">{{ scalePercent }}%</span>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { pasty } from "@pasty/plugin-sdk/ui";
import { autoFit } from "@pasty/plugin-sdk/dom";
import { PROCESS_IMAGE, type ImageEditDraft, type ProcessImageReq, type ProcessImageResp } from "./contracts";
import {
  applyDrag,
  aspectRatioLabel,
  displayBoxToCrop,
  parseDimInput,
  resolutionFromScale,
  scaleFromDim,
  type Box,
  type DragMode,
} from "./cropGeometry";

const MIN_SIZE = 16; // minimum crop side when dragging, display px
const HANDLES: DragMode[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const AUTO_FIT_MIN = 120;
const AUTO_FIT_MAX = 560;

const rootEl = ref<HTMLElement | null>(null);
const imgEl = ref<HTMLImageElement | null>(null);
const cropBoxEl = ref<HTMLElement | null>(null);

const previewUrl = ref<string>("");
const errorMsg = ref<string>("");
const origWidth = ref<number>(0);
const origHeight = ref<number>(0);
const format = ref<string>("");
const quality = ref<number>(80);
const busy = ref<boolean>(false);

const displayWidth = ref<number>(0);
const displayHeight = ref<number>(0);
const box = ref<Box | null>(null);

const dragMode = ref<DragMode | null>(null);
let dragStart: { px: number; py: number; box: Box } | null = null;

// Crop rect in ORIGINAL image pixels — set only by dragging the box.
const cropOriginal = computed(() => {
  if (!box.value || displayWidth.value <= 0 || origWidth.value <= 0) return null;
  return displayBoxToCrop(box.value, displayWidth.value, origWidth.value);
});

const ratioLabel = computed(() =>
  cropOriginal.value ? aspectRatioLabel(cropOriginal.value.width, cropOriginal.value.height) : "—",
);

// Compression resolution is stored as a SCALE of the crop (∈ (0,1], default 1 =
// 100% = no downscale). Storing the proportion — not absolute pixels — is what
// keeps the chosen size stable when the crop box is later resized, and the
// crop-locked aspect ratio means W and H move together. Output never exceeds the
// crop (scale ≤ 1).
const scale = ref<number>(1);
const resolution = computed(() => {
  const c = cropOriginal.value;
  return c ? resolutionFromScale(c, scale.value) : null;
});
const scalePercent = computed(() => Math.round(scale.value * 100));

// W/H inputs use local draft values. editingRes marks "user is typing": while
// set, the watch below doesn't refill (so deleting a digit isn't fought by the
// old value). In the non-editing state (crop drag / blur) the canonical, rounded
// resolution is synced back in. Vue casts <input type="number"> to number even
// without .number, so the draft is string | number — parseDimInput tolerates both.
const resWInput = ref<string | number>("");
const resHInput = ref<string | number>("");
const editingRes = ref<boolean>(false);

watch(
  resolution,
  (r) => {
    if (!r || editingRes.value) return;
    resWInput.value = String(r.width);
    resHInput.value = String(r.height);
  },
  { immediate: true },
);

// Editing W sets the scale from the typed width, then mirrors the linked H field.
// W/H are aspect-locked, so the other field must update live — but the watch is
// suppressed while editing, so write it here explicitly. minScale/clamping live
// in scaleFromDim (≤ crop, ≥ 1px).
function applyResW(): void {
  const c = cropOriginal.value;
  const v = parseDimInput(resWInput.value);
  if (!c || v === null) return;
  scale.value = scaleFromDim(v, c.width);
  resHInput.value = String(resolution.value?.height ?? "");
}

function applyResH(): void {
  const c = cropOriginal.value;
  const v = parseDimInput(resHInput.value);
  if (!c || v === null) return;
  scale.value = scaleFromDim(v, c.height);
  resWInput.value = String(resolution.value?.width ?? "");
}

function onResFocus(): void {
  editingRes.value = true;
}

// Blur: leave editing mode and refill both fields with the clamped, rounded
// resolution, correcting out-of-range / empty input.
function onResBlur(): void {
  editingRes.value = false;
  const r = resolution.value;
  if (r) {
    resWInput.value = String(r.width);
    resHInput.value = String(r.height);
  }
}

function blurOnEnter(e: KeyboardEvent): void {
  (e.target as HTMLInputElement).blur();
}

const boxStyle = computed(() =>
  box.value
    ? {
        left: `${box.value.x}px`,
        top: `${box.value.y}px`,
        width: `${box.value.width}px`,
        height: `${box.value.height}px`,
      }
    : {},
);

const formatNote = computed(() => {
  const f = (format.value || "").toLowerCase();
  if (f === "png") return "PNG: quality maps to palette quantization (lossless — lower = smaller)";
  if (f === "jpeg" || f === "jpg") return "JPEG: quality is the lossy compression level";
  if (f === "webp") return "WebP: quality is the lossy compression level";
  if (f) return "Re-encoded as lossless PNG (quality has no visible effect)";
  return "";
});

function applyDraft(raw: Record<string, unknown> | undefined): void {
  if (!raw) return;
  const d = raw as Partial<ImageEditDraft>;
  if (typeof d.origWidth === "number" && d.origWidth > 0) origWidth.value = d.origWidth;
  if (typeof d.origHeight === "number" && d.origHeight > 0) origHeight.value = d.origHeight;
  if (typeof d.format === "string") format.value = d.format;
  if (typeof d.quality === "number") quality.value = Math.min(100, Math.max(1, Math.round(d.quality)));
}

function fullBox(): Box {
  return { x: 0, y: 0, width: displayWidth.value, height: displayHeight.value };
}

// (Re)measure the rendered image and keep the crop box aligned across resizes.
function remeasure(): void {
  const el = imgEl.value;
  if (!el) return;
  const w = el.clientWidth;
  const h = el.clientHeight;
  if (w <= 0 || h <= 0) return;
  // The asset URL serves the full-resolution original, so naturalWidth equals
  // the original pixel width — a safe fallback if the draft didn't carry dims.
  if (origWidth.value <= 0 && el.naturalWidth > 0) {
    origWidth.value = el.naturalWidth;
    origHeight.value = el.naturalHeight;
  }
  const prevW = displayWidth.value;
  if (box.value && prevW > 0 && w !== prevW) {
    const f = w / prevW;
    box.value = {
      x: box.value.x * f,
      y: box.value.y * f,
      width: box.value.width * f,
      height: box.value.height * f,
    };
    // If a drag is mid-flight, rescale its captured anchor to the new display
    // size so the next pointermove doesn't snap (the start box was recorded in
    // pre-resize display pixels).
    if (dragStart) {
      dragStart = {
        px: dragStart.px,
        py: dragStart.py,
        box: {
          x: dragStart.box.x * f,
          y: dragStart.box.y * f,
          width: dragStart.box.width * f,
          height: dragStart.box.height * f,
        },
      };
    }
  }
  displayWidth.value = w;
  displayHeight.value = h;
  if (!box.value) box.value = fullBox();
}

function onImageLoad(): void {
  remeasure();
}

function onImageError(): void {
  errorMsg.value = "Failed to load image preview.";
}

function startDrag(mode: DragMode, e: PointerEvent): void {
  if (!box.value || !cropBoxEl.value) return;
  dragMode.value = mode;
  dragStart = { px: e.clientX, py: e.clientY, box: { ...box.value } };
  try {
    cropBoxEl.value.setPointerCapture(e.pointerId);
  } catch {
    /* capture is best-effort */
  }
  e.preventDefault();
}

function onDrag(e: PointerEvent): void {
  if (!dragMode.value || !dragStart) return;
  const dx = e.clientX - dragStart.px;
  const dy = e.clientY - dragStart.py;
  box.value = applyDrag(dragStart.box, dragMode.value, dx, dy, displayWidth.value, displayHeight.value, MIN_SIZE);
}

function endDrag(e: PointerEvent): void {
  dragMode.value = null;
  dragStart = null;
  try {
    cropBoxEl.value?.releasePointerCapture(e.pointerId);
  } catch {
    /* noop */
  }
}

async function loadPreview(): Promise<void> {
  try {
    const { url } = await pasty.asset.currentItemImageUrl();
    if (url) previewUrl.value = url;
    else errorMsg.value = "This item isn't an image and can't be edited.";
  } catch {
    errorMsg.value = "Couldn't load the image preview.";
  }
}

async function setApplyButton(title: string, isEnabled: boolean): Promise<void> {
  try {
    await pasty.action.setButtons({ buttons: [{ id: "apply", title, isEnabled }] });
  } catch {
    // Local preview workbench has no host bridge.
  }
}

async function apply(): Promise<void> {
  if (busy.value) return;
  const crop = cropOriginal.value;
  if (!crop || crop.width < 1 || crop.height < 1) {
    errorMsg.value = "Select a valid crop region first.";
    return;
  }
  busy.value = true;
  errorMsg.value = "";
  await setApplyButton("Processing…", false);
  try {
    // Only send resize when the output differs from the crop; at 100% the
    // runtime skips the resampling no-op.
    const res = resolution.value;
    const payload: ProcessImageReq = { quality: quality.value, crop };
    if (res && (res.width !== crop.width || res.height !== crop.height)) {
      payload.resize = res;
    }
    const resp = await pasty.runtime.invoke<ProcessImageResp>({
      key: PROCESS_IMAGE,
      payload,
      timeoutMs: 60_000,
    });
    await pasty.action.complete({
      result: {
        resultKind: "image",
        imageTempPath: resp.imageTempPath,
        imageFormatHint: resp.imageFormatHint,
      },
      userMessage: "Cropped & compressed",
    });
    // Success is terminal: complete() ends the action session and the host
    // tears down this WebView, so we deliberately leave `busy` set (no reset).
  } catch (err) {
    errorMsg.value = `Processing failed: ${err instanceof Error ? err.message : String(err)}`;
    busy.value = false;
    await setApplyButton("Apply", true);
  }
}

let unsubDraft: (() => void) | null = null;
let unsubHostInvoke: (() => void) | null = null;
let disconnectAutoFit: (() => void) | null = null;
let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  applyDraft(pasty.action.draft.current());
  unsubDraft = pasty.action.draft.on(applyDraft);
  unsubHostInvoke = pasty.action.onHostInvoke.on((payload) => {
    if (payload.buttonID === "apply") void apply();
  });
  void loadPreview();
  if (rootEl.value) {
    disconnectAutoFit = autoFit({ min: AUTO_FIT_MIN, max: AUTO_FIT_MAX, target: rootEl.value });
  }
  if (imgEl.value && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => remeasure());
    resizeObserver.observe(imgEl.value);
  }
});

onUnmounted(() => {
  unsubDraft?.();
  unsubDraft = null;
  unsubHostInvoke?.();
  unsubHostInvoke = null;
  disconnectAutoFit?.();
  disconnectAutoFit = null;
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<style scoped>
/* ===== 根容器（透明，融入宿主原生背景）===== */
.ie-shell {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 0;
  background: transparent;
  -webkit-font-smoothing: antialiased;
}

.ie-error {
  margin: 0;
  padding: 6px 10px;
  font-size: 11.5px;
  line-height: 1.4;
  color: var(--pasty-danger, #e53e3e);
  background: color-mix(in srgb, var(--pasty-danger, #e53e3e) 10%, transparent);
  border: 0.5px solid color-mix(in srgb, var(--pasty-danger, #e53e3e) 30%, transparent);
  border-radius: 6px;
}

/* ===== 图片 + 裁剪框（上方）===== */
.ie-stage {
  position: relative;
  align-self: center;
  max-width: 100%;
  line-height: 0;
  border-radius: 5px;
  /* 把裁剪框的四周遮罩裁进图片内，不让它外溢到下方控制区 */
  overflow: hidden;
}

.ie-img {
  display: block;
  max-width: 100%;
  max-height: 52vh;
  width: auto;
  height: auto;
  user-select: none;
  -webkit-user-drag: none;
}

/*
  裁剪框：极细双线描边（内层 accent 半透明 + 外层白色半透明 outline），让图片成为
  主角；在明、暗主题下都清晰。变暗遮罩用 box-shadow 实现，被 stage 的 overflow:hidden
  裁进图片内。
*/
.ie-crop {
  position: absolute;
  box-sizing: border-box;
  border: 1px solid color-mix(in srgb, var(--pasty-accent, #3b82f6) 70%, transparent);
  outline: 0.5px solid rgba(255, 255, 255, 0.35);
  outline-offset: -0.5px;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.38);
  cursor: move;
  touch-action: none;
}

/*
  Handle：四角为 L 形角标（::before/::after 两条细臂），四边为透明热区（无视觉噪音）；
  全部贴框内侧定位 —— 既避免被 overflow:hidden 裁掉，又比实心方块克制。
*/
.ie-handle {
  position: absolute;
  --hc: var(--pasty-accent, #3b82f6); /* 角标颜色 */
  --hw: 2px; /* 角标线宽 */
  --hl: 10px; /* 角标臂长 */
  background: transparent;
  touch-action: none;
}

.ie-handle:hover {
  --hc: color-mix(in srgb, var(--pasty-accent, #3b82f6) 80%, #fff);
}

/* 四角：16px 触控热区，用 before/after 画 L 形角标 */
.ie-handle--nw,
.ie-handle--ne,
.ie-handle--sw,
.ie-handle--se {
  width: 16px;
  height: 16px;
}

.ie-handle--nw::before,
.ie-handle--nw::after,
.ie-handle--ne::before,
.ie-handle--ne::after,
.ie-handle--sw::before,
.ie-handle--sw::after,
.ie-handle--se::before,
.ie-handle--se::after {
  content: "";
  position: absolute;
  background: var(--hc);
  border-radius: 1px;
}

.ie-handle--nw { top: 0; left: 0; cursor: nwse-resize; }
.ie-handle--nw::before { top: 0; left: 0; width: var(--hw); height: var(--hl); }
.ie-handle--nw::after  { top: 0; left: 0; width: var(--hl); height: var(--hw); }

.ie-handle--ne { top: 0; right: 0; cursor: nesw-resize; }
.ie-handle--ne::before { top: 0; right: 0; width: var(--hw); height: var(--hl); }
.ie-handle--ne::after  { top: 0; right: 0; width: var(--hl); height: var(--hw); }

.ie-handle--sw { bottom: 0; left: 0; cursor: nesw-resize; }
.ie-handle--sw::before { bottom: 0; left: 0; width: var(--hw); height: var(--hl); }
.ie-handle--sw::after  { bottom: 0; left: 0; width: var(--hl); height: var(--hw); }

.ie-handle--se { bottom: 0; right: 0; cursor: nwse-resize; }
.ie-handle--se::before { bottom: 0; right: 0; width: var(--hw); height: var(--hl); }
.ie-handle--se::after  { bottom: 0; right: 0; width: var(--hl); height: var(--hw); }

/* 四边：仅透明热区，居中贴边 */
.ie-handle--n { top: 0; left: 50%; transform: translateX(-50%); width: 40%; height: 12px; cursor: ns-resize; }
.ie-handle--s { bottom: 0; left: 50%; transform: translateX(-50%); width: 40%; height: 12px; cursor: ns-resize; }
.ie-handle--e { right: 0; top: 50%; transform: translateY(-50%); width: 12px; height: 40%; cursor: ew-resize; }
.ie-handle--w { left: 0; top: 50%; transform: translateY(-50%); width: 12px; height: 40%; cursor: ew-resize; }

/* ===== 控制区（图片下方：Quality / Crop / Output）===== */
.ie-controls {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 三个参数共用的左侧标签列，宽度对齐 */
.ie-row-label {
  flex-shrink: 0;
  width: 48px;
  white-space: nowrap;
  font-size: 11.5px;
  letter-spacing: 0.01em;
  color: var(--pasty-text-secondary, inherit);
}

.ie-quality {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.ie-quality-value {
  flex-shrink: 0;
  width: 36px;
  text-align: right;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
  color: var(--pasty-text-primary, inherit);
}

/* 自定义滑块：细 track + 白圆点 thumb，已填充段用 native accent 色 */
.ie-slider {
  flex: 1;
  min-width: 0;
  height: 16px;
  margin: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
}

.ie-slider:focus {
  outline: none;
}

.ie-slider::-webkit-slider-runnable-track {
  height: 3px;
  border-radius: 999px;
  background: linear-gradient(
    to right,
    var(--pasty-accent, #3b82f6) 0 var(--ie-pct, 80%),
    var(--pasty-divider, rgba(127, 127, 127, 0.18)) var(--ie-pct, 80%) 100%
  );
}

.ie-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 13px;
  height: 13px;
  margin-top: -5px;
  border-radius: 50%;
  background: #fff;
  border: 0.5px solid rgba(0, 0, 0, 0.1);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.25),
    0 0 0 0.5px rgba(0, 0, 0, 0.06);
  transition: box-shadow 0.12s ease;
}

.ie-slider:hover::-webkit-slider-thumb {
  box-shadow:
    0 1px 4px rgba(0, 0, 0, 0.28),
    0 0 0 0.5px rgba(0, 0, 0, 0.08);
}

.ie-slider:focus-visible::-webkit-slider-thumb {
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.2),
    0 0 0 3px color-mix(in srgb, var(--pasty-accent, #3b82f6) 30%, transparent);
}

.ie-slider::-moz-range-track {
  height: 3px;
  border-radius: 999px;
  background: var(--pasty-divider, rgba(127, 127, 127, 0.18));
}

.ie-slider::-moz-range-progress {
  height: 3px;
  border-radius: 999px;
  background: var(--pasty-accent, #3b82f6);
}

.ie-slider::-moz-range-thumb {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #fff;
  border: 0.5px solid rgba(0, 0, 0, 0.1);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
}

.ie-format-note {
  margin: 0;
  font-size: 10.5px;
  line-height: 1.45;
  letter-spacing: 0.005em;
  color: var(--pasty-text-tertiary, #94a3b8);
}

/* ===== Crop / Output 行 ===== */
.ie-readout-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 裁剪只读尺寸读数 */
.ie-crop-size {
  font-family: "SF Mono", "Menlo", "Consolas", ui-monospace, monospace;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
  color: var(--pasty-text-primary, inherit);
}

/* 缩放百分比（Output 行尾，靠右） */
.ie-scale-pct {
  margin-left: auto;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  color: var(--pasty-text-tertiary, #94a3b8);
  user-select: none;
}

/* 宽 / 高输入字段 */
.ie-dim-field {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px 2px 5px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--pasty-surface, #808080) 8%, transparent);
  border: 0.5px solid var(--pasty-border, rgba(128, 128, 128, 0.2));
  cursor: text;
  transition:
    border-color 0.1s ease,
    background 0.1s ease;
}

.ie-dim-field:focus-within {
  border-color: color-mix(in srgb, var(--pasty-accent, #3b82f6) 60%, transparent);
  background: color-mix(in srgb, var(--pasty-accent, #3b82f6) 6%, transparent);
}

.ie-dim-unit {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--pasty-text-tertiary, #94a3b8);
  user-select: none;
  transition: color 0.1s ease;
}

.ie-dim-field:focus-within .ie-dim-unit {
  color: var(--pasty-accent, #3b82f6);
}

.ie-dim-input {
  width: 44px;
  padding: 0;
  border: none;
  background: transparent;
  font-family: "SF Mono", "Menlo", "Consolas", ui-monospace, monospace;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  text-align: right;
  color: var(--pasty-text-primary, inherit);
  outline: none;
  -webkit-appearance: none;
  -moz-appearance: textfield;
  appearance: textfield;
}

.ie-dim-input::-webkit-inner-spin-button,
.ie-dim-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.ie-dim-suffix {
  font-size: 10px;
  letter-spacing: 0.02em;
  color: var(--pasty-text-tertiary, #94a3b8);
  user-select: none;
}

.ie-dims-sep {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--pasty-text-tertiary, #94a3b8);
  user-select: none;
}

/* 比例标签（整数比，如 16:9） */
.ie-ratio {
  margin-left: auto;
  padding: 2px 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--pasty-surface, #808080) 6%, transparent);
  border: 0.5px solid var(--pasty-divider, rgba(128, 128, 128, 0.12));
  font-family: "SF Mono", "Menlo", "Consolas", ui-monospace, monospace;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  color: var(--pasty-text-tertiary, #94a3b8);
  user-select: none;
}
</style>
