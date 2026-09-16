import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from "lucide-react";

interface RowActionsProps {
  /** Present → show a Pin/Unpin item reflecting this state. */
  pinned?: boolean;
  onTogglePin?: () => void;
  /** Present → show a Rename item (parent owns the inline editor). */
  onRename?: () => void;
  onDelete: () => void;
  /** Extra classes for the trigger button (e.g. group-hover visibility). */
  className?: string;
}

/**
 * Hover "…" menu for list rows: Pin/Unpin, Rename, Delete (two-step confirm).
 * Render inside a `relative` row container.
 */
export default function RowActions({
  pinned,
  onTogglePin,
  onRename,
  onDelete,
  className = "",
}: RowActionsProps) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirming(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const item =
    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent-wash";

  return (
    <div ref={ref} className="absolute right-1 top-1/2 -translate-y-1/2">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
          setConfirming(false);
        }}
        aria-label="Row actions"
        className={`rounded p-1 text-ink-muted hover:bg-surface hover:text-ink ${className}`}
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-36 rounded-md border border-line bg-surface p-1 shadow-xl">
          {onTogglePin && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onTogglePin();
              }}
              className={`${item} text-ink`}
            >
              {pinned ? <PinOff size={13} /> : <Pin size={13} />}
              {pinned ? "Unpin" : "Pin to top"}
            </button>
          )}
          {onRename && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onRename();
              }}
              className={`${item} text-ink`}
            >
              <Pencil size={13} />
              Rename
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (!confirming) {
                setConfirming(true);
                return;
              }
              setOpen(false);
              setConfirming(false);
              onDelete();
            }}
            className={`${item} text-amber`}
          >
            <Trash2 size={13} />
            {confirming ? "Confirm delete" : "Delete"}
          </button>
        </div>
      )}
    </div>
  );
}
