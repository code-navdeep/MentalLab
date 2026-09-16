import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import type { AgentConfigPublic, SandboxSettingsPublic } from "@mental-lab/shared";
import Switch from "./Switch";

function PathListEditor({
  label,
  hint,
  values,
  onSave,
}: {
  label: string;
  hint: string;
  values: string[];
  onSave: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState(values.join("\n"));
  useEffect(() => setDraft(values.join("\n")), [values]);

  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-ink">{label}</p>
      <p className="mt-0.5 text-[11px] text-ink-muted">{hint}</p>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const next = draft
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
          if (JSON.stringify(next) !== JSON.stringify(values)) onSave(next);
        }}
        rows={Math.min(8, Math.max(3, draft.split("\n").length))}
        className="mt-1.5 w-full resize-y rounded-md border border-line bg-paper px-2.5 py-2 font-mono text-[11px] leading-relaxed text-ink"
      />
    </div>
  );
}

export default function AgentSection() {
  const [sandbox, setSandbox] = useState<SandboxSettingsPublic | null>(null);
  const [config, setConfig] = useState<AgentConfigPublic | null>(null);
  const [braveDraft, setBraveDraft] = useState("");
  const [mcpForm, setMcpForm] = useState({ name: "", command: "" });

  useEffect(() => {
    void window.ipc.invoke("sandbox:getSettings", null).then(setSandbox);
    void window.ipc.invoke("agent:getConfig", null).then(setConfig);
  }, []);

  function saveSandbox(patch: Parameters<typeof Object.assign>[1]) {
    void window.ipc.invoke("sandbox:setSettings", patch).then(setSandbox);
  }

  async function addMcpServer() {
    if (!config || !mcpForm.name.trim() || !mcpForm.command.trim()) return;
    const [command, ...args] = mcpForm.command.trim().split(/\s+/);
    setConfig(
      await window.ipc.invoke("agent:setConfig", {
        mcpServers: [
          ...config.mcpServers,
          { name: mcpForm.name.trim(), command: command!, args },
        ],
      })
    );
    setMcpForm({ name: "", command: "" });
  }

  if (!sandbox || !config) return null;

  return (
    <div className="space-y-4">
      {/* Sandbox */}
      <div className="rounded-xl border border-line bg-surface p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-ink">Command sandbox</p>
            <p
              className={`mt-0.5 font-mono text-xs ${sandbox.supported ? "text-ok" : "text-amber"}`}
            >
              {sandbox.supported
                ? "Seatbelt available on this Mac"
                : "Not supported on this system — all commands will ask first"}
            </p>
          </div>
          <Switch
            checked={sandbox.enabled}
            onChange={(enabled) => saveSandbox({ enabled })}
            label="Use the command sandbox"
          />
        </div>
        <PathListEditor
          label="Writable folders"
          hint="Sandboxed commands can write only here (one path per line)."
          values={sandbox.allowedWritePaths}
          onSave={(allowedWritePaths) => saveSandbox({ allowedWritePaths })}
        />
        <PathListEditor
          label="Protected paths"
          hint="Reading these always asks first — keys, credentials, histories."
          values={sandbox.deniedReadPaths}
          onSave={(deniedReadPaths) => saveSandbox({ deniedReadPaths })}
        />
        <PathListEditor
          label="Allowed network domains"
          hint="Sandboxed commands can reach only these hosts."
          values={sandbox.allowedDomains}
          onSave={(allowedDomains) => saveSandbox({ allowedDomains })}
        />
      </div>

      {/* Web search */}
      <div className="rounded-xl border border-line bg-surface p-4">
        <p className="text-sm font-medium text-ink">Web search</p>
        <p className="mt-0.5 text-xs text-ink-muted">
          The agent's search_web tool uses Brave Search. Without a key, the
          agent can still read pages you point it to.
        </p>
        <div className="mt-3 flex items-center gap-2">
          {config.braveKeySet ? (
            <>
              <span className="font-mono text-xs text-ok">API key saved</span>
              <button
                onClick={() =>
                  void window.ipc
                    .invoke("agent:setConfig", { braveKey: null })
                    .then(setConfig)
                }
                className="ml-auto rounded-md border border-line px-2.5 py-1 text-xs text-ink-muted hover:text-ink"
              >
                Remove key
              </button>
            </>
          ) : (
            <>
              <input
                type="password"
                value={braveDraft}
                onChange={(e) => setBraveDraft(e.target.value)}
                placeholder="Brave Search API key"
                className="min-w-0 flex-1 rounded-md border border-line bg-paper px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-ink-muted"
              />
              <button
                onClick={() => {
                  if (braveDraft.trim()) {
                    void window.ipc
                      .invoke("agent:setConfig", { braveKey: braveDraft.trim() })
                      .then(setConfig);
                    setBraveDraft("");
                  }
                }}
                disabled={!braveDraft.trim()}
                className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              >
                Save
              </button>
            </>
          )}
        </div>
      </div>

      {/* MCP servers */}
      <div className="rounded-xl border border-line bg-surface p-4">
        <p className="text-sm font-medium text-ink">MCP servers</p>
        <p className="mt-0.5 text-xs text-ink-muted">
          External tools the agent can use, spoken over the Model Context
          Protocol. Each entry is a command that starts the server.
        </p>
        <div className="mt-3 space-y-2">
          {config.mcpServers.map((server) => (
            <div
              key={server.name}
              className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2"
            >
              <div className="min-w-0">
                <p className="font-mono text-xs text-ink">{server.name}</p>
                <p className="truncate font-mono text-[11px] text-ink-muted">
                  {server.command} {server.args.join(" ")}
                </p>
              </div>
              <button
                onClick={() =>
                  void window.ipc
                    .invoke("agent:setConfig", {
                      mcpServers: config.mcpServers.filter(
                        (s) => s.name !== server.name
                      ),
                    })
                    .then(setConfig)
                }
                aria-label={`Remove ${server.name}`}
                className="rounded-md p-1.5 text-ink-muted hover:text-amber"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <input
              value={mcpForm.name}
              onChange={(e) => setMcpForm({ ...mcpForm, name: e.target.value })}
              placeholder="name"
              className="w-28 rounded-md border border-line bg-paper px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-ink-muted"
            />
            <input
              value={mcpForm.command}
              onChange={(e) =>
                setMcpForm({ ...mcpForm, command: e.target.value })
              }
              placeholder="command and args (e.g. npx -y @modelcontextprotocol/server-filesystem ~)"
              className="min-w-0 flex-1 rounded-md border border-line bg-paper px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-ink-muted"
            />
            <button
              onClick={() => void addMcpServer()}
              disabled={!mcpForm.name.trim() || !mcpForm.command.trim()}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
