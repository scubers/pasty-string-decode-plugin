// Shared, isomorphic contract between the image-edit draft UI (vite bundle) and
// its Node runtime (esbuild bundle). Pure types + a message key — ZERO SDK
// imports — so it can be pulled into both bundles without dragging the SDK's
// /ui or /runtime entry code across the boundary.

/** The runtime messageHandler key the UI invokes to crop + compress. */
export const PROCESS_IMAGE = "image-edit/process-image";

/** Crop rectangle expressed in ORIGINAL image pixels (integers). */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * initialDraft seeded by resolveSession (Node) and read by the UI via
 * pasty.action.draft.current(). Carries the coordinate basis + slider seed so
 * the UI can set up before the preview image finishes loading.
 */
export interface ImageEditDraft {
  origWidth: number;
  origHeight: number;
  format: string;
  quality: number;
}

/** UI → runtime request payload for PROCESS_IMAGE. */
export interface ProcessImageReq {
  quality: number;
  crop: CropRect;
  /**
   * Output resolution in ORIGINAL pixels, clamped to ≤ crop on each side.
   * Omitted means "no resize" — the output keeps the crop's pixel dimensions.
   */
  resize?: { width: number; height: number };
}

/** runtime → UI response; fed straight into pasty.action.complete. */
export interface ProcessImageResp {
  imageTempPath: string;
  imageFormatHint: string;
}
