import { useCallback, useEffect, useRef, useState } from "react";
import {
  FolderOpen,
  List,
  RefreshCw,
  Settings2,
  Waypoints,
} from "lucide-react";
import type {
  VaultGraph,
  VaultNoteInfo,
  VaultStatus,
  VaultStrictness,
  VaultSyncProgress,
} from "@mental-lab/shared";
import GraphView from "../components/vault/GraphView";
import NoteView from "../components/vault/NoteView";
import Switch from "../components/settings/Switch";
import RowActions from "../components/RowActions";

const TYPE_DOT: Record<string, string> = {
  person: "#8aa0f4",
  org: "#d9973f",
  project: "#5bae7f",
  topic: "#f2aecb",
  paper: "#c7b2f2",
  other: "#9a9da8",
};

const FDA_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";

function AccessBadge({ access }: { access: "granted" | "denied" | "unknown" }) {
  if (access === "granted")
    return <span className="font-mono text-xs text-ok">access granted</span>;
  if (access === "denied")
    return <span className="font-mono text-xs text-amber">no access</span>;
  return <span className="font-mono text-xs text-ink-muted">off</span>;
}

export default function VaultMode() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [notes, setNotes] = useState<VaultNoteInfo[]>([]);
  const [activeNote, setActiveNote] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState(true);
  const [backlinks, setBacklinks] = useState<{ name: string; snippet: string }[]>(
    []
  );
  const [editing, setEditing] = useState(false);
  const [graph, setGraph] = useState<VaultGraph | null>(null);
  const [viewGraph, setViewGraph] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sync, setSync] = useState<VaultSyncProgress | null>(null);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    void window.ipc.invoke("vault:getStatus", null).then(setStatus);
    void window.ipc.invoke("vault:listNotes", null).then(setNotes);
  }, []);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    const off = window.ipc.on("vault:sync", (progress) => {
      setSync(progress);
      if (progress.phase === "error" && progress.detail) {
        setLastSyncError(progress.detail);
      }
      if (progress.phase === "idle") {
        refresh();
        if (viewGraph) {
          void window.ipc.invoke("vault:graph", null).then(setGraph);
        }
      }
    });
    return off;
  }, [refresh, viewGraph]);

  async function deleteNote(name: string) {
    setNotes(await window.ipc.invoke("vault:deleteNote", { name }));
    if (activeNote === name) {
      setActiveNote(null);
      setContent("");
    }
  }

  const openNote = useCallback(async (name: string) => {
    setViewGraph(false);
    setActiveNote(name);
    setSaved(true);
    setEditing(false);
    const { content: c } = await window.ipc.invoke("vault:readNote", { name });
    setContent(c);
    setBacklinks(await window.ipc.invoke("vault:backlinks", { name }));
  }, []);

  function editContent(value: string) {
    setContent(value);
    setSaved(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (activeNote) {
        void window.ipc
          .invoke("vault:writeNote", { name: activeNote, content: value })
          .then(() => setSaved(true));
      }
    }, 800);
  }

  async function toggleGraph() {
    const next = !viewGraph;
    setViewGraph(next);
    if (next) setGraph(await window.ipc.invoke("vault:graph", null));
  }

  if (!status) return <div className="h-full" />;

  // ------------------------------------------------------------------
  // Setup view
  // ------------------------------------------------------------------
  if (!status.folder) {
    return (
      <div className="flex h-full flex-col">
        <div className="titlebar-drag h-12 shrink-0" />
        <div className="flex flex-1 items-start justify-center overflow-y-auto">
          <div className="max-w-lg px-8 py-8 pb-16">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent-ink">
              Vault
            </p>
            <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
              Memory that compounds
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              The vault is a folder of plain Markdown notes about the people,
              projects and topics in your life — built automatically from your
              mail and calendar, linked together, editable by you, and readable
              by any app including Obsidian.
            </p>

            <button
              onClick={() =>
                void window.ipc
                  .invoke("vault:chooseFolder", null)
                  .then(setStatus)
              }
              className="mt-6 flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white"
            >
              <FolderOpen size={16} />
              Choose vault folder
            </button>

            <div className="mt-8 space-y-3">
              <div className="rounded-xl border border-line bg-surface p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-ink">Apple Calendar</p>
                  <AccessBadge access={status.calendarAccess} />
                </div>
                <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                  Events become meeting notes. macOS will ask for calendar
                  access on first sync.
                </p>
              </div>
              <div className="rounded-xl border border-line bg-surface p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-ink">Apple Mail</p>
                  <AccessBadge access={status.mailAccess} />
                </div>
                <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                  Reads your local Mail archive directly — no accounts, no
                  cloud. Requires Full Disk Access, granted once in System
                  Settings (during development, grant it to “Electron”).
                </p>
                {status.mailAccess !== "granted" && (
                  <button
                    onClick={() =>
                      void window.ipc.invoke("app:openExternal", {
                        url: FDA_URL,
                      })
                    }
                    className="mt-2 rounded-md border border-line px-3 py-1.5 text-xs text-ink-muted hover:border-accent hover:text-accent-ink"
                  >
                    Open Full Disk Access settings
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Vault view
  // ------------------------------------------------------------------
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="titlebar-drag flex h-12 shrink-0 items-center gap-2 border-b border-line pl-4 pr-3">
        <p className="min-w-0 truncate font-mono text-xs text-ink-muted">
          {status.folder}
        </p>
        <span className="font-mono text-[11px] text-ink-muted">
          · {status.noteCount} notes
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {sync && sync.phase !== "idle" && (
            <span
              className={`font-mono text-[11px] ${sync.phase === "error" ? "text-amber" : "text-accent-ink"}`}
            >
              {sync.phase}
              {sync.detail ? ` — ${sync.detail}` : ""}
            </span>
          )}
          <button
            onClick={() => {
              setLastSyncError(null);
              void window.ipc.invoke("vault:syncNow", null);
            }}
            disabled={status.syncing || (sync !== null && sync.phase !== "idle")}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          >
            <RefreshCw size={13} />
            Sync now
          </button>
          <button
            onClick={() => void toggleGraph()}
            aria-label={viewGraph ? "Show notes list" : "Show graph"}
            className={`rounded-md p-1.5 ${viewGraph ? "bg-accent-wash text-accent-ink" : "text-ink-muted hover:text-ink"}`}
          >
            {viewGraph ? <List size={15} /> : <Waypoints size={15} />}
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            aria-label="Vault settings"
            className={`rounded-md p-1.5 ${showSettings ? "bg-accent-wash text-accent-ink" : "text-ink-muted hover:text-ink"}`}
          >
            <Settings2 size={15} />
          </button>
        </div>
      </div>

      {/* Last sync failure, kept visible after the sync ends */}
      {lastSyncError && (!sync || sync.phase === "idle") && (
        <div className="shrink-0 border-b border-line bg-surface px-4 py-1.5 font-mono text-[11px] text-amber">
          Last sync: {lastSyncError}
        </div>
      )}

      {/* Settings popover */}
      {showSettings && (
        <div className="shrink-0 border-b border-line bg-surface px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
            <label className="flex items-center gap-2 text-xs text-ink">
              <Switch
                checked={status.mailEnabled}
                label="Sync Apple Mail"
                onChange={(mailEnabled) =>
                  void window.ipc
                    .invoke("vault:setSettings", { mailEnabled })
                    .then(setStatus)
                }
              />
              Apple Mail <AccessBadge access={status.mailAccess} />
            </label>
            <label className="flex items-center gap-2 text-xs text-ink">
              <Switch
                checked={status.calendarEnabled}
                label="Sync Apple Calendar"
                onChange={(calendarEnabled) =>
                  void window.ipc
                    .invoke("vault:setSettings", { calendarEnabled })
                    .then(setStatus)
                }
              />
              Apple Calendar <AccessBadge access={status.calendarAccess} />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-ink">
              Note creation:
              <select
                value={status.strictness}
                onChange={(e) =>
                  void window.ipc
                    .invoke("vault:setSettings", {
                      strictness: e.target.value as VaultStrictness,
                    })
                    .then(setStatus)
                }
                className="rounded-md border border-line bg-paper px-2 py-1 text-xs text-ink"
              >
                <option value="high">Strict — meetings create notes</option>
                <option value="medium">Balanced — personal email too</option>
                <option value="low">Broad — every human contact</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-ink">
              <Switch
                checked={status.autoSyncEnabled}
                label="Auto-sync"
                onChange={(autoSyncEnabled) =>
                  void window.ipc
                    .invoke("vault:setSettings", { autoSyncEnabled })
                    .then(setStatus)
                }
              />
              Auto-sync
            </label>
            <label className="flex items-center gap-1.5 text-xs text-ink">
              Every:
              <select
                value={status.syncIntervalMinutes}
                disabled={!status.autoSyncEnabled}
                onChange={(e) =>
                  void window.ipc
                    .invoke("vault:setSettings", {
                      syncIntervalMinutes: Number(e.target.value),
                    })
                    .then(setStatus)
                }
                className="rounded-md border border-line bg-paper px-2 py-1 text-xs text-ink disabled:opacity-40"
              >
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>hour</option>
                <option value={360}>6 hours</option>
                <option value={1440}>day (9:00)</option>
              </select>
            </label>
            {status.mailAccess === "denied" && status.mailEnabled && (
              <button
                onClick={() =>
                  void window.ipc.invoke("app:openExternal", { url: FDA_URL })
                }
                className="rounded-md border border-amber/40 px-2.5 py-1 font-mono text-[11px] text-amber"
              >
                Grant Full Disk Access…
              </button>
            )}
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {!viewGraph && (
          <aside className="w-60 shrink-0 overflow-y-auto border-r border-line px-3 py-3">
            {notes.length === 0 && (
              <p className="px-2 py-8 text-center text-xs text-ink-muted">
                No notes yet. Run a sync to build your first ones.
              </p>
            )}
            {notes.map((note) => (
              <div key={note.name} className="group relative mb-0.5">
                <button
                  onClick={() => void openNote(note.name)}
                  className={`flex w-full items-center gap-2 rounded-md py-1.5 pl-2 pr-8 text-left text-[13px] transition-colors ${
                    activeNote === note.name
                      ? "bg-accent-wash text-accent-ink"
                      : "text-ink-muted hover:bg-surface hover:text-ink"
                  }`}
                >
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: TYPE_DOT[note.type] }}
                  />
                  <span className="min-w-0 truncate">{note.name}</span>
                </button>
                <RowActions
                  onDelete={() => void deleteNote(note.name)}
                  className="opacity-0 group-hover:opacity-100"
                />
              </div>
            ))}
          </aside>
        )}

        <div className="min-w-0 flex-1">
          {viewGraph ? (
            graph && graph.nodes.length > 0 ? (
              <GraphView graph={graph} onOpenNote={(n) => void openNote(n)} />
            ) : (
              <p className="pt-24 text-center text-sm text-ink-muted">
                The graph appears once notes link to each other.
              </p>
            )
          ) : activeNote ? (
            <div className="flex h-full flex-col">
              {editing ? (
                <textarea
                  value={content}
                  onChange={(e) => editContent(e.target.value)}
                  autoFocus
                  className="min-h-0 flex-1 resize-none bg-transparent px-6 py-4 font-mono text-[13px] leading-relaxed text-ink focus:outline-none"
                  spellCheck={false}
                />
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <NoteView
                    content={content}
                    onOpenNote={(n) => void openNote(n)}
                  />
                </div>
              )}
              <div className="shrink-0 border-t border-line px-6 py-2">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setEditing(!editing)}
                    className="rounded-md border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-ink-muted hover:border-accent hover:text-accent-ink"
                  >
                    {editing ? "View" : "Edit"}
                  </button>
                  <span className="font-mono text-[10px] text-ink-muted">
                    {saved ? "Saved" : "Saving…"}
                  </span>
                  {backlinks.length > 0 && (
                    <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
                      Linked from:
                    </span>
                  )}
                  {backlinks.map((b) => (
                    <button
                      key={b.name}
                      onClick={() => void openNote(b.name)}
                      title={b.snippet}
                      className="font-mono text-[11px] text-accent-ink underline-offset-2 hover:underline"
                    >
                      {b.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="pt-24 text-center text-sm text-ink-muted">
              Pick a note, or press Sync now to pull in mail and calendar.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
