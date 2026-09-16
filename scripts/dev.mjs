/**
 * Dev orchestrator: bundles main + preload with esbuild (watch mode),
 * starts the Vite dev server for the renderer, then launches Electron.
 * One command, one teardown.
 */
import * as esbuild from "esbuild";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = (name) => path.join(root, "node_modules", ".bin", name);

// import.meta.url does not exist in CJS output; polyfill it so ESM-authored
// code (and dependencies) keep working inside the bundle.
const cjsBanner = `var __import_meta_url = require('url').pathToFileURL(__filename).href;`;

const mainCtx = await esbuild.context({
  entryPoints: [path.join(root, "apps/main/src/main.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: path.join(root, "apps/main/dist/main.cjs"),
  // electron is provided by the runtime; pglite loads its WASM assets and
  // pdfjs loads its worker module from their own package directories, so
  // both must stay on disk, unbundled.
  external: [
    "electron",
    "@electric-sql/pglite",
    "pdfjs-dist",
    "@anthropic-ai/sandbox-runtime",
  ],
  banner: { js: cjsBanner },
  define: { "import.meta.url": "__import_meta_url" },
  logLevel: "info",
});

const preloadCtx = await esbuild.context({
  entryPoints: [path.join(root, "apps/preload/src/preload.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: path.join(root, "apps/preload/dist/preload.cjs"),
  external: ["electron"],
  logLevel: "info",
});

const workerCtx = await esbuild.context({
  entryPoints: [
    path.join(root, "packages/engine/src/indexer/embeddings-worker.ts"),
  ],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: path.join(root, "apps/main/dist/workers/embeddings-worker.cjs"),
  // transformers.js loads native ONNX runtime binaries; it must stay on disk.
  external: ["@huggingface/transformers"],
  banner: { js: cjsBanner },
  define: { "import.meta.url": "__import_meta_url" },
  logLevel: "info",
});

await mainCtx.watch();
await preloadCtx.watch();
await workerCtx.watch();

const children = [];
function launch(command, args, opts = {}) {
  const child = spawn(command, args, { stdio: "inherit", ...opts });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  for (const child of children) {
    if (child.exitCode === null) child.kill();
  }
  Promise.all([
    mainCtx.dispose(),
    preloadCtx.dispose(),
    workerCtx.dispose(),
  ]).finally(() => process.exit(code));
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// Renderer dev server
launch(bin("vite"), [], { cwd: path.join(root, "apps/renderer") });

// Wait until Vite answers, then start Electron.
const DEV_URL = "http://localhost:5173";
const deadline = Date.now() + 30_000;
for (;;) {
  try {
    await fetch(DEV_URL);
    break;
  } catch {
    if (Date.now() > deadline) {
      console.error("Vite dev server did not come up within 30s");
      shutdown(1);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

const electron = launch(bin("electron"), [path.join(root, "apps/main")]);
electron.on("exit", (code) => shutdown(code ?? 0));
