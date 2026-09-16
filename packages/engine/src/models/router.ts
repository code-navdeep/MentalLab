import {
  FEATURES,
  KEYED_PROVIDERS,
  TIERS,
  type ProviderId,
  type Tier,
} from "@mental-lab/shared";
import type { ModelSettingsInternal } from "./settings.js";

export interface ResolvedModel {
  tier: Tier;
  provider: ProviderId;
  model: string;
}

function tierUsable(s: ModelSettingsInternal, tier: Tier): ResolvedModel | null {
  const t = s.tiers[tier];
  if (!t.enabled || t.provider === null) return null;
  const p = s.providers[t.provider];
  if (!p.enabled) return null;
  if (KEYED_PROVIDERS.includes(t.provider) && p.encryptedKey === null) {
    return null;
  }
  const model = t.provider === "apple" ? "system" : t.model;
  if (!model) return null;
  return { tier, provider: t.provider, model };
}

/** Requested tier first, then higher tiers ascending, then lower descending. */
export function fallbackOrder(tier: Tier): Tier[] {
  const idx = TIERS.indexOf(tier);
  const higher = TIERS.slice(idx + 1);
  const lower = TIERS.slice(0, idx).reverse();
  return [tier, ...higher, ...lower];
}

export function resolveTier(
  s: ModelSettingsInternal,
  tier: Tier
): ResolvedModel {
  for (const candidate of fallbackOrder(tier)) {
    const resolved = tierUsable(s, candidate);
    if (resolved) return resolved;
  }
  throw new Error(
    "No model is configured for this task — assign a provider and model to a tier in Settings"
  );
}

export function resolveFeature(
  s: ModelSettingsInternal,
  featureId: string
): ResolvedModel {
  const def = FEATURES.find((f) => f.id === featureId);
  if (!def) throw new Error(`Unknown feature: ${featureId}`);
  const tier = s.featureTiers[featureId] ?? def.defaultTier;
  return resolveTier(s, tier);
}
