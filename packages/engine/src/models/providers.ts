import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { PROVIDER_LABELS, type ProviderId } from "@mental-lab/shared";
import { getDecryptedKey, type ModelSettingsInternal } from "./settings.js";

function requireKey(s: ModelSettingsInternal, provider: ProviderId): string {
  const key = getDecryptedKey(s, provider);
  if (!key) {
    throw new Error(`${PROVIDER_LABELS[provider]} has no API key saved`);
  }
  return key;
}

/**
 * Build a callable AI SDK language model for an API/local provider.
 * Apple Intelligence is not built here — it speaks to the Swift sidecar
 * (see apple.ts) rather than an HTTP API.
 */
export function buildLanguageModel(
  s: ModelSettingsInternal,
  provider: Exclude<ProviderId, "apple">,
  modelName: string
): LanguageModel {
  if (!modelName) {
    throw new Error(`No model chosen for ${PROVIDER_LABELS[provider]}`);
  }
  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey: requireKey(s, provider) })(modelName);
    case "anthropic":
      return createAnthropic({ apiKey: requireKey(s, provider) })(modelName);
    case "deepseek": {
      const baseURL = s.providers.deepseek.baseUrl;
      return createDeepSeek({
        apiKey: requireKey(s, provider),
        ...(baseURL ? { baseURL } : {}),
      })(modelName);
    }
    case "ollama": {
      const base =
        s.providers.ollama.baseUrl ?? "http://localhost:11434";
      return createOpenAICompatible({
        name: "ollama",
        baseURL: `${base.replace(/\/$/, "")}/v1`,
      })(modelName);
    }
  }
}
