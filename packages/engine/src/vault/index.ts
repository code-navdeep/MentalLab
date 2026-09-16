import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Cron } from "croner";
import { eq } from "drizzle-orm";
import type {
  VaultGraph,
  VaultNoteInfo,
  VaultStatus,
  VaultStrictness,
  VaultSyncProgress,
} from "@mental-lab/shared";
import { getConfigValue, setConfigValue } from "../config.js";
import { getDb } from "../db/index.js";
import { files } from "../db/schema.js";
import { addFolder, runIndex } from "../indexer/library.js";
import { probeCalendarAccess, syncCalendar } from "./calendar.js";
import { probeMailAccess, syncMail } from "./mail.js";
import { buildGraph, listVaultNotes } from "./builder.js";

const CONFIG_KEY = "vaultSettings";

interface VaultSettingsInternal {
  folder: string | null;
  mailEnabled: boolean;
  calendarEnabled: boolean;
  strictness: VaultStrictness;
  mailDaysBack: number;
  autoSyncEnabled: boolean;
  syncIntervalMinutes: number;
  lastSyncAt: string | null;
}

const DEFAULTS: VaultSettingsInternal = {
  folder: null,
  mailEnabled: true,
  calendarEnabled: true,
  strictness: "medium",
  mailDaysBack: 30,
  autoSyncEnabled: true,
  syncIntervalMinutes: 30,
  lastSyncAt: null,
};

async function loadVaultSettings(): Promise<VaultSettingsInternal> {
  const stored = await getConfigValue<VaultSettingsInternal>(CONFIG_KEY);
  // Merge over defaults so settings saved by older versions gain new keys.
  return { ...DEFAULTS, ...(stored ?? {}) };
}

let syncing = false;
type SyncBroadcaster = (progress: VaultSyncProgress) => void;
let broadcast: SyncBroadcaster = () => {};

export function configureVault(onSync: SyncBroadcaster): void {
  broadcast = onSync;
}

export async function getVaultStatus(): Promise<VaultStatus> {
  const s = await loadVaultSettings();
  const [mailAccess, calendarAccess] = await Promise.all([
    s.mailEnabled ? probeMailAccess() : Promise.resolve("unknown" as const),
    s.calendarEnabled
      ? probeCalendarAccess()
      : Promise.resolve("unknown" as const),
  ]);

  let noteCount = 0;
  let sourceCount = 0;
  if (s.folder) {
    noteCount = (await listVaultNotes(s.folder)).length;
    try {
      const entries = await readdir(path.join(s.folder, "_sources"), {
        recursive: true,
      });
      sourceCount = entries.filter((e) => e.endsWith(".md")).length;
    } catch {
      sourceCount = 0;
    }
  }

  return {
    folder: s.folder,
    mailEnabled: s.mailEnabled,
    calendarEnabled: s.calendarEnabled,
    strictness: s.strictness,
    mailDaysBack: s.mailDaysBack,
    autoSyncEnabled: s.autoSyncEnabled,
    syncIntervalMinutes: s.syncIntervalMinutes,
    mailAccess,
    calendarAccess,
    lastSyncAt: s.lastSyncAt,
    syncing,
    noteCount,
    sourceCount,
  };
}

export async function setVaultFolder(folder: string): Promise<void> {
  const s = await loadVaultSettings();
  s.folder = folder;
  await setConfigValue(CONFIG_KEY, s);
  await mkdir(path.join(folder, "_sources"), { recursive: true });
  // The vault joins the shared library index so Chat can answer from notes.
  await addFolder(folder).catch(() => {});
  await restartVaultSchedule();
}

export async function setVaultSettings(patch: {
  mailEnabled?: boolean;
  calendarEnabled?: boolean;
  strictness?: VaultStrictness;
  mailDaysBack?: number;
  autoSyncEnabled?: boolean;
  syncIntervalMinutes?: number;
}): Promise<void> {
  const s = await loadVaultSettings();
  Object.assign(s, patch);
  await setConfigValue(CONFIG_KEY, s);
  await restartVaultSchedule();
}

