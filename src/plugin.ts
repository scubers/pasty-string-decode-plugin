import { definePlugin } from "@pasty/plugin-sdk/runtime";
import { createDecodeDetector } from "./features/decode-renderer/detector";
import { createDecodeRenderer } from "./features/decode-renderer/renderer";

export default definePlugin({
  setup() {
    return {
      attachmentRenderers: {
        "decode-renderer": createDecodeRenderer(),
      },
      detectors: {
        "decode-detector": createDecodeDetector(),
      },
    };
  },
});
