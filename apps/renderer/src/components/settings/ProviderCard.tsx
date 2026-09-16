import { useState } from "react";
import {
  KEYED_PROVIDERS,
  PROVIDER_LABELS,
  type AppleStatus,
  type OllamaStatus,
  type ProviderPublic,
} from "@mental-lab/shared";
import Switch from "./Switch";

interface ProviderCardProps {
  provider: ProviderPublic;
  ollamaStatus: OllamaStatus | null;
  appleStatus: AppleStatus | null;
  onPatch: (patch: {
    enabled?: boolean;
    apiKey?: string | null;
    baseUrl?: string | null;
  }) => void;
}

export default function ProviderCard({
  provider,
  ollamaStatus,
  appleStatus,
  onPatch,
}: ProviderCardProps) {
  const [keyDraft, setKeyDraft] = useState("");
  const label = PROVIDER_LABELS[provider.id];
  const needsKey = KEYED_PROVIDERS.includes(provider.id);
  const hasBaseUrl = provider.id === "ollama" || provider.id === "deepseek";

  let statusLine: { text: string; ok: boolean } | null = null;
  if (provider.id === "ollama") {
    statusLine = ollamaStatus
      ? ollamaStatus.running
        ? {
            text: `Running — ${ollamaStatus.models.length} model${ollamaStatus.models.length === 1 ? "" : "s"} installed`,
            ok: true,
          }
        : { text: "Not running", ok: false }
      : null;
  } else if (provider.id === "apple") {
    statusLine = appleStatus
      ? appleStatus.available
        ? { text: "Available on this Mac", ok: true }
        : { text: appleStatus.reason ?? "Unavailable", ok: false }
      : null;
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-ink">{label}</p>
          {statusLine && (
            <p
              className={`mt-0.5 font-mono text-xs ${statusLine.ok ? "text-ok" : "text-amber"}`}
            >
              {statusLine.text}
            </p>
          )}
        </div>
        <Switch
          checked={provider.enabled}
          onChange={(enabled) => onPatch({ enabled })}
          label={`Use ${label}`}
        />
      </div>

      {needsKey && (
        <div className="mt-3 flex items-center gap-2">
          {provider.hasKey ? (
            <>
              <span className="font-mono text-xs text-ok">API key saved</span>
              <button
                onClick={() => onPatch({ apiKey: null })}
                className="ml-auto rounded-md border border-line px-2.5 py-1 text-xs text-ink-muted hover:text-ink"
              >
                Remove key
              </button>
            </>
          ) : (
            <>
              <input
                type="password"
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                placeholder={`${label} API key`}
                className="min-w-0 flex-1 rounded-md border border-line bg-paper px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-ink-muted"
              />
              <button
                onClick={() => {
                  if (keyDraft.trim()) {
                    onPatch({ apiKey: keyDraft.trim() });
                    setKeyDraft("");
                  }
                }}
                disabled={!keyDraft.trim()}
                className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              >
                Save
              </button>
            </>
          )}
        </div>
      )}

      {hasBaseUrl && (
        <div className="mt-3">
          <input
            type="text"
            defaultValue={provider.baseUrl ?? ""}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== (provider.baseUrl ?? "")) {
                onPatch({ baseUrl: v || null });
              }
            }}
            placeholder="Server address"
            className="w-full rounded-md border border-line bg-paper px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-ink-muted"
          />
        </div>
      )}
    </div>
  );
}
