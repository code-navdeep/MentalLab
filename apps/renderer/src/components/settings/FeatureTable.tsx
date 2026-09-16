import {
  FEATURES,
  TIER_LABELS,
  TIERS,
  type FeatureTiers,
  type Tier,
} from "@mental-lab/shared";

interface FeatureTableProps {
  featureTiers: FeatureTiers;
  onChange: (featureId: string, tier: Tier) => void;
}

export default function FeatureTable({
  featureTiers,
  onChange,
}: FeatureTableProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      {FEATURES.map((feature, i) => (
        <div
          key={feature.id}
          className={`flex items-center justify-between gap-4 px-4 py-3 ${
            i > 0 ? "border-t border-line" : ""
          }`}
        >
          <div>
            <p className="text-sm text-ink">{feature.label}</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              {feature.description}
            </p>
          </div>
          <select
            value={featureTiers[feature.id] ?? feature.defaultTier}
            onChange={(e) => onChange(feature.id, e.target.value as Tier)}
            className="rounded-md border border-line bg-paper px-2 py-1.5 text-xs text-ink"
            aria-label={`Difficulty tier for ${feature.label}`}
          >
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {TIER_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}
