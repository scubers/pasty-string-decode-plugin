# Draft Action「裁剪与压缩」UI 优化：压缩分辨率解耦 + 英文文案

> 日期：2026-05-29　状态：待批准（brainstorming 产出，待用户复审后进 writing-plans）
>
> 本文是 [`2026-05-29-image-crop-compress-design.md`](./2026-05-29-image-crop-compress-design.md) 的**增量优化设计**。底层生命周期、SDK 事实、sharp/asset 机制、模块边界纪律均沿用原设计，不再重述；本文只描述**改动**。

## 背景与动机

现有实现里，图片下方的宽 / 高输入框通过 `boxFromCropSize` **直接驱动裁剪框大小**——本质是裁剪框的"另一种输入方式"，输出尺寸恒等于裁剪尺寸，质量滑块只管编码。用户认为这种联动没必要。

目标是把功能拆成**三个解耦的设置参数**，并把 W/H 重新定义为"压缩分辨率"：

| 参数 | 控件 | 语义 |
|---|---|---|
| 质量（Quality） | 滑块 1–100 | 编码质量。**沿用现有逻辑，完全不变**（越高越好） |
| 压缩分辨率（Output） | W / H 输入框（**新含义**） | 裁剪选区**等比缩小**到的输出尺寸；锁定裁剪框比例；**≤ 裁剪框像素** |
| 裁剪框大小（Crop） | 图上拖拽（**仅拖拽**） | 选区。不再被 W/H 输入驱动，下方仅显示只读读数 |

> 术语说明：用户口语称该滑块为"压缩率"，但其语义是"越高画质越好 / 文件越大"，与"压缩率"（通常越高压得越狠）相反，故 UI 标签统一用 **Quality**。

## 处理链路（核心变化）

```
extract(裁剪选区, 原图像素)
   → [可选] resize(压缩分辨率 W×H, fit:"fill")     ← 新增步骤
   → 编码(质量, 保留原格式)
```

- 当 **裁剪框 = 整图 且 分辨率 = 100%** 时，链路自然退化为"纯压缩"。
- 当 **分辨率 = 100%（= 裁剪尺寸）** 时，UI **省略 `resize` 字段**，runtime 不做缩放——等价于现有"只裁剪 + 压缩"行为。

## 行为细节（决策已确认）

经 brainstorming 两轮确认（用户均选推荐项）：

1. **压缩分辨率锁定裁剪框比例**（不是独立 W/H，也不是百分比输入）。输出永不被拉伸变形；约束简化为"缩放比例 ≤ 100%"。
2. **拖动裁剪框改变其大小 / 比例后，保持缩放比例**（而非重置或保持绝对像素）。

由此推导的内部模型：

- **分辨率的真相来源是 `scale ∈ (0, 1]`**（相对裁剪框的比例），不是绝对像素。默认 `scale = 1`（100%，不缩放）。这样"保持缩放比例"才成立——绝对像素会随裁剪框变化而漂移，比例不会。
- **用户输入 W**：`scale = clamp(输入, [1, 裁剪W]) / 裁剪W`；H 自动 = `round(裁剪H × scale)`。输入 H 时对称。两框都可编辑、互相联动。
- **拖动裁剪框**（尺寸 / 比例变化）：`scale` 不变，按新裁剪框重算并回填 W/H 像素。沿用现有 `editingDims` 防顶回机制（编辑中不回填，失焦 / 拖拽后才同步）。
- **100% 上限**：UI 把输入夹到 ≤ 裁剪边；runtime `clampResize` 再夹一道。**永不放大**。
- **每边 ≥ 1px**：UI（`resolutionFromScale` 取 `max(1, …)`）与 runtime（`clampResize`）双重保证。
- 因比例锁定在裁剪框上，`resize` 目标的 W:H ≈ 裁剪比例（仅取整误差），用 `fit:"fill"` 精确输出到所填像素、无可见变形，且 **UI 读数 == 实际输出尺寸**。

## 契约改动（`contracts.ts`）

`ProcessImageReq` 新增**可选** `resize` 字段（省略 = 不缩放）。其余契约不变。

```ts
/** UI → runtime request payload for PROCESS_IMAGE. */
export interface ProcessImageReq {
  quality: number;
  crop: CropRect;
  /** Output resolution in ORIGINAL pixels, ≤ crop on each side. Omit = no resize (output == crop). */
  resize?: { width: number; height: number };
}
```

可选字段是向后兼容的关键：现有集成测试不传 `resize`，行为与改动前一致，**无需改动**。

## 纯逻辑改动（`cropGeometry.ts`）

