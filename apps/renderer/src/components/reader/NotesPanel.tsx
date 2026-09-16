import { useEffect, useRef, useState } from "react";

interface NotesPanelProps {
  paperId: number;
  initialContent: string;
}

export default function NotesPanel({ paperId, initialContent }: NotesPanelProps) {
  const [content, setContent] = useState(initialContent);
  const [saved, setSaved] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function handleChange(value: string) {
    setContent(value);
    setSaved(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void window.ipc
        .invoke("reader:saveNotes", { paperId, content: value })
        .then(() => setSaved(true));
    }, 800);
  }

  return (
    <div className="flex h-full flex-col">
      <textarea
        value={content}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Notes on this paper — markdown welcome…"
        className="min-h-0 flex-1 resize-none bg-transparent px-4 py-3 text-xs leading-relaxed text-ink placeholder:text-ink-muted focus:outline-none"
      />
      <p className="shrink-0 border-t border-line px-4 py-1.5 font-mono text-[10px] text-ink-muted">
        {saved ? "Saved" : "Saving…"}
      </p>
    </div>
  );
}
