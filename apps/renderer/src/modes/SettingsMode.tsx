import { useEffect, useState } from "react";
import {
  PROVIDER_IDS,
  TIERS,
  type AppleStatus,
  type IpcResponse,
  type ModelSettingsPublic,
  type OllamaStatus,
  type ProviderId,
  type Tier,
} from "@mental-lab/shared";
import { applyTheme, type ThemePreference } from "../App";
import ProviderCard from "../components/settings/ProviderCard";
import TierRow from "../components/settings/TierRow";
import FeatureTable from "../components/settings/FeatureTable";
import LibrarySection from "../components/settings/LibrarySection";
import AgentSection from "../components/settings/AgentSection";

type Versions = IpcResponse<"app:getVersions">;
type Status = IpcResponse<"app:getStatus">;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-8 border-b border-line py-3">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="select-text text-right font-mono text-sm text-ink">
        {value}
      </span>
    </div>
  );
}

function LinkRow({
  label,
  href,
  text,
}: {
  label: string;
  href: string;
  text: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-8 border-b border-line py-3">
      <span className="text-sm text-ink-muted">{label}</span>
      <a
        href={href}
        className="text-right font-mono text-sm text-accent-ink hover:underline"
      >
        {text}
      </a>
    </div>
  );
}

function SectionHeading({ children }: { children: string }) {
  return (
    <h2 className="font-mono text-xs uppercase tracking-[0.15em] text-ink-muted">
      {children}
    </h2>
  );
}

export default function SettingsMode() {
  const [settings, setSettings] = useState<ModelSettingsPublic | null>(null);
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [apple, setApple] = useState<AppleStatus | null>(null);
  const [versions, setVersions] = useState<Versions | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [themePref, setThemePref] = useState<ThemePreference>(
    () => (localStorage.getItem("theme") as ThemePreference | null) ?? "system"
  );

  useEffect(() => {
    window.ipc.invoke("models:getSettings", null).then(setSettings);
    window.ipc.invoke("models:ollamaStatus", null).then(setOllama);
    window.ipc.invoke("models:appleStatus", null).then(setApple);
    window.ipc.invoke("app:getVersions", null).then(setVersions);
    window.ipc.invoke("app:getStatus", null).then(setStatus);
  }, []);

  async function mutate(action: () => Promise<ModelSettingsPublic>) {
    setError(null);
    try {
      setSettings(await action());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function patchProvider(
    provider: ProviderId,
    patch: { enabled?: boolean; apiKey?: string | null; baseUrl?: string | null }
  ) {
    void mutate(() =>
      window.ipc.invoke("models:setProvider", { provider, ...patch })
    ).then(() => {
      if (provider === "ollama") {
        window.ipc.invoke("models:ollamaStatus", null).then(setOllama);
      }
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="titlebar-drag h-12 shrink-0" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-8 pb-16">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent-ink">
            Settings
          </p>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
            Instruments
          </h1>

          {error && (
            <p className="mt-4 rounded-md border border-amber/40 bg-surface px-3 py-2 font-mono text-xs text-amber">
              {error}
            </p>
          )}

          <section className="mt-10">
            <SectionHeading>Appearance</SectionHeading>
            <div className="mt-3 flex items-center gap-2">
              {(["system", "light", "dark"] as const).map((pref) => (
                <button
                  key={pref}
                  onClick={() => {
                    localStorage.setItem("theme", pref);
                    applyTheme(pref);
                    setThemePref(pref);
                  }}
                  className={`rounded-md border px-3 py-1.5 text-xs capitalize transition-colors ${
                    themePref === pref
                      ? "border-accent bg-accent-wash text-accent-ink"
                      : "border-line text-ink-muted hover:text-ink"
                  }`}
                >
                  {pref}
                </button>
              ))}
            </div>
          </section>

          <section className="mt-10">
            <SectionHeading>Sources</SectionHeading>
            <p className="mt-1 text-xs text-ink-muted">
              Where answers come from. Turn any source off at any time.
            </p>
            <div className="mt-3 space-y-3">
              {settings &&
                PROVIDER_IDS.map((id) => (
                  <ProviderCard
                    key={id}
                    provider={settings.providers[id]!}
                    ollamaStatus={ollama}
                    appleStatus={apple}
                    onPatch={(patch) => patchProvider(id, patch)}
                  />
                ))}
            </div>
          </section>

          <section className="mt-10">
            <SectionHeading>Library</SectionHeading>
            <p className="mt-1 text-xs text-ink-muted">
              Folders indexed for chat and search. PDFs, Markdown, org-mode,
              plain text and Word documents are read.
            </p>
            <div className="mt-3">
              <LibrarySection />
            </div>
          </section>

          <section className="mt-10">
            <SectionHeading>Difficulty tiers</SectionHeading>
            <p className="mt-1 text-xs text-ink-muted">
              Every task in the app runs at one of three difficulties. Choose
              which source handles each. If a tier is off or unusable, tasks
              fall through to the next available tier.
            </p>
            <div className="mt-3 space-y-3">
              {settings &&
                TIERS.map((tier) => (
                  <TierRow
                    key={tier}
                    tier={tier}
                    config={settings.tiers[tier]}
                    providers={settings.providers}
                    ollamaModels={ollama?.models ?? []}
                    onPatch={(patch) =>
                      void mutate(() =>
                        window.ipc.invoke("models:setTier", { tier, patch })
                      )
                    }
                  />
                ))}
            </div>
          </section>

          <section className="mt-10">
            <SectionHeading>Task routing</SectionHeading>
            <p className="mt-1 text-xs text-ink-muted">
              Which difficulty each kind of task counts as.
            </p>
            <div className="mt-3">
              {settings && (
                <FeatureTable
                  featureTiers={settings.featureTiers}
                  onChange={(featureId, tier: Tier) =>
                    void mutate(() =>
                      window.ipc.invoke("models:setFeatureTier", {
                        featureId,
                        tier,
                      })
                    )
                  }
                />
              )}
            </div>
          </section>

          <section className="mt-10">
            <SectionHeading>Agent</SectionHeading>
            <p className="mt-1 text-xs text-ink-muted">
              How Tasks-mode agents run: sandbox boundaries, web search, and
              external tools.
            </p>
            <div className="mt-3">
              <AgentSection />
            </div>
          </section>

          <section className="mt-10">
            <SectionHeading>This install</SectionHeading>
            <div className="mt-2">
              <Row label="App" value={versions ? versions.app : "…"} />
              <Row label="Electron" value={versions ? versions.electron : "…"} />
              <Row label="Node" value={versions ? versions.node : "…"} />
              <Row
                label="Database"
                value={
                  status === null ? "…" : status.dbOk ? "Ready" : "Not responding"
                }
              />
              <Row label="Data folder" value={status ? status.appDataPath : "…"} />
            </div>
          </section>

          <section className="mt-10">
            <SectionHeading>About</SectionHeading>
            <div className="mt-2">
              <Row label="Version" value={versions ? versions.app : "…"} />
              <Row label="Developer" value="Nav Virdi" />
              <LinkRow
                label="Website"
                href="https://liberated.studio"
                text="Liberated.Studio"
              />
              <LinkRow
                label="Email"
                href="mailto:nav@Liberated.Studio"
                text="nav@Liberated.Studio"
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
