import { useState } from "react";
import { Play, Plus, Trash2 } from "lucide-react";
import type { AutomationInfo } from "@mental-lab/shared";
import Switch from "../settings/Switch";

interface AutomationsPanelProps {
  automations: AutomationInfo[];
  onChanged: (list: AutomationInfo[]) => void;
  onOpenTask: (taskId: number) => void;
}

const EMPTY_FORM = { name: "", prompt: "", cron: "0 9 * * 1" };

export default function AutomationsPanel({
  automations,
  onChanged,
  onOpenTask,
}: AutomationsPanelProps) {
  const [editing, setEditing] = useState<number | null | "new">(null);
  const [form, setForm] = useState(EMPTY_FORM);

  function startEdit(a: AutomationInfo | null) {
    if (a) {
      setEditing(a.id);
      setForm({ name: a.name, prompt: a.prompt, cron: a.cron });
    } else {
      setEditing("new");
      setForm(EMPTY_FORM);
    }
  }

  async function save() {
    if (!form.name.trim() || !form.prompt.trim() || !form.cron.trim()) return;
    const existing =
      editing !== "new" ? automations.find((a) => a.id === editing) : null;
    onChanged(
      await window.ipc.invoke("automations:save", {
        id: editing === "new" ? null : (editing as number),
        name: form.name.trim(),
        prompt: form.prompt.trim(),
        cron: form.cron.trim(),
        enabled: existing?.enabled ?? true,
      })
    );
    setEditing(null);
  }

  return (
    <div className="mx-auto max-w-2xl px-8 py-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold text-ink">
          Automations
        </h2>
        <button
          onClick={() => startEdit(null)}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white"
        >
          <Plus size={13} />
          New automation
        </button>
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        Tasks the agent runs on a schedule, like “draft my weekly project
        update every Monday morning.”
      </p>

      {editing !== null && (
        <div className="mt-4 rounded-xl border border-accent bg-surface p-4">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Name"
            className="w-full rounded-md border border-line bg-paper px-2.5 py-1.5 text-sm text-ink"
          />
          <textarea
            value={form.prompt}
            onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            placeholder="What should the agent do on each run?"
            rows={3}
            className="mt-2 w-full resize-none rounded-md border border-line bg-paper px-2.5 py-1.5 text-xs text-ink"
          />
          <div className="mt-2 flex items-center gap-2">
            <input
              value={form.cron}
              onChange={(e) => setForm({ ...form, cron: e.target.value })}
              placeholder="Cron schedule"
              className="w-44 rounded-md border border-line bg-paper px-2.5 py-1.5 font-mono text-xs text-ink"
            />
            <span className="text-[11px] text-ink-muted">
              cron format — “0 9 * * 1” = Mondays 9:00
            </span>
            <div className="ml-auto flex gap-2">
              <button
                onClick={() => void save()}
                className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white"
              >
                Save
              </button>
              <button
                onClick={() => setEditing(null)}
                className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {automations.length === 0 && editing === null && (
          <p className="py-10 text-center text-sm text-ink-muted">
            No automations yet.
          </p>
        )}
        {automations.map((a) => (
          <div key={a.id} className="rounded-xl border border-line bg-surface p-3.5">
            <div className="flex items-center justify-between gap-3">
              <button
                onClick={() => startEdit(a)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="truncate text-sm font-medium text-ink">{a.name}</p>
                <p className="mt-0.5 font-mono text-[11px] text-ink-muted">
                  {a.cron}
                  {a.enabled && a.nextRunAt
                    ? ` · next ${new Date(a.nextRunAt).toLocaleString()}`
                    : a.enabled
                      ? " · schedule invalid"
                      : " · off"}
                </p>
              </button>
              <div className="flex shrink-0 items-center gap-2">
                {a.lastTaskId !== null && (
                  <button
                    onClick={() => onOpenTask(a.lastTaskId!)}
                    className="font-mono text-[11px] text-ink-muted underline-offset-2 hover:text-accent-ink hover:underline"
                  >
                    last run
                  </button>
                )}
                <button
                  onClick={() =>
                    void window.ipc
                      .invoke("automations:runNow", { automationId: a.id })
                      .then(({ taskId }) => onOpenTask(taskId))
                  }
                  aria-label={`Run ${a.name} now`}
                  title="Run now"
                  className="rounded-md p-1.5 text-ink-muted hover:text-accent-ink"
                >
                  <Play size={14} />
                </button>
                <Switch
                  checked={a.enabled}
                  label={`Enable ${a.name}`}
                  onChange={(enabled) =>
                    void window.ipc
                      .invoke("automations:save", {
                        id: a.id,
                        name: a.name,
                        prompt: a.prompt,
                        cron: a.cron,
                        enabled,
                      })
                      .then(onChanged)
                  }
                />
                <button
                  onClick={() =>
                    void window.ipc
                      .invoke("automations:delete", { automationId: a.id })
                      .then(onChanged)
                  }
                  aria-label={`Delete ${a.name}`}
                  className="rounded-md p-1.5 text-ink-muted hover:text-amber"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
