// Runs in its own process (an Electron utility process started by main), so
// a native ONNX Runtime crash cannot take the app down. Loads the local
// embedding model via transformers.js (ONNX, downloaded once to the app data
// dir) and answers embed requests from the embeddings service.

interface InitMessage {
  type: "init";
  cacheDir: string;
}

interface EmbedRequest {
  type: "embed";
  id: number;
  texts: string[];
}

// Electron's utility-process port, typed here so the engine never imports
// electron. Messages sent before the listener registers are queued.
const parentPort = (
  process as unknown as {
    parentPort: {
      on(
        event: "message",
        listener: (e: { data: InitMessage | EmbedRequest }) => void
      ): void;
      postMessage(message: unknown): void;
    };
  }
).parentPort;

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

async function loadExtractor(cacheDir: string) {
  const { env, pipeline } = await import("@huggingface/transformers");
  env.cacheDir = cacheDir;

  // ORT's default BFC arena grows by doubling and never shrinks; inside
  // Electron a large enough Extend aborts the process. Per-tensor allocation
  // keeps memory bounded (inputs are small: ~1200-char chunks, batches of 16).
  return pipeline("feature-extraction", MODEL_ID, {
    session_options: { enableCpuMemArena: false },
  });
}

let ready: ReturnType<typeof loadExtractor> | null = null;

parentPort.on("message", async ({ data: msg }) => {
  if (msg.type === "init") {
    ready = loadExtractor(msg.cacheDir);
    ready.then(
      () => parentPort.postMessage({ id: 0, ready: true }),
      (err: unknown) =>
        parentPort.postMessage({
          id: 0,
          error: err instanceof Error ? err.message : String(err),
        })
    );
    return;
  }

  try {
    if (!ready) throw new Error("Embeddings worker was not initialised");
    const extractor = await ready;
    const output = await extractor(msg.texts, {
      pooling: "mean",
      normalize: true,
    });
    const vectors = output.tolist() as number[][];
    parentPort.postMessage({ id: msg.id, vectors });
  } catch (err) {
    parentPort.postMessage({
      id: msg.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
