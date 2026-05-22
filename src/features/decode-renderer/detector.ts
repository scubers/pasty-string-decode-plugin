import type {
  PluginDetectorArtifact,
  PluginDetectorHandler,
  PluginDetectorInput,
} from "@pasty/plugin-sdk/runtime";
import { preprocess, runPriorityChain } from "./detection.ts";
import { buildDecodeArtifact, createDecodePayload, readTextContent } from "./payload.ts";

export function detectArtifacts(input: PluginDetectorInput | unknown): PluginDetectorArtifact[] {
  if (!input || typeof input !== "object") {
    return [];
  }
  const content = (input as { content?: unknown }).content;
  const rawText = readTextContent(content);
  if (rawText === null) {
    return [];
  }

  const { trimmed, bail } = preprocess(rawText);
  if (bail) {
    return [];
  }

  const detection = runPriorityChain(trimmed);
  if (!detection) {
    return [];
  }

  const payload = createDecodePayload({ ...detection, original: trimmed });
  return payload ? [buildDecodeArtifact(payload)] : [];
}

export function createDecodeDetector(): PluginDetectorHandler {
  return {
    async detect(input: PluginDetectorInput): Promise<PluginDetectorArtifact[]> {
      return detectArtifacts(input);
    },
  };
}
