"use strict";

const { rendererResult } = require("@pasty/plugin-sdk/runtime");
const {
  decodeDecodePayload,
  encodingLabel
} = require("../shared/decodePayload");

const ATTACHMENT_TYPE = "plugin.pasty.awesome.decode.preview";
const ATTACHMENT_KEY = "primary";

function buttonsFor(payload) {
  const copyJsonEnabled =
    payload.encoding === "jwt" || payload.decodedIsJSON === true;
  const toggleTitle = payload.expanded === true ? "Show Less" : "Show More";
  return [
    { id: "copy-decoded", title: "Copy Decoded", isEnabled: true },
    { id: "copy-json", title: "Copy as JSON", isEnabled: copyJsonEnabled },
    { id: "toggle-expand", title: toggleTitle, isEnabled: true }
  ];
}

function resolveAttachment(input) {
  const payload = decodeDecodePayload(input?.attachment?.payloadJson);
  if (!payload) {
    return {
      displayName: "Decoded Preview",
      tintHex: null,
      buttons: [
        { id: "copy-decoded", title: "Copy Decoded", isEnabled: false },
        { id: "copy-json", title: "Copy as JSON", isEnabled: false },
        { id: "toggle-expand", title: "Show More", isEnabled: false }
      ]
    };
  }

  const label = encodingLabel(payload.encoding);
  return {
    displayName: `Decoded Preview · ${label}`,
    // tintHex: null lets the host apply its theme accent automatically.
    tintHex: null,
    buttons: buttonsFor(payload)
  };
}

async function invokeOperation(input, ctx) {
  const payload = decodeDecodePayload(input?.attachment?.payloadJson);
  if (!payload) {
    return rendererResult.failure("Invalid decode payload");
  }

  const buttonID = input?.buttonID;
  const clipboard = ctx?.host?.clipboard;

  if (buttonID === "copy-decoded") {
    await clipboard.copyText(payload.decoded);
    return rendererResult.success({ userMessage: "Decoded copied" });
  }

  if (buttonID === "copy-json") {
    try {
      const parsed = JSON.parse(payload.decoded);
      const pretty = JSON.stringify(parsed, null, 2);
      await clipboard.copyText(pretty);
      return rendererResult.success({ userMessage: "JSON copied" });
    } catch {
      await clipboard.copyText(payload.decoded);
      return rendererResult.success({
        userMessage: "JSON parse failed, copied raw"
      });
    }
  }

  if (buttonID === "toggle-expand") {
    const nextExpanded = payload.expanded !== true;
    const nextPayload = { ...payload, expanded: nextExpanded };
    const attachmentType =
      input?.attachment?.attachmentType || ATTACHMENT_TYPE;
    const attachmentKey =
      input?.attachment?.attachmentKey || ATTACHMENT_KEY;

    await ctx.host.item.setAttachments({
      attachments: [
        {
          attachmentType,
          attachmentKey,
          payloadJson: JSON.stringify(nextPayload),
          attachmentSyncScope: "syncable"
        }
      ]
    });

    return rendererResult.success({
      userMessage: nextExpanded ? "Expanded" : "Collapsed"
    });
  }

  return rendererResult.success();
}

function createDecodeRenderer() {
  return {
    async resolveAttachment(input, ctx) {
      return resolveAttachment(input, ctx);
    },
    async invokeOperation(input, ctx) {
      return invokeOperation(input, ctx);
    }
  };
}

module.exports = {
  createDecodeRenderer,
  resolveAttachment,
  invokeOperation
};
