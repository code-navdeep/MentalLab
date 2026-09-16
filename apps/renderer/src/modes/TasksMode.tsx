import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock, FlaskConical, Plus } from "lucide-react";
import type {
  AutomationInfo,
  TaskMeta,
  TaskStatus,
  TrajectoryStep,
  UserRequest,
} from "@mental-lab/shared";
import TrajectoryView from "../components/tasks/TrajectoryView";
import RowActions from "../components/RowActions";
import AutomationsPanel from "../components/tasks/AutomationsPanel";

const EXAMPLES = [
  "Summarize the 5 newest PDFs in my Downloads folder into a markdown brief in /tmp",
  "Find the largest files in my Downloads folder and list them by size",
  "Create a weekly reading plan from the papers in my library",
];

type View = { kind: "new" } | { kind: "automations" } | { kind: "task"; id: number };

function statusDot(status: TaskStatus): string {
  switch (status) {
    case "running":
      return "bg-accent animate-pulse";
    case "waiting":
      return "bg-amber animate-pulse";
    case "done":
      return "bg-ok";
    case "error":
      return "bg-amber";
  }
}

interface TasksModeProps {
  externalTarget: { taskId: number; nonce: number } | null;
}

export default function TasksMode({ externalTarget }: TasksModeProps) {
  const [tasks, setTasks] = useState<TaskMeta[]>([]);
  const [automations, setAutomations] = useState<AutomationInfo[]>([]);
  const [view, setView] = useState<View>({ kind: "new" });
  const [trajectory, setTrajectory] = useState<TrajectoryStep[]>([]);
  const [status, setStatus] = useState<TaskStatus>("done");
  const [pendingRequest, setPendingRequest] = useState<UserRequest | null>(null);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const refreshTasks = useCallback(() => {
    void window.ipc.invoke("tasks:list", null).then(setTasks);
  }, []);

  async function deleteTaskRow(id: number) {
    setTasks(await window.ipc.invoke("tasks:delete", { taskId: id }));
    if (view.kind === "task" && view.id === id) setView({ kind: "new" });
  }

  useEffect(() => {
    refreshTasks();
    void window.ipc.invoke("automations:list", null).then(setAutomations);
  }, [refreshTasks]);

  // Live task events
  useEffect(() => {
    const offStep = window.ipc.on("task:step", ({ taskId, step }) => {
      const v = viewRef.current;
      if (v.kind === "task" && v.id === taskId) {
        setTrajectory((t) => [...t, step]);
      }
    });
    const offStatus = window.ipc.on("task:status", ({ taskId, status: s }) => {
      refreshTasks();
      const v = viewRef.current;
      if (v.kind === "task" && v.id === taskId) {
        setStatus(s);
        if (s !== "waiting") setPendingRequest(null);
      }
    });
    const offRequest = window.ipc.on("task:request", (request) => {
      const v = viewRef.current;
      if (v.kind === "task" && v.id === request.taskId) {
        setPendingRequest(request);
      }
    });
    return () => {
      offStep();
      offStatus();
      offRequest();
    };
  }, [refreshTasks]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [trajectory, pendingRequest]);

  // Cross-mode arrival (e.g. Reader's Research action)
  const consumedTarget = useRef(0);
  useEffect(() => {
    if (!externalTarget || externalTarget.nonce === consumedTarget.current) {
      return;
    }
    consumedTarget.current = externalTarget.nonce;
    refreshTasks();
    void openTask(externalTarget.taskId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalTarget]);

  const openTask = useCallback(async (taskId: number) => {
    setView({ kind: "task", id: taskId });
    setTrajectory([]);
    setPendingRequest(null);
    const detail = await window.ipc.invoke("tasks:get", { taskId });
    setTrajectory(detail.trajectory);
    setStatus(detail.meta.status);
    setPendingRequest(detail.pendingRequest);
  }, []);

  async function launch(prompt: string) {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    setDraft("");
    const { taskId } = await window.ipc.invoke("tasks:run", { prompt: trimmed });
    refreshTasks();
    await openTask(taskId);
  }

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-line">
        <div className="titlebar-drag h-12 shrink-0" />
        <div className="space-y-1 px-3 pb-3">
          <button
            onClick={() => setView({ kind: "new" })}
            className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
              view.kind === "new"
                ? "border-accent bg-accent-wash text-accent-ink"
                : "border-line bg-surface text-ink hover:border-accent"
            }`}
          >
            <Plus size={15} />
            New task
          </button>
          <button
            onClick={() => setView({ kind: "automations" })}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
              view.kind === "automations"
                ? "bg-accent-wash text-accent-ink"
                : "text-ink-muted hover:bg-surface hover:text-ink"
            }`}
          >
            <CalendarClock size={15} />
            Automations
            {automations.some((a) => a.enabled) && (
              <span className="ml-auto h-1.5 w-1.5 rounded-full bg-ok" />
            )}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          {tasks.map((t) => (
            <div key={t.id} className="group relative mb-0.5">
              <button
                onClick={() => void openTask(t.id)}
                className={`flex w-full items-center gap-2 rounded-md py-1.5 pl-2.5 pr-8 text-left transition-colors ${
                  view.kind === "task" && view.id === t.id
                    ? "bg-accent-wash"
                    : "hover:bg-surface"
                }`}
              >
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(t.status)}`}
                />
                <span
                  className={`min-w-0 flex-1 truncate text-[13px] ${
                    view.kind === "task" && view.id === t.id
                      ? "text-accent-ink"
                      : "text-ink-muted"
                  }`}
                >
                  {t.title}
                </span>
              </button>
              {t.status !== "running" && t.status !== "waiting" && (
                <RowActions
                  onDelete={() => void deleteTaskRow(t.id)}
                  className="opacity-0 group-hover:opacity-100"
                />
              )}
            </div>
          ))}
        </div>
      </aside>

      {/* Main */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="titlebar-drag h-12 shrink-0" />

        {view.kind === "automations" && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <AutomationsPanel
              automations={automations}
              onChanged={setAutomations}
              onOpenTask={(id) => void openTask(id)}
            />
          </div>
        )}

        {view.kind === "new" && (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
            <div className="w-full max-w-xl px-8 pb-16">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent-ink">
                Tasks
              </p>
              <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
                Delegate the busywork
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-ink-muted">
                The agent works on this Mac with sandboxed shell access — file
                work, research, reports. Anything needing full access asks you
                first.
              </p>
              <div className="mt-6 flex items-end gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void launch(draft);
                    }
                  }}
                  rows={Math.min(6, Math.max(2, draft.split("\n").length))}
                  placeholder="What should the agent do?"
                  className="min-w-0 flex-1 resize-none rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink placeholder:text-ink-muted focus:border-accent"
                />
                <button
                  onClick={() => void launch(draft)}
                  disabled={!draft.trim()}
                  className="rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
                >
                  Run
                </button>
              </div>
              <div className="mt-4 space-y-1.5">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    onClick={() => setDraft(example)}
                    className="block w-full rounded-md border border-line px-3 py-1.5 text-left text-xs text-ink-muted transition-colors hover:border-accent hover:text-accent-ink"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {view.kind === "task" && (
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-2xl px-8 py-4 pb-12">
              <TrajectoryView
                trajectory={trajectory}
                pendingRequest={pendingRequest}
                running={status === "running" || status === "waiting"}
              />
              {status === "done" && (
                <p className="mt-4 flex items-center gap-1.5 font-mono text-[11px] text-ok">
                  <FlaskConical size={12} />
                  task complete
                </p>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
