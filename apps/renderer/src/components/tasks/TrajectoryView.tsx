import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Cog,
  Sparkles,
} from "lucide-react";
import type { TrajectoryStep, UserRequest } from "@mental-lab/shared";

function summarizeArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    if (s === undefined) continue;
    parts.push(`${k}: ${s.length > 60 ? s.slice(0, 57) + "…" : s}`);
  }
  const joined = parts.join(", ");
  return joined.length > 140 ? joined.slice(0, 137) + "…" : joined;
}

function ToolPair({
  call,
  result,
}: {
  call: Extract<TrajectoryStep, { type: "tool_call" }>;
  result: Extract<TrajectoryStep, { type: "tool_result" }> | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-line bg-surface">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {open ? (
          <ChevronDown size={13} className="shrink-0 text-ink-muted" />
        ) : (
          <ChevronRight size={13} className="shrink-0 text-ink-muted" />
        )}
        <Cog
          size={13}
          className={`shrink-0 ${result ? "text-ink-muted" : "animate-spin text-accent-ink"}`}
        />
        <span className="font-mono text-xs text-ink">{call.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-muted">
          {summarizeArgs(call.args)}
        </span>
      </button>
      {open && (
        <div className="border-t border-line px-3 py-2">
          <pre className="select-text overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-ink-muted">
            {JSON.stringify(call.args, null, 2)}
          </pre>
          {result && (
            <pre className="mt-2 max-h-72 select-text overflow-auto whitespace-pre-wrap border-t border-line pt-2 font-mono text-[11px] leading-relaxed text-ink">
              {result.result}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function ThoughtBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      onClick={() => setOpen(!open)}
      className="block w-full text-left"
      title={open ? "Collapse thinking" : "Show thinking"}
    >
      <p
        className={`flex items-start gap-1.5 text-xs italic leading-relaxed text-ink-muted ${open ? "" : "line-clamp-2"}`}
      >
        <Sparkles size={12} className="mt-0.5 shrink-0" />
        <span className="select-text">{text}</span>
      </p>
    </button>
  );
}

function RequestCard({ request }: { request: UserRequest }) {
  const [text, setText] = useState("");
  const [answered, setAnswered] = useState(false);

  async function respond(approved: boolean, response: string | null) {
    setAnswered(true);
    await window.ipc.invoke("tasks:respond", {
      requestId: request.requestId,
      approved,
      response,
    });
  }

  if (answered) return null;

  return (
    <div className="rounded-xl border-2 border-accent bg-surface p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-accent-ink">
        {request.kind === "confirm" ? "Approval needed" : "The agent asks"}
      </p>
      <p className="mt-1.5 text-sm font-medium text-ink">{request.title}</p>
      {request.description && (
        <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-ink-muted">
          {request.description}
        </p>
      )}
      {request.command && (
        <pre className="mt-2 select-text overflow-x-auto rounded-md bg-paper px-3 py-2 font-mono text-xs text-ink">
          {request.command}
        </pre>
      )}

      {request.kind === "confirm" ? (
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => void respond(true, null)}
            className="rounded-md bg-accent px-3.5 py-1.5 text-xs font-medium text-white"
          >
            Allow
          </button>
          <button
            onClick={() => void respond(false, null)}
            className="rounded-md border border-line px-3.5 py-1.5 text-xs text-ink-muted hover:text-ink"
          >
            Deny
          </button>
        </div>
      ) : (
        <div className="mt-3">
          {request.options.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {request.options.map((option) => (
                <button
                  key={option}
                  onClick={() => void respond(true, option)}
                  className="rounded-md border border-line px-3 py-1.5 text-xs text-ink transition-colors hover:border-accent hover:text-accent-ink"
                >
                  {option}
                </button>
              ))}
            </div>
          )}
          {(request.textInput || request.options.length === 0) && (
            <div className="mt-2 flex gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && text.trim()) {
                    void respond(true, text.trim());
                  }
                }}
                placeholder="Type your answer…"
                className="min-w-0 flex-1 rounded-md border border-line bg-paper px-2.5 py-1.5 text-xs text-ink"
              />
              <button
                onClick={() => text.trim() && void respond(true, text.trim())}
                className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white"
              >
                Send
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface TrajectoryViewProps {
  trajectory: TrajectoryStep[];
  pendingRequest: UserRequest | null;
  running: boolean;
}

export default function TrajectoryView({
  trajectory,
  pendingRequest,
  running,
}: TrajectoryViewProps) {
  // Pair tool calls with their results for compact rendering.
  const items: React.ReactNode[] = [];
  const resultsByCall = new Map<
    string,
    Extract<TrajectoryStep, { type: "tool_result" }>
  >();
  for (const step of trajectory) {
    if (step.type === "tool_result") resultsByCall.set(step.callId, step);
  }

  trajectory.forEach((step, i) => {
    switch (step.type) {
      case "user":
        items.push(
          <div key={i} className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent-wash px-4 py-2.5">
              <p className="select-text whitespace-pre-wrap text-sm leading-relaxed text-ink">
                {step.text}
              </p>
            </div>
          </div>
        );
        break;
      case "thought":
        items.push(<ThoughtBlock key={i} text={step.text} />);
        break;
      case "text":
        items.push(
          <div key={i} className="md">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {step.text}
            </ReactMarkdown>
          </div>
        );
        break;
      case "tool_call":
        items.push(
          <ToolPair
            key={i}
            call={step}
            result={resultsByCall.get(step.callId) ?? null}
          />
        );
        break;
      case "error":
        items.push(
          <p
            key={i}
            className="flex items-start gap-1.5 rounded-md border border-amber/40 bg-surface px-3 py-2 font-mono text-xs text-amber"
          >
            <CircleAlert size={13} className="mt-0.5 shrink-0" />
            <span className="select-text">{step.message}</span>
          </p>
        );
        break;
      default:
        break;
    }
  });

  return (
    <div className="space-y-3">
      {items}
      {pendingRequest && <RequestCard request={pendingRequest} />}
      {running && !pendingRequest && (
        <span className="inline-block h-4 w-1.5 animate-pulse rounded-sm bg-accent" />
      )}
    </div>
  );
}
