import { streamText } from "ai";
import type {
  AppleStatus,
  ModelSettingsPublic,
  OllamaStatus,
  ProviderId,
  Tier,
} from "@mental-lab/shared";
import { generateApple, probeApple } from "./apple.js";
import { probeOllama } from "./ollama.js";
import { buildLanguageModel } from "./providers.js";
import { resolveFeature, resolveTier, type ResolvedModel } from "./router.js";
import {
  loadSettings,
  setFeatureTier,
  setProvider,
  setTier,
  toPublic,
} from "./settings.js";

export { setAppleSidecarPath } from "./apple.js";
export { resolveFeature, resolveTier } from "./router.js";
export { loadSettings } from "./settings.js";

export async function getModelSettings(): Promise<ModelSettingsPublic> {
  return toPublic(await loadSettings());
}

export async function updateProvider(patch: {
  provider: ProviderId;
  enabled?: boolean;
  apiKey?: string | null;
  baseUrl?: string | null;
}): Promise<ModelSettingsPublic> {
  return toPublic(await setProvider(patch));
}

export async function updateTier(
  tier: Tier,
  patch: { enabled?: boolean; provider?: ProviderId | null; model?: string }
): Promise<ModelSettingsPublic> {
  return toPublic(await setTier(tier, patch));
}

export async function updateFeatureTier(
  featureId: string,
  tier: Tier
): Promise<ModelSettingsPublic> {
  return toPublic(await setFeatureTier(featureId, tier));
}

export async function getOllamaStatus(): Promise<OllamaStatus> {
  const s = await loadSettings();
  const base = s.providers.ollama.baseUrl ?? "http://localhost:11434";
  return probeOllama(base);
}

export async function getAppleStatus(): Promise<AppleStatus> {
  return probeApple();
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Feature-routed streaming with system prompt + message history.
 * Apple (reachable only through the easy tier) takes a flattened prompt.
 */
export async function streamForFeature(
  featureId: string,
  opts: {
    system?: string | null;
    messages: ChatTurn[];
    /** Overrides the feature's routed tier (e.g. a per-chat difficulty). */
    tierOverride?: Tier | null;
  },
  onDelta: (delta: string) => void
): Promise<ResolvedModel> {
  const s = await loadSettings();
  const resolved = opts.tierOverride
    ? resolveTier(s, opts.tierOverride)
    : resolveFeature(s, featureId);

  if (resolved.provider === "apple") {
    const flattened = opts.messages
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");
    await generateApple(flattened, opts.system ?? null, onDelta);
    return resolved;
  }

  const model = buildLanguageModel(s, resolved.provider, resolved.model);
  const result = streamText({
    model,
    ...(opts.system ? { system: opts.system } : {}),
    messages: opts.messages,
  });
  for await (const delta of result.textStream) {
    onDelta(delta);
  }
  return resolved;
}

/** Feature-routed one-shot generation (titles, keywords, filters). */
export async function generateForFeature(
  featureId: string,
  prompt: string
): Promise<string> {
  let text = "";
  await streamForFeature(
    featureId,
    { messages: [{ role: "user", content: prompt }] },
    (delta) => {
      text += delta;
    }
  );
  return text.trim();
}

/**
 * Resolve a tier and stream a completion through whatever it lands on.
 * Returns the resolved assignment; deltas arrive through the callback.
 */
export async function runTierPrompt(
  tier: Tier,
  prompt: string,
  onDelta: (delta: string) => void
): Promise<ResolvedModel> {
  const s = await loadSettings();
  const resolved = resolveTier(s, tier);

  if (resolved.provider === "apple") {
    await generateApple(prompt, null, onDelta);
    return resolved;
  }

  const model = buildLanguageModel(s, resolved.provider, resolved.model);
  const result = streamText({ model, prompt });
  for await (const delta of result.textStream) {
    onDelta(delta);
  }
  return resolved;
}
