import { z } from "zod";

// ============================================================================
// Providers
// ============================================================================

export const PROVIDER_IDS = [
  "apple",
  "ollama",
  "openai",
  "deepseek",
  "anthropic",
] as const;
export const ProviderId = z.enum(PROVIDER_IDS);
export type ProviderId = z.infer<typeof ProviderId>;

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  apple: "Apple Intelligence",
  ollama: "Ollama",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  anthropic: "Claude",
};

/** Providers that authenticate with an API key. */
export const KEYED_PROVIDERS: ProviderId[] = ["openai", "deepseek", "anthropic"];

// Renderer-facing provider state. Never carries the key itself.
export const ProviderPublic = z.object({
  id: ProviderId,
  enabled: z.boolean(),
  hasKey: z.boolean(),
  baseUrl: z.string().nullable(),
});
export type ProviderPublic = z.infer<typeof ProviderPublic>;

// ============================================================================
// Tiers
// ============================================================================

export const TIERS = ["easy", "intermediate", "difficult"] as const;
export const Tier = z.enum(TIERS);
export type Tier = z.infer<typeof Tier>;

export const TIER_LABELS: Record<Tier, string> = {
  easy: "Easy",
  intermediate: "Intermediate",
  difficult: "Difficult",
};

export const TierConfig = z.object({
  enabled: z.boolean(),
  provider: ProviderId.nullable(),
  model: z.string(),
});
export type TierConfig = z.infer<typeof TierConfig>;

/** Apple's on-device model is small; it is only offered for easy tasks. */
export function providerAllowedForTier(provider: ProviderId, tier: Tier): boolean {
  if (provider === "apple") return tier === "easy";
  return true;
}

// ============================================================================
// Feature registry — which app task runs at which difficulty by default.
// The user can re-route any feature to another tier in Settings.
// ============================================================================

export interface FeatureDef {
  id: string;
  label: string;
  description: string;
  defaultTier: Tier;
}

export const FEATURES: FeatureDef[] = [
  {
    id: "titles",
    label: "Naming",
    description: "Titles for conversations and notes",
    defaultTier: "easy",
  },
  {
    id: "keywords",
    label: "Keywords",
    description: "Tag and keyword extraction",
    defaultTier: "easy",
  },
  {
    id: "vault-filter",
    label: "Vault filtering",
    description: "Deciding which mail becomes vault notes",
    defaultTier: "easy",
  },
  {
    id: "doc-chat",
    label: "Library chat",
    description: "Answers from your notes and documents",
    defaultTier: "intermediate",
  },
  {
    id: "paper-copilot",
    label: "Paper copilot",
    description: "Reader-mode questions about a paper",
    defaultTier: "intermediate",
  },
  {
    id: "summaries",
    label: "Summaries",
    description: "Paper overviews and starter questions",
    defaultTier: "intermediate",
  },
  {
    id: "vault-notes",
    label: "Vault notes",
    description: "Writing and updating vault notes",
    defaultTier: "intermediate",
  },
  {
    id: "agent",
    label: "Agent tasks",
    description: "The Tasks mode agent and automations",
    defaultTier: "difficult",
  },
];

export const FeatureTiers = z.record(z.string(), Tier);
export type FeatureTiers = z.infer<typeof FeatureTiers>;

// ============================================================================
// Aggregate settings (public shape shared over IPC)
// ============================================================================

export const ModelSettingsPublic = z.object({
  providers: z.record(ProviderId, ProviderPublic),
  tiers: z.object({
    easy: TierConfig,
    intermediate: TierConfig,
    difficult: TierConfig,
  }),
  featureTiers: FeatureTiers,
});
export type ModelSettingsPublic = z.infer<typeof ModelSettingsPublic>;

// ============================================================================
// Provider status probes
// ============================================================================

export const OllamaStatus = z.object({
  running: z.boolean(),
  models: z.array(z.string()),
});
export type OllamaStatus = z.infer<typeof OllamaStatus>;

export const AppleStatus = z.object({
  available: z.boolean(),
  reason: z.string().nullable(),
});
export type AppleStatus = z.infer<typeof AppleStatus>;

// ============================================================================
// Model name suggestions (free-text always allowed; these seed the pickers)
// ============================================================================

export const SUGGESTED_MODELS: Record<ProviderId, string[]> = {
  apple: ["system"],
  ollama: [],
  openai: ["gpt-5.1", "gpt-5", "gpt-5-mini", "gpt-4.1"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  anthropic: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"],
};

export const DEFAULT_BASE_URLS: Partial<Record<ProviderId, string>> = {
  ollama: "http://localhost:11434",
  deepseek: "https://api.deepseek.com",
};
