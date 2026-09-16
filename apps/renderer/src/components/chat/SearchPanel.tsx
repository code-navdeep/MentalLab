import type { SearchResult } from "@mental-lab/shared";

interface SearchPanelProps {
  query: string;
  results: SearchResult[] | null; // null = searching
}

export default function SearchPanel({ query, results }: SearchPanelProps) {
  return (
    <div className="mx-auto w-full max-w-2xl px-8 py-6">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent-ink">
        Search
      </p>
      <h2 className="mt-2 font-display text-2xl font-semibold text-ink">
        “{query}”
      </h2>

      {results === null && (
        <p className="mt-6 font-mono text-xs text-ink-muted">Searching…</p>
      )}
      {results !== null && results.length === 0 && (
        <p className="mt-6 text-sm text-ink-muted">
          Nothing in the library matches. Try different words, or add more
          folders in Settings.
        </p>
      )}

      <div className="mt-4 space-y-2">
        {results?.map((r) => (
          <button
            key={r.chunkId}
            onClick={() =>
              void window.ipc.invoke("library:openFile", { path: r.path })
            }
            className="block w-full rounded-lg border border-line bg-surface p-3 text-left transition-colors hover:border-accent"
          >
            <p className="truncate font-mono text-xs text-ink">
              {r.relPath}
              {r.page !== null && (
                <span className="text-ink-muted"> · page {r.page}</span>
              )}
            </p>
            <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-ink-muted">
              {r.snippet}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
