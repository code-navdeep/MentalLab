import { useEffect, useState } from "react";
import { FolderPlus, RefreshCw, X } from "lucide-react";
import type { IndexProgress, LibraryFolderInfo } from "@mental-lab/shared";

export default function LibrarySection() {
  const [folders, setFolders] = useState<LibraryFolderInfo[]>([]);
  const [progress, setProgress] = useState<IndexProgress | null>(null);

  useEffect(() => {
    window.ipc.invoke("library:list", null).then(setFolders);
    const off = window.ipc.on("index:progress", (p) => {
      setProgress(p);
      if (p.phase === "idle") {
        window.ipc.invoke("library:list", null).then(setFolders);
      }
    });
    return off;
  }, []);

  async function handleAdd() {
    const result = await window.ipc.invoke("library:addFolder", null);
    setFolders(result.folders);
  }

  async function handleRemove(folderId: number) {
    setFolders(await window.ipc.invoke("library:removeFolder", { folderId }));
  }

  return (
    <div>
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        {folders.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-ink-muted">
            No folders yet. Add the folders where your notes and papers live.
          </p>
        )}
        {folders.map((folder, i) => (
          <div
            key={folder.id}
            className={`flex items-center justify-between gap-4 px-4 py-3 ${
              i > 0 ? "border-t border-line" : ""
            }`}
          >
            <div className="min-w-0">
              <p className="truncate font-mono text-xs text-ink">
                {folder.path}
              </p>
              <p className="mt-0.5 text-xs text-ink-muted">
                {folder.indexedCount} of {folder.fileCount} indexed
                {folder.errorCount > 0 && (
                  <span className="text-amber">
                    {" "}
                    · {folder.errorCount} failed
                  </span>
                )}
                {folder.unreadableCount > 0 && (
                  <span
                    className="text-amber"
                    title={`Not readable by the app:\n${folder.unreadablePaths.join("\n")}${folder.unreadableCount > folder.unreadablePaths.length ? "\n…" : ""}`}
                  >
                    {" "}
                    · {folder.unreadableCount} unreadable
                  </span>
                )}
              </p>
            </div>
            <button
              onClick={() => void handleRemove(folder.id)}
              aria-label={`Remove ${folder.path} from library`}
              className="rounded-md p-1.5 text-ink-muted hover:text-ink"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => void handleAdd()}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white"
        >
          <FolderPlus size={14} />
          Add folder
        </button>
        <button
          onClick={() => void window.ipc.invoke("library:reindex", null)}
          className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs text-ink-muted hover:text-ink"
        >
          <RefreshCw size={14} />
          Re-scan
        </button>
        {progress && progress.phase !== "idle" && (
          <span className="font-mono text-xs text-ink-muted">
            {progress.phase === "scanning"
              ? "Scanning…"
              : `Indexing ${progress.done + 1}/${progress.total} — ${progress.currentFile ?? ""}`}
          </span>
        )}
      </div>
    </div>
  );
}
