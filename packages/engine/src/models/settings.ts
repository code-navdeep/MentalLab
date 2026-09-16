import {
  DEFAULT_BASE_URLS,
  FEATURES,
  PROVIDER_IDS,
  providerAllowedForTier,
  type ModelSettingsPublic,
  type ProviderId,
  type Tier,
  type TierConfig,
} from "@mental-lab/shared";
import { getConfigValue, setConfigValue } from "../config.js";
import { getSecretStore } from "../security/crypto.js";

const CONFIG_KEY = "modelSettings";

interface ProviderInternal {
  enabled: boolean;
  encryptedKey: string | null;
  baseUrl: string | null;
}

export interface ModelSettingsInternal {
  providers: Record<ProviderId, ProviderInternal>;
  tiers: Record<Tier, TierConfig>;
  featureTiers: Record<string, Tier>;
}

function defaults(): ModelSettingsInternal {
  const providers = Object.fromEntries(
    PROVIDER_IDS.map((id) => [
      id,
      {
        enabled: false,
        encryptedKey: null,
        baseUrl: DEFAULT_BASE_URLS[id] ?? null,
      },
    ])
  ) as Record<ProviderId, ProviderInternal>;

  const tier = (): TierConfig => ({ enabled: true, provider: null, model: "" });

  return {
    providers,
    tiers: { easy: tier(), intermediate: tier(), difficult: tier() },
    featureTiers: Object.fromEntries(
      FEATURES.map((f) => [f.id, f.defaultTier])
    ),
  };
}

export async function loadSettings(): Promise<ModelSettingsInternal> {
  const stored = await getConfigValue<ModelSettingsInternal>(CONFIG_KEY);
  if (!stored) {
    const d = defaults();
    await setConfigValue(CONFIG_KEY, d);
    return d;
  }
  return stored;
}

async function save(settings: ModelSettingsInternal): Promise<void> {
  await setConfigValue(CONFIG_KEY, settings);
}

export function toPublic(s: ModelSettingsInternal): ModelSettingsPublic {
  return {
    providers: Object.fromEntries(
      PROVIDER_IDS.map((id) => [
        id,
        {
          id,
          enabled: s.providers[id].enabled,
          hasKey: s.providers[id].encryptedKey !== null,
          baseUrl: s.providers[id].baseUrl,
        },
      ])
    ) as ModelSettingsPublic["providers"],
    tiers: s.tiers,
    featureTiers: s.featureTiers,
  };
}

export async function setProvider(patch: {
  provider: ProviderId;
  enabled?: boolean;
  apiKey?: string | null;
  baseUrl?: string | null;
}): Promise<ModelSettingsInternal> {
  const s = await loadSettings();
  const p = s.providers[patch.provider];
  if (patch.enabled !== undefined) p.enabled = patch.enabled;
  if (patch.baseUrl !== undefined) p.baseUrl = patch.baseUrl;
  if (patch.apiKey !== undefined) {
    p.encryptedKey =
      patch.apiKey === null ? null : getSecretStore().encrypt(patch.apiKey);
  }
  await save(s);
  return s;
}

export async function setTier(
  tier: Tier,
  patch: { enabled?: boolean; provider?: ProviderId | null; model?: string }
): Promise<ModelSettingsInternal> {
  if (
    patch.provider !== undefined &&
    patch.provider !== null &&
    !providerAllowedForTier(patch.provider, tier)
  ) {
    throw new Error(
      `${patch.provider} is not available for the ${tier} tier`
    );
  }
  const s = await loadSettings();
  const t = s.tiers[tier];
  if (patch.enabled !== undefined) t.enabled = patch.enabled;
  if (patch.provider !== undefined) t.provider = patch.provider;
  if (patch.model !== undefined) t.model = patch.model;
  await save(s);
  return s;
}

export async function setFeatureTier(
  featureId: string,
  tier: Tier
): Promise<ModelSettingsInternal> {
  if (!FEATURES.some((f) => f.id === featureId)) {
    throw new Error(`Unknown feature: ${featureId}`);
  }
  const s = await loadSettings();
  s.featureTiers[featureId] = tier;
  await save(s);
  return s;
}

export function getDecryptedKey(
  s: ModelSettingsInternal,
  provider: ProviderId
): string | null {
  const token = s.providers[provider].encryptedKey;
  if (token === null) return null;
  return getSecretStore().decrypt(token);
}
