import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, BookMarked, FileUp, Pin } from "lucide-react";
import type {
  Highlight,
  HighlightColor,
  PaperDetail,
  PaperMeta,
} from "@mental-lab/shared";
import PdfViewer, {
  type JumpRequest,
  type SelectionInfo,
} from "../components/reader/PdfViewer";
import SelectionMenu from "../components/reader/SelectionMenu";
import CopilotPanel, {
  type CopilotPrefill,
} from "../components/reader/CopilotPanel";
import HighlightsPanel from "../components/reader/HighlightsPanel";
import NotesPanel from "../components/reader/NotesPanel";
import RowActions from "../components/RowActions";

type PanelTab = "copilot" | "highlights" | "notes";

interface ReaderModeProps {
  externalTarget: { paperId: number; page: number | null; nonce: number } | null;
  onOpenTask: (taskId: number) => void;
}

export default function ReaderMode({
  externalTarget,
  onOpenTask,
}: ReaderModeProps) {
  const [papers, setPapers] = useState<PaperMeta[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [detail, setDetail] = useState<PaperDetail | null>(null);
  const [tab, setTab] = useState<PanelTab>("copilot");
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [jump, setJump] = useState<JumpRequest | null>(null);
  const [prefill, setPrefill] = useState<CopilotPrefill | null>(null);
  const [importing, setImporting] = useState(false);
  const [vaultExport, setVaultExport] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const refreshList = useCallback(() => {
    void window.ipc.invoke("reader:listPapers", null).then(setPapers);
  }, []);

  async function togglePin(p: PaperMeta) {
    setPapers(
      await window.ipc.invoke("reader:setPaperPinned", {
        paperId: p.id,
        pinned: !p.pinned,
      })
    );
  }

  async function deletePaper(id: number) {
    setPapers(await window.ipc.invoke("reader:deletePaper", { paperId: id }));
  }

  async function commitRename() {
    if (renamingId === null) return;
    const id = renamingId;
    const title = renameDraft.trim();
    setRenamingId(null);
    if (!title) return;
    setPapers(
      await window.ipc.invoke("reader:renamePaper", { paperId: id, title })
    );
  }

  useEffect(refreshList, [refreshList]);

  // Cross-mode arrival (e.g. a Chat citation): open the paper, jump to page.
  const consumedTarget = useRef(0);
  useEffect(() => {
    if (!externalTarget || externalTarget.nonce === consumedTarget.current) {
      return;
    }
    consumedTarget.current = externalTarget.nonce;
    void openPaper(externalTarget.paperId).then(() => {
      if (externalTarget.page !== null) {
        setJump({ nonce: Date.now(), page: externalTarget.page });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalTarget]);

  useEffect(() => {
    const off = window.ipc.on("paper:status", ({ paperId }) => {
      refreshList();
      if (paperId === activeId) {
        void window.ipc
          .invoke("reader:getPaper", { paperId })
          .then(setDetail);
      }
    });
    return off;
  }, [activeId, refreshList]);

  async function openPaper(paperId: number) {
    setActiveId(paperId);
    setDetail(null);
    setTab("copilot");
    setSelection(null);
    setDetail(await window.ipc.invoke("reader:getPaper", { paperId }));
  }

  async function handleImport() {
    setImporting(true);
    try {
      const { paperId } = await window.ipc.invoke("reader:importPaper", null);
      refreshList();
      if (paperId !== null) await openPaper(paperId);
    } finally {
      setImporting(false);
    }
  }

  async function addHighlightFromSelection(
    color: HighlightColor,
    openNotes: boolean
  ) {
    if (!selection || activeId === null || !detail) return;
    const highlight = await window.ipc.invoke("reader:addHighlight", {
      paperId: activeId,
      page: selection.page,
      selectedText: selection.text,
      color,
      note: null,
      rects: selection.rects,
    });
    setDetail({ ...detail, highlights: [...detail.highlights, highlight] });
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    if (openNotes) setTab("highlights");
  }

  function askAboutSelection() {
    if (!selection) return;
    setPrefill({ nonce: Date.now(), text: `> “${selection.text}”\n\n` });
    setTab("copilot");
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }

  async function researchSelection() {
    if (!selection || !detail) return;
    const prompt = `Research this passage from the paper "${detail.meta.title}" — find related work, context, and explanations, and write a short brief:\n\n"${selection.text}"`;
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    const { taskId } = await window.ipc.invoke("tasks:run", { prompt });
    onOpenTask(taskId);
  }

  async function saveHighlightNote(highlightId: number, note: string | null) {
    if (!detail) return;
    const updated = await window.ipc.invoke("reader:updateHighlight", {
      highlightId,
      note,
    });
    setDetail({
      ...detail,
      highlights: detail.highlights.map((h) =>
        h.id === highlightId ? updated : h
      ),
    });
  }

  async function deleteHighlight(highlightId: number) {
    if (!detail) return;
    await window.ipc.invoke("reader:removeHighlight", { highlightId });
    setDetail({
      ...detail,
      highlights: detail.highlights.filter((h) => h.id !== highlightId),
    });
  }

  function jumpToHighlight(h: Highlight) {
    setJump({ nonce: Date.now(), page: h.page, rects: h.rects });
  }

  // ------------------------------------------------------------------
  // Library view
  // ------------------------------------------------------------------
  if (activeId === null || detail === null) {
    return (
      <div className="flex h-full flex-col">
        <div className="titlebar-drag h-12 shrink-0" />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-8 pb-16">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent-ink">
                  Reader
                </p>
                <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
                  Papers
                </h1>
              </div>
              <button
                onClick={() => void handleImport()}
                disabled={importing}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                <FileUp size={15} />
                {importing ? "Importing…" : "Import PDF"}
              </button>
            </div>

            {papers.length === 0 && (
              <p className="mt-16 text-center text-sm text-ink-muted">
                Import a paper to read it with the copilot beside you.
              </p>
            )}

            <div className="mt-8 grid grid-cols-2 gap-3">
              {papers.map((p) => (
                <div key={p.id} className="group relative">
                  <button
                    onClick={() => void openPaper(p.id)}
                    className="h-full w-full rounded-xl border border-line bg-surface p-4 text-left transition-colors hover:border-accent"
                  >
                    {renamingId === p.id ? (
                      <input
                        autoFocus
                        value={renameDraft}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void commitRename();
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        onBlur={() => void commitRename()}
                        className="w-full rounded-md border border-accent bg-paper px-2 py-1 font-display text-base font-semibold text-ink"
                      />
                    ) : (
                      <p className="line-clamp-2 pr-6 font-display text-base font-semibold leading-snug text-ink">
                        {p.pinned && (
                          <Pin
                            size={13}
                            className="mr-1 inline-block text-accent-ink"
                          />
                        )}
                        {p.title}
                      </p>
                    )}
                    <p className="mt-2 font-mono text-[11px] text-ink-muted">
                      {p.numPages} pages
                      {p.status === "processing" && (
                        <span className="text-accent-ink"> · reading…</span>
                      )}
                      {p.status === "error" && (
                        <span className="text-amber"> · brief failed</span>
                      )}
                    </p>
                  </button>
                  <RowActions
                    pinned={p.pinned}
                    onTogglePin={() => void togglePin(p)}
                    onRename={() => {
                      setRenamingId(p.id);
                      setRenameDraft(p.title);
                    }}
                    onDelete={() => void deletePaper(p.id)}
                    className="opacity-0 group-hover:opacity-100"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Paper view
  // ------------------------------------------------------------------
  return (
    <div className="flex h-full flex-col">
      <div className="titlebar-drag flex h-12 shrink-0 items-center gap-3 border-b border-line pl-4 pr-2">
        <button
          onClick={() => {
            setActiveId(null);
            setDetail(null);
            refreshList();
          }}
          aria-label="Back to papers"
          className="rounded-md p-1.5 text-ink-muted hover:text-ink"
        >
          <ArrowLeft size={16} />
        </button>
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
          {detail.meta.title}
        </p>
        {vaultExport && (
          <span className="shrink-0 font-mono text-[11px] text-ok">
            {vaultExport}
          </span>
        )}
        <button
          onClick={() =>
            void (async () => {
              const result = await window.ipc.invoke("reader:sendToVault", {
                paperId: detail.meta.id,
              });
              setVaultExport(
                result.ok ? `→ ${result.noteName}` : (result.error ?? "failed")
              );
              setTimeout(() => setVaultExport(null), 4000);
            })()
          }
          title="Write highlights, notes and overview into the vault as a literature note"
          className="flex shrink-0 items-center gap-1 rounded-md border border-line px-2 py-1 font-mono text-[11px] text-ink-muted hover:border-accent hover:text-accent-ink"
        >
          <BookMarked size={12} />
          To vault
        </button>
        <div className="flex shrink-0 gap-1">
          {(["copilot", "highlights", "notes"] as PanelTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide transition-colors ${
                tab === t
                  ? "bg-accent-wash text-accent-ink"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <PdfViewer
            paperId={detail.meta.id}
            highlights={detail.highlights}
            jump={jump}
            onSelection={setSelection}
          />
          {selection && (
            <SelectionMenu
              x={selection.menuX}
              y={selection.menuY}
              onHighlight={(color) =>
                void addHighlightFromSelection(color, false)
              }
              onNote={() => void addHighlightFromSelection("yellow", true)}
              onAsk={askAboutSelection}
              onResearch={() => void researchSelection()}
            />
          )}
        </div>

        <div className="w-[26rem] shrink-0 border-l border-line">
          {tab === "copilot" && (
            <CopilotPanel
              paperId={detail.meta.id}
              status={detail.meta.status}
              overview={detail.overview}
              starterQuestions={detail.starterQuestions}
              initialMessages={detail.messages}
              prefill={prefill}
              onJump={(page, quote) =>
                setJump({ nonce: Date.now(), page, quote })
              }
            />
          )}
          {tab === "highlights" && (
            <HighlightsPanel
              highlights={detail.highlights}
              onJump={jumpToHighlight}
              onSaveNote={(id, note) => void saveHighlightNote(id, note)}
              onDelete={(id) => void deleteHighlight(id)}
            />
          )}
          {tab === "notes" && (
            <NotesPanel
              key={detail.meta.id}
              paperId={detail.meta.id}
              initialContent={detail.notes}
            />
          )}
        </div>
      </div>
    </div>
  );
}
