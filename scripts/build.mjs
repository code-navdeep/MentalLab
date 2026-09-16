/**
 * One-shot production build: main + preload + embeddings worker (esbuild),
 * renderer (vite), and the Swift sidecar. Outputs land in the same places
 * the dev orchestrator uses, so main-process path resolution is identical.
 */
import * as esbuild from "esbuild";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = (name) => path.join(root, "node_modules", ".bin", name);

const cjsBanner = `var __import_meta_url = require('url').pathToFileURL(__filename).href;`;

const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  banner: { js: cjsBanner },
  define: { "import.meta.url": "__import_meta_url" },
  logLevel: "warning",
  minify: false,
  sourcemap: false,
};

console.log("Bundling main process…");
await esbuild.build({
  ...common,
  entryPoints: [path.join(root, "apps/main/src/main.ts")],
  outfile: path.join(root, "apps/main/dist/main.cjs"),
  external: [
    "electron",
    "@electric-sql/pglite",
    "pdfjs-dist",
    "@anthropic-ai/sandbox-runtime",
  ],
});

console.log("Bundling preload…");
// No `common` here: its cjsBanner references __filename, which does not
// exist inside a sandboxed preload (sandbox: true) and kills the script.
await esbuild.build({
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  logLevel: "warning",
  entryPoints: [path.join(root, "apps/preload/src/preload.ts")],
  outfile: path.join(root, "apps/preload/dist/preload.cjs"),
  external: ["electron"],
});

console.log("Bundling embeddings worker…");
await esbuild.build({
  ...common,
  entryPoints: [
    path.join(root, "packages/engine/src/indexer/embeddings-worker.ts"),
  ],
  outfile: path.join(root, "apps/main/dist/workers/embeddings-worker.cjs"),
  external: ["@huggingface/transformers"],
});

console.log("Building renderer…");
execSync(`"${bin("vite")}" build`, {
  cwd: path.join(root, "apps/renderer"),
  stdio: "inherit",
});

console.log("Building sidecar…");
execSync(`"${path.join(root, "scripts/build-sidecar.sh")}"`, {
  cwd: root,
  stdio: "inherit",
});

console.log("✅ Production build complete");
