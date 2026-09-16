import { useCallback, useEffect, useRef, useState } from "react";
import { PenLine, Pin, Search, X } from "lucide-react";
import type {
  ChatMessage,
  Citation,
  ConversationMeta,
  LibraryFolderInfo,
  SearchResult,
  Tier,
} from "@mental-lab/shared";
import MessageBubble from "../components/chat/MessageBubble";
import SearchPanel from "../components/chat/SearchPanel";
import RowActions from "../components/RowActions";

interface LocalMessage {
  key: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[] | null;
  streaming?: boolean;
}

interface ChatModeProps {
  onOpenPaper: (paperId: number, page: number | null) => void;
}

export default function ChatMode({ onOpenPaper }: ChatModeProps) {
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [thread, setThread] = useState<LocalMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [pendingTier, setPendingTier] = useState<Tier | null>(null);
  const [folders, setFolders] = useState<LibraryFolderInfo[]>([]);
  const [pendingFolderIds, setPendingFolderIds] = useState<number[] | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const sourcesRef = useRef<HTMLDivElement | null>(null);

  const activeConv = conversations.find((c) => c.id === activeId) ?? null;
  const currentTier = activeId !== null ? (activeConv?.tier ?? null) : pendingTier;
  const currentFolderIds =
    activeId !== null ? (activeConv?.folderIds ?? null) : pendingFolderIds;

  useEffect(() => {
    void window.ipc.invoke("library:list", null).then(setFolders);
  }, []);

  useEffect(() => {
    if (!sourcesOpen) return;
    const close = (e: MouseEvent) => {
      if (sourcesRef.current && !sourcesRef.current.contains(e.target as Node)) {
        setSourcesOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [sourcesOpen]);

  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(
    null
  );

  const scrollRef = useRef<HTMLDivElement>(null);

  const refreshConversations = useCallback(() => {
    window.ipc.invoke("chat:list", null).then(setConversations);
  }, []);

  useEffect(refreshConversations, [refreshConversations]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [thread]);

  async function openConversation(id: number) {
    setActiveSearch(null);
    setActiveId(id);
    setError(null);
    const { messages } = await window.ipc.invoke("chat:get", {
      conversationId: id,
    });
    setThread(
      messages.map((m: ChatMessage) => ({
        key: `db-${m.id}`,
        role: m.role,
        content: m.content,
        citations: m.citations,
      }))
    );
  }

  function newChat() {
    setActiveSearch(null);
    setActiveId(null);
    setThread([]);
    setError(null);
    setPendingTier(null);
    setPendingFolderIds(null);
  }

  async function changeSources(folderIds: number[] | null) {
    if (activeId === null) {
      setPendingFolderIds(folderIds);
      return;
    }
    setConversations(
      await window.ipc.invoke("chat:setSources", {
        conversationId: activeId,
        folderIds,
      })
    );
  }

  function toggleFolder(id: number) {
    const selected = currentFolderIds ?? folders.map((f) => f.id);
    const next = selected.includes(id)
      ? selected.filter((f) => f !== id)
      : [...selected, id];
    // Selecting every folder = no scope (null → all sources, incl. future ones).
    void changeSources(next.length >= folders.length ? null : next);
  }

  async function changeTier(tier: Tier | null) {
    if (activeId === null) {
      setPendingTier(tier);
      return;
    }
    setConversations(
      await window.ipc.invoke("chat:setTier", { conversationId: activeId, tier })
    );
  }

  async function send() {
    const message = draft.trim();
    if (!message || sending) return;
    setDraft("");
    setError(null);
    setSending(true);

    const requestId = crypto.randomUUID();
    const assistantKey = `stream-${requestId}`;
    setThread((t) => [
      ...t,
      { key: `user-${requestId}`, role: "user", content: message, citations: null },
      {
        key: assistantKey,
        role: "assistant",
        content: "",
        citations: null,
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

    const result = await window.ipc.invoke("chat:send", {
      requestId,
      conversationId: activeId,
      message,
      tier: activeId === null ? pendingTier : null,
      folderIds: activeId === null ? pendingFolderIds : null,
    });
    offDelta();

    setThread((t) =>
      t.map((m) =>
        m.key === assistantKey
          ? { ...m, streaming: false, citations: result.citations }
          : m
      )
    );
    setSending(false);

    if (result.ok) {
      if (activeId === null && result.conversationId !== null) {
        setActiveId(result.conversationId);
      }
      // Refresh titles (generated async) shortly after.
      setTimeout(refreshConversations, 2500);
      refreshConversations();
    } else {
      setError(result.error ?? "Something went wrong");
      setThread((t) => t.filter((m) => m.key !== assistantKey));
    }
  }

  async function togglePin(c: ConversationMeta) {
    setConversations(
      await window.ipc.invoke("chat:setPinned", {
        conversationId: c.id,
        pinned: !c.pinned,
      })
    );
  }

  async function deleteConv(id: number) {
    setConversations(
      await window.ipc.invoke("chat:delete", { conversationId: id })
    );
    if (activeId === id) newChat();
  }

  async function commitRename() {
    if (renamingId === null) return;
    const id = renamingId;
    const title = renameDraft.trim();
    setRenamingId(null);
    if (!title) return;
    setConversations(
      await window.ipc.invoke("chat:rename", { conversationId: id, title })
    );
  }

  async function runSearch() {
    const q = searchQuery.trim();
    if (!q) return;
    setActiveSearch(q);
    setSearchResults(null);
    setSearchResults(await window.ipc.invoke("search:query", { query: q }));
  }

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-line">
        <div className="titlebar-drag h-12 shrink-0" />
        <div className="px-3 pb-3">
          <button
            onClick={newChat}
            className="flex w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink transition-colors hover:border-accent"
          >
            <PenLine size={15} className="text-accent-ink" />
            New chat
          </button>
          <div className="relative mt-2">
            <Search
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted"
            />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void runSearch();
                if (e.key === "Escape") {
                  setSearchQuery("");
                  setActiveSearch(null);
                }
              }}
              placeholder="Search the library"
              className="w-full rounded-lg border border-line bg-paper py-1.5 pl-8 pr-7 text-xs text-ink placeholder:text-ink-muted"
            />
            {activeSearch && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setActiveSearch(null);
                }}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          {conversations.map((c) =>
            renamingId === c.id ? (
              <input
                key={c.id}
                autoFocus
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void commitRename();
                  if (e.key === "Escape") setRenamingId(null);
                }}
                onBlur={() => void commitRename()}
                className="mb-0.5 block w-full rounded-md border border-accent bg-paper px-2.5 py-1 text-[13px] text-ink"
              />
            ) : (
              <div key={c.id} className="group relative mb-0.5">
                <button
                  onClick={() => void openConversation(c.id)}
                  className={`block w-full truncate rounded-md py-1.5 pl-2.5 pr-8 text-left text-[13px] transition-colors ${
                    activeId === c.id && !activeSearch
                      ? "bg-accent-wash text-accent-ink"
                      : "text-ink-muted hover:bg-surface hover:text-ink"
                  }`}
                >
                  {c.pinned && (
                    <Pin size={11} className="mr-1 inline-block text-accent-ink" />
                  )}
                  {c.title}
                </button>
                <RowActions
                  pinned={c.pinned}
                  onTogglePin={() => void togglePin(c)}
                  onRename={() => {
                    setRenamingId(c.id);
                    setRenameDraft(c.title);
                  }}
                  onDelete={() => void deleteConv(c.id)}
                  className="opacity-0 group-hover:opacity-100"
                />
              </div>
            )
          )}
        </div>
      </aside>

      {/* Main area */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="titlebar-drag h-12 shrink-0" />

        {activeSearch ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <SearchPanel query={activeSearch} results={searchResults} />
          </div>
        ) : (
          <>
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-2xl space-y-6 px-8 py-4">
                {thread.length === 0 && (
                  <div className="pt-24 text-center">
                    <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent-ink">
                      Chat
                    </p>
                    <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
                      Ask your library
                    </h1>
                    <p className="mx-auto mt-3 max-w-sm text-sm text-ink-muted">
                      Answers come from your indexed notes, documents and
                      papers, with sources cited. Manage folders in Settings →
                      Library.
                    </p>
                  </div>
                )}
                {thread.map((m) => (
                  <MessageBubble
                    key={m.key}
                    role={m.role}
                    content={m.content}
                    citations={m.citations}
                    streaming={m.streaming}
                    onOpenPaper={onOpenPaper}
                  />
                ))}
                {error && (
                  <p className="rounded-md border border-amber/40 bg-surface px-3 py-2 font-mono text-xs text-amber">
                    {error}
                  </p>
                )}
              </div>
            </div>

            <div className="shrink-0 border-t border-line px-8 py-4">
              <div className="mx-auto mb-2 flex max-w-2xl items-center gap-1">
                <span className="mr-1 text-[11px] text-ink-muted">
                  Difficulty
                </span>
                {([null, "easy", "intermediate", "difficult"] as (Tier | null)[]).map(
                  (t) => (
                    <button
                      key={t ?? "auto"}
                      onClick={() => void changeTier(t)}
                      className={`rounded-md px-2 py-0.5 text-[11px] capitalize transition-colors ${
                        currentTier === t
                          ? "bg-accent-wash text-accent-ink"
                          : "text-ink-muted hover:bg-surface hover:text-ink"
                      }`}
                    >
                      {t ?? "auto"}
                    </button>
                  )
                )}
                {folders.length > 0 && (
                  <div ref={sourcesRef} className="relative ml-auto">
                    <button
                      onClick={() => setSourcesOpen(!sourcesOpen)}
                      className={`rounded-md px-2 py-0.5 text-[11px] transition-colors ${
                        currentFolderIds
                          ? "bg-accent-wash text-accent-ink"
                          : "text-ink-muted hover:bg-surface hover:text-ink"
                      }`}
                    >
                      Sources:{" "}
                      {currentFolderIds
                        ? `${currentFolderIds.length}/${folders.length}`
                        : "all"}
                    </button>
                    {sourcesOpen && (
                      <div className="absolute bottom-full right-0 z-20 mb-1 w-64 rounded-md border border-line bg-surface p-1 shadow-xl">
                        <button
                          onClick={() => void changeSources(null)}
                          className={`flex w-full items-center rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent-wash ${
                            currentFolderIds === null
                              ? "text-accent-ink"
                              : "text-ink"
                          }`}
                        >
                          All sources
                        </button>
                        <div className="my-1 border-t border-line" />
                        {folders.map((f) => {
                          const checked =
                            currentFolderIds === null ||
                            currentFolderIds.includes(f.id);
                          return (
                            <label
                              key={f.id}
                              className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-ink transition-colors hover:bg-accent-wash"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleFolder(f.id)}
                                className="accent-[var(--accent,currentColor)]"
                              />
                              <span className="min-w-0 flex-1 truncate">
                                {f.path.split("/").filter(Boolean).pop()}
                              </span>
                              <span className="font-mono text-[10px] text-ink-muted">
                                {f.indexedCount}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="mx-auto flex max-w-2xl items-end gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  rows={Math.min(6, Math.max(1, draft.split("\n").length))}
                  placeholder="Ask about anything in your library…"
                  className="min-w-0 flex-1 resize-none rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink placeholder:text-ink-muted focus:border-accent"
                />
                <button
                  onClick={() => void send()}
                  disabled={sending || !draft.trim()}
                  className="rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
                >
                  {sending ? "…" : "Send"}
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
