import { Worker } from "node:worker_threads";
import { getConfigValue, setConfigValue } from "../config.js";
import { loadSettings } from "../models/settings.js";
import { probeOllama } from "../models/ollama.js";

const OLLAMA_EMBED_MODEL = "nomic-embed-text";
const OLLAMA_DIM = 768;
const LOCAL_DIM = 384;

export interface EmbeddingsSource {
  source: "ollama" | "local";
  model: string;
  dimension: number;
}

let workerPath: string | null = null;
let cacheDir: string | null = null;

export function configureEmbeddings(opts: {
  workerPath: string;
  cacheDir: string;
}): void {
  workerPath = opts.workerPath;
  cacheDir = opts.cacheDir;
}

export async function detectEmbeddingsSource(): Promise<EmbeddingsSource> {
  const s = await loadSettings();
  const base = s.providers.ollama.baseUrl ?? "http://localhost:11434";
  const status = await probeOllama(base);
  if (
    status.running &&
    status.models.some((m) => m.startsWith(OLLAMA_EMBED_MODEL))
  ) {
    return { source: "ollama", model: OLLAMA_EMBED_MODEL, dimension: OLLAMA_DIM };
  }
  return {
    source: "local",
    model: "all-MiniLM-L6-v2",
    dimension: LOCAL_DIM,
  };
}

// ---------------------------------------------------------------------------
// Local worker plumbing
// ---------------------------------------------------------------------------

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (v: number[][]) => void; reject: (e: Error) => void }
>();

function ensureWorker(): Worker {
  if (worker) return worker;
  if (!workerPath || !cacheDir) {
    throw new Error("Embeddings worker not configured");
  }
  worker = new Worker(workerPath, { workerData: { cacheDir } });
  worker.on(
    "message",
    (msg: { id: number; vectors?: number[][]; error?: string }) => {
      if (msg.id === 0) {
        // Startup signal: an error here is fatal — nothing will ever answer.
        if (msg.error) {
          const error = new Error(`Embeddings worker failed: ${msg.error}`);
          for (const [, p] of pending) p.reject(error);
          pending.clear();
          void worker?.terminate();
          worker = null;
        }
        return;
      }
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.vectors ?? []);
    }
  );
  worker.on("error", (err) => {
    const error = err instanceof Error ? err : new Error(String(err));
    for (const [, p] of pending) p.reject(error);
    pending.clear();
    worker = null;
  });
  return worker;
}

function embedLocal(texts: string[]): Promise<number[][]> {
  const w = ensureWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, texts });
  });
}

async function embedOllama(
  baseUrl: string,
  texts: string[]
): Promise<number[][]> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, input: texts }),
  });
  if (!res.ok) {
    throw new Error(`Ollama embeddings failed: ${res.status}`);
  }
  const data = (await res.json()) as { embeddings: number[][] };
  return data.embeddings;
}

const SOURCE_CONFIG_KEY = "embeddingsSource";

/**
 * The embedding source is locked on first use so every vector in the index
 * lives in one space. Switching sources later requires a full re-index.
 */
export async function getLockedEmbeddingsSource(): Promise<EmbeddingsSource> {
  const stored = await getConfigValue<EmbeddingsSource>(SOURCE_CONFIG_KEY);
  if (stored) return stored;
  const detected = await detectEmbeddingsSource();
  await setConfigValue(SOURCE_CONFIG_KEY, detected);
  return detected;
}

export async function embedWithSource(
  source: EmbeddingsSource,
  texts: string[]
): Promise<number[][]> {
  if (source.source === "ollama") {
    const s = await loadSettings();
    const base = s.providers.ollama.baseUrl ?? "http://localhost:11434";
    return embedOllama(base, texts);
  }
  return embedLocal(texts);
}

export async function embedTexts(texts: string[]): Promise<{
  source: EmbeddingsSource;
  vectors: number[][];
}> {
  const source = await getLockedEmbeddingsSource();
  return { source, vectors: await embedWithSource(source, texts) };
}