- **删除** `boxFromCropSize`（W/H 不再决定裁剪框）。
- **新增**两个纯函数：

  ```ts
  /** 把一个轴上的目标像素（原图）换算成相对裁剪框该轴的缩放比例 ∈ (0,1]。 */
  export function scaleFromDim(value: number, cropDim: number): number {
    if (!(cropDim > 0)) return 1;
    const clamped = Math.min(Math.max(1, value), cropDim);
    return clamped / cropDim;
  }

  /** 由 scale 算出输出分辨率（原图像素），每边 ∈ [1, crop]。 */
  export function resolutionFromScale(
    crop: { width: number; height: number },
    scale: number,
  ): { width: number; height: number } {
    const clampDim = (d: number) => Math.min(d, Math.max(1, Math.round(d * scale)));
    return { width: clampDim(crop.width), height: clampDim(crop.height) };
  }
  ```

- **保留** `clampBox / applyDrag / displayBoxToCrop / aspectRatioLabel / parseDimInput`、类型 `Box / DragMode`。`parseDimInput` 复用给分辨率输入。

## 运行时改动（`process.ts`）

- **新增**纯函数 `clampResize`（可单测）：

  ```ts
  export function clampResize(
    resize: { width: number; height: number },
    cropW: number,
    cropH: number,
  ): { width: number; height: number } {
    return {
      width: Math.min(Math.max(1, Math.round(resize.width)), cropW),
      height: Math.min(Math.max(1, Math.round(resize.height)), cropH),
    };
  }
  ```

- **`processImage`** 在 `extract` 后、编码前插入可选 resize：

  ```ts
  let pipeline = sharp(srcPath).extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height });
  if (req.resize) {
    const r = clampResize(req.resize, crop.width, crop.height);
    if (r.width !== crop.width || r.height !== crop.height) {
      pipeline = pipeline.resize(r.width, r.height, { fit: "fill" });
    }
  }
  await applyFormat(pipeline, format, quality).toFile(outPath);
  ```

  `fit:"fill"` 输出精确到目标 W×H；因目标比例锁定为裁剪比例，无可见变形。`r == crop` 时跳过 resize，避免无谓重采样。

## UI 改动（`app.vue`）— 布局 A

### 状态与交互

- **删除**：`cropWInput / cropHInput / editingDims / applyDimInput / onDimFocus / onDimBlur`，模板中的裁剪 W/H 输入，及 `boxFromCropSize` import。
- **新增**：
  - `const scale = ref(1)`；
  - `const resolution = computed(() => { const c = cropOriginal.value; return c ? resolutionFromScale(c, scale.value) : null; })`；
  - 分辨率输入草稿 `resWInput / resHInput`（`string | number`）+ `editingRes` 标记，镜像原 `cropWInput` 那套；
  - `watch(resolution, (r) => { if (!r || editingRes.value) return; resWInput.value = String(r.width); resHInput.value = String(r.height); }, { immediate: true })`——**非编辑态**（拖拽改裁剪框 / 失焦后）回填两框；
  - `applyResW()`：`const c=cropOriginal.value; const v=parseDimInput(resWInput.value); if(!c||v===null) return; scale.value = scaleFromDim(v, c.width);` 然后**主动联动写另一框**：`resHInput.value = String(resolution.value?.height ?? "")`（不碰 `resWInput`，用户正在键入它）。`applyResH()` 用 `c.height` 求 scale、写 `resWInput`，对称。
    > 关键：W/H 锁比例，编辑一个框必须实时联动另一个框。但 `editingRes` 会挡住 `watch`，所以**必须在 `applyResW/H` 里手动更新对侧框**，否则键入 W 时 H 不动。失焦后 `watch` 再用规范化（取整）值统一回填两框。
  - `onResFocus/​onResBlur`（失焦用 `resolution` 回填，纠正越界 / 空输入）；复用现有 `blurOnEnter`；
  - 展示用 `scalePercent = computed(() => Math.round(scale.value * 100))`。
- **裁剪只读读数**：直接用 `cropOriginal`（`width × height`）+ `aspectRatioLabel(cropOriginal.width, cropOriginal.height)`，纯文本，不可编辑。
- **`apply()` 提交**：`const needResize = resolution.value && cropOriginal.value && (resolution.value.width !== cropOriginal.value.width || resolution.value.height !== cropOriginal.value.height);` payload 为 `{ quality, crop, resize: needResize ? resolution.value : undefined }`。

### 布局（方案 A：三参数归到图片下方一组）

```
┌────────────────────────────────────┐
│   ░░░┌──────────┐░░░                │  图片 + 裁剪框（拖拽选区，遮罩 / 手柄不变）
│   ░░░│   crop   │░░░◄ handle        │
│   ░░░└──────────┘░░░                │
├────────────────────────────────────┤
│ Quality  ●────────○ 80%             │  质量滑块（移到图片下方，逻辑不变）
│ PNG: quality maps to palette …      │  格式说明（英文）
│ Crop    800 × 600 px · 4:3          │  只读读数
│ Output  [400] × [300] px   50%      │  可编辑·锁比例·≤裁剪框；尾随缩放百分比
└────────────────────────────────────┘
            「Apply」是宿主原生按钮（不在 WebView 内）
```

