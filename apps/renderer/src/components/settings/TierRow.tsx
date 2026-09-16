import { useState } from "react";
import {
  PROVIDER_IDS,
  PROVIDER_LABELS,
  SUGGESTED_MODELS,
  TIER_LABELS,
  providerAllowedForTier,
  type IpcResponse,
  type ModelSettingsPublic,
  type ProviderId,
  type Tier,
  type TierConfig,
} from "@mental-lab/shared";
import { runTestPrompt } from "../../lib/testPrompt";
import Switch from "./Switch";

interface TierRowProps {
  tier: Tier;
  config: TierConfig;
  providers: ModelSettingsPublic["providers"];
  ollamaModels: string[];
  onPatch: (patch: {
    enabled?: boolean;
    provider?: ProviderId | null;
    model?: string;
  }) => void;
}

const TIER_HINTS: Record<Tier, string> = {
  easy: "Naming, keywords, quick filtering",
  intermediate: "Library chat, paper copilot, summaries",
  difficult: "Agent tasks and multi-step research",
};

export default function TierRow({
  tier,
  config,
  providers,
  ollamaModels,
  onPatch,
}: TierRowProps) {
  const [prompt, setPrompt] = useState("");
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [route, setRoute] = useState<IpcResponse<"models:testPrompt"> | null>(
    null
  );

  const allowed = PROVIDER_IDS.filter((p) => providerAllowedForTier(p, tier));
  const suggestions =
    config.provider === "ollama"
      ? ollamaModels
      : config.provider
        ? SUGGESTED_MODELS[config.provider]
        : [];

  async function handleRun() {
    if (!prompt.trim() || running) return;
    setRunning(true);
    setOutput("");
    setRoute(null);
    await runTestPrompt(tier, prompt.trim(), {
      onDelta: (delta) => setOutput((prev) => prev + delta),
      onDone: (result) => {
        setRoute(result);
        setRunning(false);
      },
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-ink">{TIER_LABELS[tier]}</p>
          <p className="mt-0.5 text-xs text-ink-muted">{TIER_HINTS[tier]}</p>
        </div>
        <Switch
          checked={config.enabled}
          onChange={(enabled) => onPatch({ enabled })}
          label={`Use the ${TIER_LABELS[tier]} tier`}
        />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <select
          value={config.provider ?? ""}
          onChange={(e) =>
            onPatch({
              provider: e.target.value
                ? (e.target.value as ProviderId)
                : null,
            })
          }
          className="rounded-md border border-line bg-paper px-2 py-1.5 text-xs text-ink"
          aria-label={`${TIER_LABELS[tier]} tier source`}
        >
          <option value="">No source</option>
          {allowed.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABELS[p]}
              {providers[p]?.enabled ? "" : " (off)"}
            </option>
          ))}
        </select>

        {config.provider && config.provider !== "apple" && (
          <>
            <input
              type="text"
              list={`models-${tier}`}
              value={config.model}
              onChange={(e) => onPatch({ model: e.target.value })}
              placeholder="Model name"
              className="min-w-0 flex-1 rounded-md border border-line bg-paper px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-ink-muted"
            />
            <datalist id={`models-${tier}`}>
              {suggestions.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </>
        )}
        {config.provider === "apple" && (
          <span className="font-mono text-xs text-ink-muted">
            on-device model
          </span>
        )}
      </div>

      <div className="mt-3 border-t border-line pt-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleRun();
            }}
            placeholder="Test this tier with a prompt"
            className="min-w-0 flex-1 rounded-md border border-line bg-paper px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-muted"
          />
          <button
            onClick={() => void handleRun()}
            disabled={running || !prompt.trim()}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          >
            {running ? "Running…" : "Run"}
          </button>
        </div>

        {(output || route) && (
          <div className="mt-2 rounded-md bg-paper p-2.5">
            {output && (
              <p className="select-text whitespace-pre-wrap text-xs leading-relaxed text-ink">
                {output}
              </p>
            )}
            {route && route.ok && (
              <p className="mt-1.5 font-mono text-[10px] text-ink-muted">
                answered by {route.provider && PROVIDER_LABELS[route.provider]}{" "}
                · {route.model}
                {route.resolvedTier !== tier &&
                  ` · rerouted to ${route.resolvedTier} tier`}
              </p>
            )}
            {route && !route.ok && (
              <p className="font-mono text-xs text-amber">{route.error}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
