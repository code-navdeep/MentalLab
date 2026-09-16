import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

interface FileState {
  mtime: number;
  hash: string;
}

export interface GraphState {
  processedFiles: Record<string, FileState>;
  /** Consecutive build failures per source file; ≥3 → skipped from builds. */
  failedAttempts: Record<string, number>;
  lastBuildTime: string | null;
}

function statePath(vaultFolder: string): string {
  return path.join(vaultFolder, ".mentallab", "graph-state.json");
}

export async function loadGraphState(vaultFolder: string): Promise<GraphState> {
  try {
    const raw = await readFile(statePath(vaultFolder), "utf-8");
    const parsed = JSON.parse(raw) as GraphState;
    parsed.failedAttempts ??= {};
    return parsed;
  } catch {
    return { processedFiles: {}, failedAttempts: {}, lastBuildTime: null };
  }
}

export async function saveGraphState(
  vaultFolder: string,
  state: GraphState
): Promise<void> {
  await mkdir(path.dirname(statePath(vaultFolder)), { recursive: true });
  await writeFile(statePath(vaultFolder), JSON.stringify(state, null, 2));
}

async function listSourceFiles(vaultFolder: string): Promise<string[]> {
  const sourcesDir = path.join(vaultFolder, "_sources");
  const out: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(sourcesDir, { recursive: true });
  } catch {
    return out;
  }
  for (const rel of entries) {
    if (rel.endsWith(".md")) out.push(path.join(sourcesDir, rel));
  }
  return out;
}

/** New or changed source files (mtime fast-path, hash to confirm). */
export async function getFilesToProcess(
  vaultFolder: string,
  state: GraphState
): Promise<string[]> {
  const files = await listSourceFiles(vaultFolder);
  const toProcess: string[] = [];
  for (const file of files) {
    let s;
    try {
      s = await stat(file);
    } catch {
      continue;
    }
    const known = state.processedFiles[file];
    if (known && known.mtime === s.mtimeMs) continue;
    const hash = createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
    if (known && known.hash === hash) {
      known.mtime = s.mtimeMs; // false positive — refresh mtime only
      continue;
    }
    toProcess.push(file);
  }
  return toProcess;
}

export async function markProcessed(
  state: GraphState,
  file: string
): Promise<void> {
  try {
    const s = await stat(file);
    const hash = createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
    state.processedFiles[file] = { mtime: s.mtimeMs, hash };
    delete state.failedAttempts[file];
  } catch {
    // File vanished mid-build — skip
  }
}
