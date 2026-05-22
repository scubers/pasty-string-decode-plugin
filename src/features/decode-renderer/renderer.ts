import type {
  PluginActionButton,
  PluginAttachmentRendererHandler,
  PluginAttachmentResolveResult,
  PluginResolveAttachmentInput,
} from "@pasty/plugin-sdk/runtime";
import { decodeDecodePayload, encodingLabel, type DecodePayload } from "./payload.ts";

export function buttonsFor(payload: DecodePayload): PluginActionButton[] {
  const buttons: PluginActionButton[] = [
    { id: "copy-decoded", title: "Copy", isEnabled: true },
  ];
  if (payload.encoding === "jwt" || payload.decodedIsJSON === true) {
    buttons.push({ id: "copy-json", title: "Copy as JSON", isEnabled: true });
  }
  buttons.push({
    id: "toggle-expand",
    title: payload.expanded === true ? "Show Less" : "Show More",
    isEnabled: true,
  });
  return buttons;
}

export function resolveAttachment(input: PluginResolveAttachmentInput): PluginAttachmentResolveResult {
  const payload = decodeDecodePayload(input?.attachment?.payloadJson);
  if (!payload) {
    return {
      displayName: "Decoded Preview",
      buttons: [],
      shouldDisplay: false,
    };
  }

  return {
    displayName: `Decoded Preview - ${encodingLabel(payload.encoding)}`,
    buttons: buttonsFor(payload),
  };
}

export function createDecodeRenderer(): PluginAttachmentRendererHandler {
  return {
    async resolveAttachment(input: PluginResolveAttachmentInput): Promise<PluginAttachmentResolveResult> {
      return resolveAttachment(input);
    },
  };
}
