import { FlaskConical, MessageCircleQuestion, StickyNote } from "lucide-react";
import { HIGHLIGHT_COLORS, type HighlightColor } from "@mental-lab/shared";

const COLOR_SWATCH: Record<HighlightColor, string> = {
  yellow: "#f7e36b",
  blue: "#9db8f7",
  green: "#9fdcb2",
  pink: "#f2aecb",
};

interface SelectionMenuProps {
  x: number;
  y: number;
  onHighlight: (color: HighlightColor) => void;
  onNote: () => void;
  onAsk: () => void;
  onResearch: () => void;
}

export default function SelectionMenu({
  x,
  y,
  onHighlight,
  onNote,
  onAsk,
  onResearch,
}: SelectionMenuProps) {
  return (
    <div
      className="fixed z-50 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1.5 shadow-lg"
      style={{ left: x, top: Math.max(8, y - 48) }}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
    >
      {HIGHLIGHT_COLORS.map((color) => (
        <button
          key={color}
          onClick={() => onHighlight(color)}
          aria-label={`Highlight ${color}`}
          className="h-5 w-5 rounded-full border border-line transition-transform hover:scale-110"
          style={{ background: COLOR_SWATCH[color] }}
        />
      ))}
      <span className="mx-1 h-4 w-px bg-line" />
      <button
        onClick={onNote}
        className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-ink-muted hover:bg-accent-wash hover:text-accent-ink"
      >
        <StickyNote size={13} />
        Note
      </button>
      <button
        onClick={onAsk}
        className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-ink-muted hover:bg-accent-wash hover:text-accent-ink"
      >
        <MessageCircleQuestion size={13} />
        Ask
      </button>
      <button
        onClick={onResearch}
        title="Hand this passage to the Tasks agent to research"
        className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-ink-muted hover:bg-accent-wash hover:text-accent-ink"
      >
        <FlaskConical size={13} />
        Research
      </button>
    </div>
  );
}
