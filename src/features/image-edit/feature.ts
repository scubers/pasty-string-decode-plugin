import { actionResult } from "@pasty/plugin-sdk/runtime";
import type { PluginAutoRunActionHandler } from "@pasty/plugin-sdk/runtime";
import type { PluginFeature } from "../registry.ts";
import { PROCESS_IMAGE, type ImageEditDraft, type ProcessImageReq, type ProcessImageResp } from "./contracts.ts";
import { processImage, type ImageEditHost } from "./process.ts";

const DEFAULT_QUALITY = 80;

// Draft-lifecycle action. resolveSession seeds the form; the WebView edits
// params and submits via pasty.action.complete. runAutoAction is required by
// the handler type but never invoked for a draft action (the inverse of
// case-convert, which stubs resolveSession). The actual crop+compress runs in
// the process-image messageHandler, which the UI calls via pasty.runtime.invoke
// before completing with the resulting image temp path.
const imageEditAction: PluginAutoRunActionHandler = {
  async resolveSession(input) {
    if (input.content.kind !== "image") {
      // The host only offers this action for image items (supportedItemTypes),
      // but stay defensive: an empty session is harmless.
      return { buttons: [], initialDraft: {} };
    }
    const draft: ImageEditDraft = {
      origWidth: input.content.width,
      origHeight: input.content.height,
      format: input.content.format,
      quality: DEFAULT_QUALITY,
    };
    return {
      displayName: "Crop & Compress",
      buttons: [{ id: "apply", title: "Apply", isEnabled: true }],
      defaultButtonID: "apply",
      initialDraft: draft as unknown as Record<string, unknown>,
    };
  },
  async runAutoAction() {
    return actionResult.none();
  },
};

// messageHandlers receive { host } as ctx (MessageHandlerContext). The local
// PluginFeature.messageHandlers type is intentionally loose ((request, ctx) =>
// unknown), so narrow both here.
async function handleProcessImage(request: unknown, ctx: unknown): Promise<ProcessImageResp> {
  const { host } = ctx as { host: ImageEditHost };
  return processImage(host, request as ProcessImageReq);
}

export const imageEditFeature: PluginFeature = {
  actions: { "image-edit": imageEditAction },
  messageHandlers: { [PROCESS_IMAGE]: handleProcessImage },
};