- `Output` 行的 W/H 复用现有 `.ie-dim-field` 输入样式（含 `W`/`H` 角标、`px` 后缀）。
- `Crop` 行为纯文本读数，与 `Output` 行视觉上区分"只读 vs 可编辑"。

## 页面文案：全部英文（含按钮）

UI 内所有用户可见文案改为英文（沟通仍用中文；本要求只针对插件 UI）。逐条对照：

| 位置 | 现（中文） | 改为（英文） |
|---|---|---|
| 质量滑块标签 | 质量 | `Quality` |
| 裁剪读数标签 | （新增） | `Crop` |
| 分辨率标签 | （新增） | `Output` |
| 格式说明 PNG | PNG：质量调节调色板量化… | `PNG: quality maps to palette quantization (lossless — lower = smaller)` |
| 格式说明 JPEG | JPEG：质量为有损压缩等级 | `JPEG: quality is the lossy compression level` |
| 格式说明 WebP | WebP：质量为有损压缩等级 | `WebP: quality is the lossy compression level` |
| 格式说明 其它 | 该格式将以 PNG 无损输出… | `Re-encoded as lossless PNG (quality has no visible effect)` |
| 错误：非图片 | 当前项目不是图片，无法编辑。 | `This item isn't an image and can't be edited.` |
| 错误：加载失败 | 无法加载图片预览。 | `Couldn't load the image preview.` |
| 错误：img onerror | 图片预览加载失败。 | `Failed to load image preview.` |
| 错误：无有效裁剪 | 请先框选有效的裁剪区域。 | `Select a valid crop region first.` |
| 错误：处理失败 | 处理失败：{msg} | `Processing failed: {msg}` |
| 按钮：处理中 | 处理中… | `Processing…` |
| 按钮：应用 | 应用 | `Apply` |
| 完成提示 userMessage | 已裁剪并压缩 | `Cropped & compressed` |

涉及文件：`app.vue`（滑块标签 / 格式说明 / 错误文案 / `setApplyButton` 的 `Processing…`、`Apply` / `complete` 的 `userMessage`）、`feature.ts`（`resolveSession` seed 按钮 `title: "应用" → "Apply"`，按钮 `id:"apply"` **不变**，`onHostInvoke` 判断不受影响）。

> `manifest.json` 不改：action `title` 已是英文 `Crop & Compress`；`keywords` 含中文"裁剪 / 压缩"是搜索辅助（非展示文案），保留以利中文用户检索。

## 测试改动

- **`tests/runtime/cropGeometry.test.cjs`**：删除 4 个 `boxFromCropSize` 测试；新增
  - `scaleFromDim`：半尺寸→0.5、超裁剪→夹到 1、`<1`→夹到 `1/cropDim`、`cropDim<=0`→1；
  - `resolutionFromScale`：`scale=0.5` 下 `800×600 → 400×300`、`scale=1` 恒等、极小 scale 每边 `≥1`、结果 `≤ crop`。
- **`tests/runtime/imageEditProcess.test.cjs`**：保留现有 3 个测试（均不传 `resize`，行为不变）；新增
  - `clampResize` 纯函数：正常、超裁剪夹紧、`<1` 夹到 1、取整；
  - 集成："裁剪后缩放到一半 → 输出尺寸 == 目标"（传 `resize`）；
  - 集成："`resize` 大于裁剪 → 夹到裁剪尺寸"。

## 错误处理与边界（增量）

- 分辨率空 / 非法输入：`parseDimInput` 返回 `null` → 跳过更新；失焦用 `resolution` 回填真实值。
- 分辨率越界（> 裁剪）：UI `scaleFromDim` 夹到 ≤100%；runtime `clampResize` 兜底。
- 极小裁剪导致某边 `round` 趋 0：`resolutionFromScale` / `clampResize` 取 `max(1, …)`，sharp `resize` 不会收到 0。
- 其余（材质化失败、损坏图、格式不支持、crop 越界）沿用原设计的 catch → invoke reject → UI 显示错误并恢复按钮，不 `complete`。

## 构建影响

`manifest.json` / `scripts/build-*.mjs` / `verify-build.mjs` **均无需改**：契约是可选字段新增，消息 key (`image-edit/process-image`) 与 action id 不变，自发现与产物校验逻辑不受影响。

## 非目标（不做）

实时预览、旋转 / 镜像 / 滤镜、固定比例裁剪、**放大（分辨率 > 裁剪）**、独立非等比 W/H、按百分比的单输入控件、多图批处理。

## 验收

`npm run build && npm test` 全绿（typecheck + lint + 构建 + manifest 驱动的 verify-build + 单测 / 集成）。功能基线：`scaleFromDim` / `resolutionFromScale` / `clampResize` 纯逻辑单测 + "裁剪→缩放→输出尺寸 == 目标"的 sharp 集成测试。真机端到端（draft 面板、asset 显图、宿主按钮）仍为延迟验证项。
