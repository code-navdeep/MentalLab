import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { IndexProgress, LibraryFolderInfo } from "@mental-lab/shared";
import { getDb } from "../db/index.js";
import { chunks, files, libraryFolders } from "../db/schema.js";
import { chunkSegments } from "./chunk.js";
import {
  embedWithSource,
  getLockedEmbeddingsSource,
} from "./embeddings.js";
import { fileTypeOf, isSupportedFile, parseFile } from "./parse.js";

const EMBED_BATCH = 16;
const IGNORED_DIRS = new Set(["node_modules", ".git", ".obsidian"]);

type ProgressListener = (progress: IndexProgress) => void;
let progressListener: ProgressListener = () => {};

export function onIndexProgress(listener: ProgressListener): void {
  progressListener = listener;
}

function report(progress: IndexProgress) {
  progressListener(progress);
}

// ---------------------------------------------------------------------------
// Folder management
// ---------------------------------------------------------------------------

export async function listFolders(): Promise<LibraryFolderInfo[]> {
  const { db } = getDb();
  const rows = await db
    .select({
      id: libraryFolders.id,
      path: libraryFolders.path,
      fileCount: sql<number>`count(${files.id})::int`,
      indexedCount: sql<number>`count(${files.id}) filter (where ${files.status} = 'indexed')::int`,
      errorCount: sql<number>`count(${files.id}) filter (where ${files.status} = 'error')::int`,
    })
    .from(libraryFolders)
    .leftJoin(files, eq(files.folderId, libraryFolders.id))
    .groupBy(libraryFolders.id)
    .orderBy(libraryFolders.path);

  return rows.map((row) => {
    const unreadable = new Set(unreadableByFolder.get(row.id) ?? []);
    // Attribute watcher-attach failures to the folder that contains them.
    for (const p of watchErrorPaths) {
      if (p.startsWith(row.path + path.sep) || p === row.path) {
        unreadable.add(p);
      }
    }
    const paths = [...unreadable];
    return {
      ...row,
      unreadableCount: paths.length,
      unreadablePaths: paths.slice(0, 5),
    };
  });
}

export async function addFolder(folderPath: string): Promise<void> {
  const { db } = getDb();
  await db
    .insert(libraryFolders)
    .values({ path: folderPath })
    .onConflictDoNothing();
  await restartWatcher();
  void runIndex();
}

export async function removeFolder(folderId: number): Promise<void> {
  const { db } = getDb();
  await db.delete(libraryFolders).where(eq(libraryFolders.id, folderId));
  await restartWatcher();
}

// ---------------------------------------------------------------------------
// Scanning + indexing (serialized: one run at a time, one queued)
// ---------------------------------------------------------------------------

let running = false;
let queued = false;

export async function runIndex(): Promise<void> {
  if (running) {
    queued = true;
    return;
  }
  running = true;
  try {
    await scanAndIndex();
  } finally {
    running = false;
    report({ phase: "idle", currentFile: null, done: 0, total: 0 });
    if (queued) {
      queued = false;
      void runIndex();
    }
  }
}

// Runtime scan health, keyed by folder id. Repopulated on every scan; the
// watcher also reports paths it cannot attach to.
const unreadableByFolder = new Map<number, Set<string>>();
const watchErrorPaths = new Set<string>();

interface WalkResult {
  files: string[];
  unreadable: string[];
}

/**
 * Per-directory walk (not one-shot recursive readdir): an unreadable
 * subdirectory is recorded and skipped instead of failing the whole walk —
 * a wholesale failure would return an empty list, which the scanner would
 * interpret as "all files deleted" and prune the index.
 */
async function walkFolder(root: string): Promise<WalkResult> {
  const files: string[] = [];
  const unreadable: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 16) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      unreadable.push(dir);
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs, depth + 1);
      } else if (isSupportedFile(abs)) {
        files.push(abs);
      }
    }
  }

  await walk(root, 0);
  return { files, unreadable };
}

