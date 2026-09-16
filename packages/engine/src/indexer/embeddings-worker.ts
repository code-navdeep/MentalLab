// Runs on a worker thread. Loads the local embedding model via
// transformers.js (ONNX, downloaded once to the app data dir) and answers
// embed requests from the embeddings service.
import { parentPort, workerData } from "node:worker_threads";

interface EmbedRequest {
  id: number;
  texts: string[];
}

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

async function main() {
  const { env, pipeline } = await import("@huggingface/transformers");
  env.cacheDir = (workerData as { cacheDir: string }).cacheDir;

  // ORT's default BFC arena grows by doubling and never shrinks; inside
  // Electron a large enough Extend aborts the process. Per-tensor allocation
  // keeps memory bounded (inputs are small: ~1200-char chunks, batches of 16).
  const extractor = await pipeline("feature-extraction", MODEL_ID, {
    session_options: { enableCpuMemArena: false },
  });

  parentPort!.on("message", async (req: EmbedRequest) => {
    try {
      const output = await extractor(req.texts, {
        pooling: "mean",
        normalize: true,
      });
      const vectors = output.tolist() as number[][];
      parentPort!.postMessage({ id: req.id, vectors });
    } catch (err) {
      parentPort!.postMessage({
        id: req.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  parentPort!.postMessage({ id: 0, ready: true });
}

main().catch((err) => {
  parentPort!.postMessage({
    id: 0,
    error: err instanceof Error ? err.message : String(err),
  });
});
