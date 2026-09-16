import { app, BrowserWindow, net, protocol, safeStorage, shell } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { APP_NAME } from "@mental-lab/shared";
import { mkdir } from "node:fs/promises";
import {
  addFolder,
  configureAgentEvents,
  configureEmbeddings,
  configureReader,
  configureVault,
  getPaperFilePath,
  initDb,
  restartVaultSchedule,
  setAppleSidecarPath,
  setSecretStore,
  startAgent,
  startLibrary,
} from "@mental-lab/engine";
import { broadcastEvent, setupIpcHandlers } from "./ipc.js";

app.setName(APP_NAME);
app.setAboutPanelOptions({
  applicationName: APP_NAME,
  applicationVersion: app.getVersion(),
  copyright: "© 2026 Nav Virdi",
  credits: "Developed by Nav Virdi\nLiberated.Studio\nnav@Liberated.Studio",
});

const DEV_SERVER_URL = "http://localhost:5173";

// In dev, esbuild bundles this file to apps/main/dist/main.cjs.
// Preload is bundled to apps/preload/dist/preload.cjs.
// In the packaged app, both live under the app resources (staged by Forge).
const preloadPath = app.isPackaged
  ? path.join(__dirname, "../preload/dist/preload.cjs")
  : path.join(__dirname, "../../preload/dist/preload.cjs");

const rendererPath = app.isPackaged
  ? path.join(__dirname, "../renderer/dist")
  : path.join(__dirname, "../../renderer/dist");

// Serve built renderer files under app:// in production so SPA routes work.
function registerAppProtocol() {
  protocol.handle("app", (request) => {
    const url = new URL(request.url);
    let urlPath = url.pathname;
    if (urlPath === "/" || !path.extname(urlPath)) {
      urlPath = "/index.html";
    }
    const filePath = path.join(rendererPath, urlPath);
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
  {
    // Serves imported paper PDFs to the sandboxed renderer by paper id.
    scheme: "mlpdf",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function registerPdfProtocol() {
  protocol.handle("mlpdf", async (request) => {
    const url = new URL(request.url);
    // mlpdf://paper/<id>
    const id = Number(url.pathname.replace(/^\//, ""));
    if (url.hostname !== "paper" || !Number.isInteger(id)) {
      return new Response("Not found", { status: 404 });
    }
    const filePath = await getPaperFilePath(id);
    if (!filePath) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: preloadPath,
    },
  });

  // External links open in the system browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    const isInternal =
      url.startsWith("app://") || url.startsWith(DEV_SERVER_URL);
    if (!isInternal) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  if (app.isPackaged) {
    win.loadURL("app://-/index.html");
  } else {
    win.loadURL(DEV_SERVER_URL);
  }
}

app.whenReady().then(async () => {
  registerAppProtocol();
  registerPdfProtocol();

  const dataDir = app.getPath("userData");
  await initDb(dataDir);

  const papersDir = path.join(dataDir, "papers");
  await mkdir(papersDir, { recursive: true });
  configureReader({
    papersDir,
    onStatus: (paperId, status) => {
      broadcastEvent("paper:status", { paperId, status });
    },
  });

  // API keys are encrypted with the OS keychain-backed safeStorage before
  // they are stored in the local database.
  setSecretStore({
    encrypt: (plaintext) =>
      safeStorage.encryptString(plaintext).toString("base64"),
    decrypt: (token) =>
      safeStorage.decryptString(Buffer.from(token, "base64")),
  });

  // Apple Intelligence sidecar (optional; probed at runtime).
  setAppleSidecarPath(
    app.isPackaged
      ? path.join(process.resourcesPath, "applekit")
      : path.join(__dirname, "../../../sidecar/applekit/.build/release/applekit")
  );

  // Local embeddings run on a worker thread; models cache under userData.
  configureEmbeddings({
    workerPath: path.join(__dirname, "workers/embeddings-worker.cjs"),
    cacheDir: path.join(dataDir, "models"),
  });

  setupIpcHandlers();
  // Imported papers live in an app-managed folder that is part of the
  // shared library index, so Chat can answer from papers too.
  await addFolder(papersDir).catch(() => {});
  void startLibrary();

  // Agent subsystem: sandbox, skills, automations, task event broadcasting.
  configureAgentEvents({
    onStep: (taskId, step) => broadcastEvent("task:step", { taskId, step }),
    onStatus: (taskId, status) =>
      broadcastEvent("task:status", { taskId, status }),
    onRequest: (request) => broadcastEvent("task:request", request),
  });
  const skillsDir = path.join(dataDir, "skills");
  await mkdir(skillsDir, { recursive: true });
  void startAgent({ dataDir, skillsDir });

  // Vault: sync progress broadcasting + the 30-minute schedule.
  configureVault((progress) => broadcastEvent("vault:sync", progress));
  void restartVaultSchedule();

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
