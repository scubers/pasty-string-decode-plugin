// AUTO-GENERATED FILE — DO NOT EDIT BY HAND.
// Regenerate via `cd protocol/plugin && npm run codegen`.
// Source contract: protocol/plugin/src/catalog.ts
import { createStream, createTopic, readWindowGlobal } from '../internal/topic.js';
import { setActivePluginContext } from '../internal/requireContext.js';
import type { PluginAttachmentPayload, PluginClipboardItem, PluginThemeTokenSnapshot } from './data.generated.js';
import type { PluginActionHostInvokePayload, PluginAttachmentHostInvokePayload, PluginContextPayload } from './topicSubscribers.generated.js';
import { onActionHostInvoke, onAttachment, onAttachmentHostInvoke, onContext, onDraft, onItem, onTheme } from './topicSubscribers.generated.js';

export const _pluginContextTopic = createTopic<PluginContextPayload>(readWindowGlobal('__PASTY_PLUGIN_CONTEXT__'));

onContext((p) => {
  _pluginContextTopic.set(p);
  setActivePluginContext(p.mode);
});

export const _itemTopic = createTopic<PluginClipboardItem>(readWindowGlobal('__PASTY_PLUGIN_ITEM__'));

onItem((p) => _itemTopic.set(p));

export const _itemAttachmentTopic = createTopic<PluginAttachmentPayload>(readWindowGlobal('__PASTY_PLUGIN_ATTACHMENT__'));

onAttachment((p) => _itemAttachmentTopic.set(p));

export const _actionDraftTopic = createTopic<Record<string, unknown>>(readWindowGlobal('__PASTY_PLUGIN_DRAFT__'));

onDraft((p) => _actionDraftTopic.set(p));

export const _themeTopic = createTopic<PluginThemeTokenSnapshot>(readWindowGlobal('__PASTY_PLUGIN_THEME__'));

onTheme((p) => _themeTopic.set(p));

export const _attachmentRendererOnHostInvokeStream = createStream<PluginAttachmentHostInvokePayload>();

onAttachmentHostInvoke((p) => _attachmentRendererOnHostInvokeStream.emit(p));

export const _actionOnHostInvokeStream = createStream<PluginActionHostInvokePayload>();

onActionHostInvoke((p) => _actionOnHostInvokeStream.emit(p));