async function scanAndIndex(): Promise<void> {
  const { db } = getDb();
  report({ phase: "scanning", currentFile: null, done: 0, total: 0 });

  const folders = await db.select().from(libraryFolders);
  const seenPaths: string[] = [];
  const toIndex: { folderId: number; abs: string; rel: string }[] = [];

  for (const folder of folders) {
    const { files: paths, unreadable } = await walkFolder(folder.path);
    // Refresh scan health for this folder (watch errors merge in listFolders).
    unreadableByFolder.set(folder.id, new Set(unreadable));
    for (const abs of paths) {
      seenPaths.push(abs);
      const rel = path.relative(folder.path, abs);
      let fileStat;
      try {
        fileStat = await stat(abs);
      } catch {
        continue;
      }
      const existing = await db
        .select()
        .from(files)
        .where(eq(files.path, abs));
      const row = existing[0];

      if (
        row &&
        row.status === "indexed" &&
        row.mtime &&
        row.mtime.getTime() === fileStat.mtime.getTime()
      ) {
        continue; // unchanged by mtime — skip without hashing
      }

      if (row) {
        const hash = createHash("sha256")
          .update(await readFile(abs))
          .digest("hex");
        if (row.status === "indexed" && row.contentHash === hash) {
          // mtime changed but content didn't — just refresh mtime
          await db
            .update(files)
            .set({ mtime: fileStat.mtime })
            .where(eq(files.id, row.id));
          continue;
        }
      }
      toIndex.push({ folderId: folder.id, abs, rel });
    }
  }

  // Remove rows (and cascaded chunks) for files that no longer exist.
  if (seenPaths.length > 0) {
    await db.delete(files).where(notInArray(files.path, seenPaths));
  } else {
    await db.delete(files);
  }

  // Index changed/new files one at a time.
  const source = await getLockedEmbeddingsSource();
  let done = 0;
  for (const item of toIndex) {
    report({
      phase: "indexing",
      currentFile: item.rel,
      done,
      total: toIndex.length,
    });
    await indexOne(item.folderId, item.abs, item.rel, source).catch(() => {});
    done++;
  }
}

async function indexOne(
  folderId: number,
  abs: string,
  rel: string,
  source: Awaited<ReturnType<typeof getLockedEmbeddingsSource>>
): Promise<void> {
  const { db } = getDb();
  const fileStat = await stat(abs);
  const content = await readFile(abs);
  const hash = createHash("sha256").update(content).digest("hex");

  const inserted = await db
    .insert(files)
    .values({
      folderId,
      path: abs,
      relPath: rel,
      fileType: fileTypeOf(abs),
      sizeBytes: fileStat.size,
      mtime: fileStat.mtime,
      contentHash: hash,
      status: "indexing",
      error: null,
    })
    .onConflictDoUpdate({
      target: files.path,
      set: {
        folderId,
        relPath: rel,
        sizeBytes: fileStat.size,
        mtime: fileStat.mtime,
        contentHash: hash,
        status: "indexing",
        error: null,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: files.id });
  const fileId = inserted[0]!.id;

  try {
    const segments = await parseFile(abs);
    const parts = chunkSegments(segments);

    const vectors: number[][] = [];
    for (let i = 0; i < parts.length; i += EMBED_BATCH) {
      const batch = parts.slice(i, i + EMBED_BATCH);
      vectors.push(
        ...(await embedWithSource(
          source,
          batch.map((c) => c.text)
        ))
      );
    }

    await db.transaction(async (tx) => {
      await tx.delete(chunks).where(eq(chunks.fileId, fileId));
      for (let i = 0; i < parts.length; i++) {
        await tx.insert(chunks).values({
          fileId,
          chunkIndex: i,
          page: parts[i]!.page,
          text: parts[i]!.text,
          embedding: vectors[i] ?? null,
        });
      }
      await tx
        .update(files)
        .set({ status: "indexed", indexedAt: sql`now()`, error: null })
        .where(eq(files.id, fileId));
    });
  } catch (err) {
    await db
      .update(files)
      .set({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      })
      .where(eq(files.id, fileId));
  }
}

// ---------------------------------------------------------------------------
// Watcher
// ---------------------------------------------------------------------------

let watcher: FSWatcher | null = null;
let rescanTimer: NodeJS.Timeout | null = null;

function scheduleRescan() {
  if (rescanTimer) clearTimeout(rescanTimer);
  rescanTimer = setTimeout(() => {
    rescanTimer = null;
    void runIndex();
  }, 2000);
}

export async function restartWatcher(): Promise<void> {
  const { db } = getDb();
  if (watcher) {
    await watcher.close();
    watcher = null;
  }
  const folders = await db.select().from(libraryFolders);
  if (folders.length === 0) return;
  watcher = chokidar.watch(
    folders.map((f) => f.path),
    {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
      ignored: (p) =>
        path
          .basename(p)
          .startsWith(".") ||
        p.split(path.sep).some((part) => IGNORED_DIRS.has(part)),
    }
  );
  watcher.on("add", scheduleRescan);
  watcher.on("change", scheduleRescan);
  watcher.on("unlink", scheduleRescan);
  // Paths the OS refuses to watch are recorded (surfaced in Settings →
  // Library) and skipped; readable ones are still covered by rescans.
  watcher.on("error", (err) => {
    const p = (err as NodeJS.ErrnoException & { path?: string }).path;
    if (p) watchErrorPaths.add(p);
  });
}

export async function startLibrary(): Promise<void> {
  await restartWatcher();
  void runIndex();
}
