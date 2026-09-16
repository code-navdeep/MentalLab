import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink } from "lucide-react";
import type { Citation } from "@mental-lab/shared";

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  citations: Citation[] | null;
  streaming?: boolean;
  onOpenPaper?: (paperId: number, page: number | null) => void;
}

export default function MessageBubble({
  role,
  content,
  citations,
  streaming = false,
  onOpenPaper,
}: MessageBubbleProps) {
  const [openCitation, setOpenCitation] = useState<number | null>(null);

  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-accent-wash px-4 py-2.5">
          <p className="select-text whitespace-pre-wrap text-sm leading-relaxed text-ink">
            {content}
          </p>
        </div>
      </div>
    );
  }

  const selected = citations?.find((c) => c.n === openCitation) ?? null;

  return (
    <div className="max-w-[92%]">
      <div className="md">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
      {streaming && (
        <span className="mt-1 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-accent" />
      )}

      {citations && citations.length > 0 && (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
              Sources
            </span>
            {citations.map((c) => (
              <button
                key={c.n}
                onClick={() =>
                  setOpenCitation(openCitation === c.n ? null : c.n)
                }
                className={`rounded-md border px-1.5 py-0.5 font-mono text-[11px] transition-colors ${
                  openCitation === c.n
                    ? "border-accent bg-accent-wash text-accent-ink"
                    : "border-line text-ink-muted hover:border-accent hover:text-accent-ink"
                }`}
                title={c.relPath}
              >
                [{c.n}]
              </button>
            ))}
          </div>

          {selected && (
            <div className="mt-2 rounded-lg border border-line bg-surface p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 truncate font-mono text-xs text-ink">
                  {selected.relPath}
                  {selected.page !== null && (
                    <span className="text-ink-muted"> · page {selected.page}</span>
                  )}
                </p>
                <button
                  onClick={() =>
                    void (async () => {
                      // Imported papers open inside Reader at the cited page;
                      // everything else opens with the system default app.
                      const { paperId } = await window.ipc.invoke(
                        "reader:findByPath",
                        { path: selected.path }
                      );
                      if (paperId !== null && onOpenPaper) {
                        onOpenPaper(paperId, selected.page);
                      } else {
                        await window.ipc.invoke("library:openFile", {
                          path: selected.path,
                        });
                      }
                    })()
                  }
                  className="flex shrink-0 items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-ink-muted hover:text-ink"
                >
                  <ExternalLink size={11} />
                  Open
                </button>
              </div>
              <p className="mt-2 select-text text-xs leading-relaxed text-ink-muted">
                {selected.snippet}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
