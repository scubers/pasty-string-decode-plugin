// Runtime-only image processing. Bundled into dist/plugin.cjs by esbuild with
// `sharp` marked external (resolved from the host's node_modules at runtime).
// MUST NOT be imported by the UI bundle (app.vue/main.ts) — that would drag
// sharp/Node into the browser bundle.

import sharp from "sharp";
import type { CropRect, ProcessImageReq, ProcessImageResp } from "./contracts.ts";

/**
 * Minimal structural subset of the SDK HostClient this module uses. Declared
 * locally so processImage can be dependency-injected with a fake host in unit
 * tests, and so we don't couple to SDK type re-exports.
 */
export interface ImageEditHost {
  item: { materializeImagePath(): Promise<{ path: string }> };
  action: { allocateImageTempPath(payload: { formatHint: string }): Promise<{ path: string }> };
}

export type OutputFormat = "jpeg" | "png" | "webp";

/** Map a source image format to a supported output format; unknown → png (lossless). */
export function normalizeFormat(format: string | undefined | null): OutputFormat {
  switch ((format ?? "").toLowerCase()) {
    case "jpeg":
    case "jpg":
      return "jpeg";
    case "webp":
      return "webp";
    case "png":
      return "png";
    default:
      return "png";
  }
}

/** Clamp quality into the inclusive 1–100 range; non-finite → 80. */
export function clampQuality(quality: number): number {
  if (!Number.isFinite(quality)) return 80;
  return Math.min(100, Math.max(1, Math.round(quality)));
}

/** Clamp a crop rect to fit inside the image with every side ≥ 1px (sharp.extract throws otherwise). */
export function clampCropToImage(crop: CropRect, imageWidth: number, imageHeight: number): CropRect {
  const maxX = Math.max(0, imageWidth - 1);
  const maxY = Math.max(0, imageHeight - 1);
  const x = Math.min(Math.max(0, Math.round(crop.x)), maxX);
  const y = Math.min(Math.max(0, Math.round(crop.y)), maxY);
  const width = Math.min(Math.max(1, Math.round(crop.width)), imageWidth - x);
  const height = Math.min(Math.max(1, Math.round(crop.height)), imageHeight - y);
  return { x, y, width, height };
}

/**
 * Clamp a resize target to fit inside the crop with each side ≥ 1px. Enforces
 * the UI invariant that the compression resolution never exceeds the crop, and
 * guarantees the positive integers sharp.resize requires.
 */
export function clampResize(
  resize: { width: number; height: number },
  cropWidth: number,
  cropHeight: number,
): { width: number; height: number } {
  return {
    width: Math.min(Math.max(1, Math.round(resize.width)), cropWidth),
    height: Math.min(Math.max(1, Math.round(resize.height)), cropHeight),
  };
}

/**
 * Apply the format-specific encoder + quality. Preserves the source format:
 * JPEG/WebP use lossy quality; PNG (lossless) maps quality to libimagequant
 * palette quantization for real file-size reduction.
 */
export function applyFormat(pipeline: sharp.Sharp, format: OutputFormat, quality: number): sharp.Sharp {
  switch (format) {
    case "jpeg":
      return pipeline.jpeg({ quality });
    case "webp":
      return pipeline.webp({ quality });
    case "png":
      return pipeline.png({ quality, compressionLevel: 9, palette: true });
  }
}

/**
 * Crop + compress the current item's image and write the result to a
 * host-allocated temp path. The original is never mutated (sharp reads a
 * materialized copy). Returns the temp path + format hint for
 * pasty.action.complete({ result: { resultKind: 'image', ... } }).
 */
export async function processImage(host: ImageEditHost, req: ProcessImageReq): Promise<ProcessImageResp> {
  const { path: srcPath } = await host.item.materializeImagePath();
  const meta = await sharp(srcPath).metadata();
  if (!meta.width || !meta.height) {
    // Without real dimensions we cannot bound the crop safely; fail closed
    // rather than trust client-derived bounds. The UI surfaces the rejection.
    throw new Error("无法读取图片尺寸");
  }
  const format = normalizeFormat(meta.format);
  const crop = clampCropToImage(req.crop, meta.width, meta.height);
  const quality = clampQuality(req.quality);

  const { path: outPath } = await host.action.allocateImageTempPath({ formatHint: format });
  let pipeline = sharp(srcPath).extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height });
  if (req.resize) {
    const target = clampResize(req.resize, crop.width, crop.height);
    // fit:"fill" outputs exactly target W×H; the target ratio is locked to the
    // crop ratio by the UI, so there's no visible distortion. Skip the resampling
    // no-op when the target already equals the crop (resolution at 100%).
    if (target.width !== crop.width || target.height !== crop.height) {
      pipeline = pipeline.resize(target.width, target.height, { fit: "fill" });
    }
  }
  await applyFormat(pipeline, format, quality).toFile(outPath);

  return { imageTempPath: outPath, imageFormatHint: format };
}