export async function syncVaultNow(): Promise<boolean> {
  if (syncing) return false;
  const s = await loadVaultSettings();
  if (!s.folder) return false;
  syncing = true;

  void (async () => {
    try {
      if (s.calendarEnabled) {
        broadcast({ phase: "calendar", detail: "Fetching calendar events" });
        try {
          const n = await syncCalendar(s.folder!, 30, 60);
          broadcast({ phase: "calendar", detail: `${n} events updated` });
        } catch (err) {
          broadcast({
            phase: "error",
            detail: `Calendar: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
      if (s.mailEnabled) {
        broadcast({ phase: "mail", detail: "Reading recent mail" });
        try {
          const n = await syncMail(s.folder!, s.mailDaysBack);
          broadcast({ phase: "mail", detail: `${n} messages updated` });
        } catch (err) {
          broadcast({
            phase: "error",
            detail: `Mail: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      broadcast({ phase: "graph", detail: "Building notes" });
      try {
        const result = await buildGraph(s.folder!, s.strictness, (detail) =>
          broadcast({ phase: "graph", detail })
        );
        if (result.failedBatches > 0 || result.skippedSources > 0) {
          const parts = [`${result.notesWritten} notes written`];
          if (result.failedBatches > 0) {
            parts.push(
              `${result.failedBatches} batches failed${result.lastError ? `: ${result.lastError}` : ""}`
            );
          }
          if (result.skippedSources > 0) {
            parts.push(`${result.skippedSources} sources skipped`);
          }
          broadcast({ phase: "error", detail: parts.join(" — ") });
        } else {
          broadcast({
            phase: "graph",
            detail: `${result.notesWritten} notes written`,
          });
        }
      } catch (err) {
        broadcast({
          phase: "error",
          detail: `Notes: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      broadcast({ phase: "indexing", detail: "Updating search index" });
      await runIndex();

      const updated = await loadVaultSettings();
      updated.lastSyncAt = new Date().toISOString();
      await setConfigValue(CONFIG_KEY, updated);
    } finally {
      syncing = false;
      broadcast({ phase: "idle", detail: null });
    }
  })();

  return true;
}

// ---------------------------------------------------------------------------
// Notes access
// ---------------------------------------------------------------------------

function noteFileName(name: string): string {
  const cleaned = name.replace(/[/\\]/g, "").trim();
  if (!cleaned || cleaned.startsWith(".") || cleaned.startsWith("_")) {
    throw new Error("Invalid note name");
  }
  return cleaned.endsWith(".md") ? cleaned : `${cleaned}.md`;
}

export async function getVaultNotes(): Promise<VaultNoteInfo[]> {
  const s = await loadVaultSettings();
  if (!s.folder) return [];
  return listVaultNotes(s.folder);
}

export async function readVaultNote(name: string): Promise<string> {
  const s = await loadVaultSettings();
  if (!s.folder) throw new Error("Vault is not set up");
  return readFile(path.join(s.folder, noteFileName(name)), "utf-8");
}

export async function writeVaultNote(
  name: string,
  content: string
): Promise<void> {
  const s = await loadVaultSettings();
  if (!s.folder) throw new Error("Vault is not set up");
  await writeFile(path.join(s.folder, noteFileName(name)), content, "utf-8");
}

export async function deleteVaultNote(name: string): Promise<void> {
  const s = await loadVaultSettings();
  if (!s.folder) throw new Error("Vault is not set up");
  const notePath = path.join(s.folder, noteFileName(name));
  await unlink(notePath).catch(() => {});
  // Drop its library index entry (chunks cascade) so search stops citing it.
  const { db } = getDb();
  await db.delete(files).where(eq(files.path, notePath));
}

const WIKILINK_RE = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;

export async function getBacklinks(
  name: string
): Promise<{ name: string; snippet: string }[]> {
  const s = await loadVaultSettings();
  if (!s.folder) return [];
  const notes = await listVaultNotes(s.folder);
  const target = name.toLowerCase();
  const out: { name: string; snippet: string }[] = [];
  for (const note of notes) {
    if (note.name === name) continue;
    let content: string;
    try {
      content = await readFile(
        path.join(s.folder, `${note.name}.md`),
        "utf-8"
      );
    } catch {
      continue;
    }
    for (const match of content.matchAll(WIKILINK_RE)) {
      if (match[1]!.trim().toLowerCase() === target) {
        const idx = match.index ?? 0;
        const start = Math.max(0, idx - 80);
        const snippet = content
          .slice(start, idx + match[0].length + 80)
          .replace(/\s+/g, " ")
          .trim();
        out.push({ name: note.name, snippet });
        break;
      }
    }
  }
  return out;
}

export async function getVaultGraph(): Promise<VaultGraph> {
  const s = await loadVaultSettings();
  if (!s.folder) return { nodes: [], edges: [] };
  const notes = await listVaultNotes(s.folder);
  const names = new Map(notes.map((n) => [n.name.toLowerCase(), n.name]));
  const edges: { from: string; to: string }[] = [];
  const degree = new Map<string, number>();

  for (const note of notes) {
    let content: string;
    try {
      content = await readFile(
        path.join(s.folder, `${note.name}.md`),
        "utf-8"
      );
    } catch {
      continue;
    }
    const seen = new Set<string>();
    for (const match of content.matchAll(WIKILINK_RE)) {
      const targetName = names.get(match[1]!.trim().toLowerCase());
      if (!targetName || targetName === note.name || seen.has(targetName)) {
        continue;
      }
      seen.add(targetName);
      edges.push({ from: note.name, to: targetName });
      degree.set(note.name, (degree.get(note.name) ?? 0) + 1);
      degree.set(targetName, (degree.get(targetName) ?? 0) + 1);
    }
  }

  return {
    nodes: notes.map((n) => ({
      id: n.name,
      type: n.type,
      degree: degree.get(n.name) ?? 0,
    })),
    edges,
  };
}

// ---------------------------------------------------------------------------
// Schedule: sync every 30 minutes when configured
// ---------------------------------------------------------------------------

let scheduledSync: Cron | null = null;

function cronForInterval(minutes: number): string {
  if (minutes < 60) return `*/${minutes} * * * *`;
  if (minutes < 1440) return `0 */${Math.round(minutes / 60)} * * *`;
  return "0 9 * * *"; // daily at 9:00
}

export async function restartVaultSchedule(): Promise<void> {
  scheduledSync?.stop();
  scheduledSync = null;
  const s = await loadVaultSettings();
  if (!s.folder || !s.autoSyncEnabled || (!s.mailEnabled && !s.calendarEnabled)) {
    return;
  }
  scheduledSync = new Cron(cronForInterval(s.syncIntervalMinutes), () => {
    void syncVaultNow();
  });
}
