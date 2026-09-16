import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { EvidenceCite, PaperMessage } from "@mental-lab/shared";

interface LocalMessage {
  key: string;
  role: "user" | "assistant";
  content: string;
  evidence: EvidenceCite[] | null;
  streaming?: boolean;
}

export interface CopilotPrefill {
  nonce: number;
  text: string;
}

interface CopilotPanelProps {
  paperId: number;
  status: "processing" | "ready" | "error";
  overview: string | null;
  starterQuestions: string[];
  initialMessages: PaperMessage[];
  prefill: CopilotPrefill | null;
  onJump: (page: number, quote: string) => void;
}

export default function CopilotPanel({
  paperId,
  status,
  overview,
  starterQuestions,
  initialMessages,
  prefill,
  onJump,
}: CopilotPanelProps) {
  const [thread, setThread] = useState<LocalMessage[]>(() =>
    initialMessages.map((m) => ({
      key: `db-${m.id}`,
      role: m.role,
      content: m.content,
      evidence: m.evidence,
    }))
  );
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const consumedPrefill = useRef(0);

  useEffect(() => {
    if (prefill && prefill.nonce !== consumedPrefill.current) {
      consumedPrefill.current = prefill.nonce;
      setDraft((d) => (d ? d + "\n\n" : "") + prefill.text);
      inputRef.current?.focus();
    }
  }, [prefill]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [thread]);

  async function ask(message: string) {
    if (!message.trim() || sending) return;
    setError(null);
    setSending(true);
    setDraft("");

    const requestId = crypto.randomUUID();
    const assistantKey = `stream-${requestId}`;
    setThread((t) => [
      ...t,
      {
        key: `user-${requestId}`,
        role: "user",
        content: message,
        evidence: null,
      },
      {
        key: assistantKey,
        role: "assistant",
        content: "",
        evidence: null,
        streaming: true,
      },
    ]);

    const offDelta = window.ipc.on("stream:delta", (p) => {
      if (p.requestId !== requestId) return;
      setThread((t) =>
        t.map((m) =>
          m.key === assistantKey ? { ...m, content: m.content + p.delta } : m
        )
      );
    });

    const result = await window.ipc.invoke("reader:askCopilot", {
      requestId,
      paperId,
      message,
    });
    offDelta();
    setSending(false);

    if (result.ok) {
      setThread((t) =>
        t.map((m) =>
          m.key === assistantKey
            ? { ...m, streaming: false, evidence: result.evidence }
            : m
        )
      );
    } else {
      setError(result.error ?? "Something went wrong");
      setThread((t) => t.filter((m) => m.key !== assistantKey));
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {/* Brief */}
        {status === "processing" && (
          <div className="rounded-lg border border-line bg-surface p-3">
            <p className="font-mono text-xs text-ink-muted">
              Reading the paper and writing a brief…
            </p>
          </div>
        )}
        {overview && thread.length === 0 && (
          <div className="rounded-lg border border-line bg-surface p-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-accent-ink">
              Brief
            </p>
            <p className="mt-1.5 select-text text-xs leading-relaxed text-ink">
              {overview}
            </p>
            {starterQuestions.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {starterQuestions.map((q) => (
                  <button
                    key={q}
                    onClick={() => void ask(q)}
                    className="block w-full rounded-md border border-line px-2.5 py-1.5 text-left text-xs text-ink-muted transition-colors hover:border-accent hover:text-accent-ink"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Thread */}
        <div className="mt-4 space-y-4">
          {thread.map((m) =>
            m.role === "user" ? (
              <div key={m.key} className="flex justify-end">
                <div className="max-w-[85%] rounded-xl rounded-br-sm bg-accent-wash px-3 py-2">
                  <p className="select-text whitespace-pre-wrap text-xs leading-relaxed text-ink">
                    {m.content}
                  </p>
                </div>
              </div>
            ) : (
              <div key={m.key}>
                <div className="md text-xs">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {m.content}
                  </ReactMarkdown>
                </div>
                {m.streaming && (
                  <span className="mt-1 inline-block h-3.5 w-1 animate-pulse rounded-sm bg-accent" />
                )}
                {m.evidence && m.evidence.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
                      Evidence
                    </span>
                    {m.evidence.map((e) => (
                      <button
                        key={e.n}
                        disabled={e.page === null}
                        onClick={() => e.page !== null && onJump(e.page, e.quote)}
                        title={
                          e.page === null
                            ? "Passage could not be located in the paper"
                            : `Page ${e.page}: “${e.quote.slice(0, 120)}”`
                        }
                        className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[11px] text-ink-muted transition-colors enabled:hover:border-accent enabled:hover:text-accent-ink disabled:opacity-40"
                      >
                        [{e.n}]
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          )}
          {error && (
            <p className="rounded-md border border-amber/40 bg-surface px-3 py-2 font-mono text-xs text-amber">
              {error}
            </p>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-line p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(draft);
              }
            }}
            rows={Math.min(5, Math.max(1, draft.split("\n").length))}
            placeholder="Ask about this paper…"
            className="min-w-0 flex-1 resize-none rounded-lg border border-line bg-paper px-3 py-2 text-xs text-ink placeholder:text-ink-muted focus:border-accent"
          />
          <button
            onClick={() => void ask(draft)}
            disabled={sending || !draft.trim()}
            className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white disabled:opacity-40"
          >
            {sending ? "…" : "Ask"}
          </button>
        </div>
      </div>
    </div>
  );
}
