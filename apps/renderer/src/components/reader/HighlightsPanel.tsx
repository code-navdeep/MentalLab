import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { Highlight } from "@mental-lab/shared";

const COLOR_DOT: Record<string, string> = {
  yellow: "#f7e36b",
  blue: "#9db8f7",
  green: "#9fdcb2",
  pink: "#f2aecb",
};

interface HighlightsPanelProps {
  highlights: Highlight[];
  onJump: (highlight: Highlight) => void;
  onSaveNote: (highlightId: number, note: string | null) => void;
  onDelete: (highlightId: number) => void;
}

export default function HighlightsPanel({
  highlights,
  onJump,
  onSaveNote,
  onDelete,
}: HighlightsPanelProps) {
  const [editing, setEditing] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  if (highlights.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-xs text-ink-muted">
        Select text in the paper to highlight it. Highlights collect here.
      </p>
    );
  }

  return (
    <div className="h-full space-y-2 overflow-y-auto px-3 py-3">
      {highlights.map((h) => (
        <div key={h.id} className="rounded-lg border border-line bg-surface p-2.5">
          <button
            onClick={() => onJump(h)}
            className="flex w-full items-start gap-2 text-left"
          >
            <span
              className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: COLOR_DOT[h.color] }}
            />
            <span className="min-w-0">
              <span className="line-clamp-3 text-xs leading-relaxed text-ink">
                “{h.selectedText}”
              </span>
              <span className="mt-0.5 block font-mono text-[10px] text-ink-muted">
                page {h.page}
              </span>
            </span>
          </button>

          {editing === h.id ? (
            <div className="mt-2">
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                rows={2}
                autoFocus
                placeholder="Note…"
                className="w-full rounded-md border border-line bg-paper px-2 py-1.5 text-xs text-ink"
              />
              <div className="mt-1 flex gap-1.5">
                <button
                  onClick={() => {
                    onSaveNote(h.id, noteDraft.trim() || null);
                    setEditing(null);
                  }}
                  className="rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-white"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditing(null)}
                  className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-muted"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-1.5 flex items-center justify-between gap-2">
              {h.note ? (
                <p className="min-w-0 flex-1 select-text text-[11px] italic leading-snug text-ink-muted">
                  {h.note}
                </p>
              ) : (
                <span />
              )}
              <div className="flex shrink-0 gap-1">
                <button
                  onClick={() => {
                    setEditing(h.id);
                    setNoteDraft(h.note ?? "");
                  }}
                  className="rounded px-1.5 py-0.5 text-[11px] text-ink-muted hover:text-ink"
                >
                  {h.note ? "Edit" : "Add note"}
                </button>
                <button
                  onClick={() => onDelete(h.id)}
                  aria-label="Delete highlight"
                  className="rounded p-1 text-ink-muted hover:text-amber"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
