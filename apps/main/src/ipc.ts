import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import {
  validateEvent,
  validateRequest,
  validateResponse,
  type EventChannel,
  type EventPayload,
  type InvokeChannel,
  type IpcRequest,
  type IpcResponse,
} from "@mental-lab/shared";
import {
  addFolder,
  addHighlight,
  askPaperCopilot,
  deleteAutomation,
  exportPaperToVault,
  findPaperByPath,
  getAgentConfig,
  getSandboxConfig,
  getTask,
  isSandboxSupported,
  listAutomations,
  listTasks,
  respondToRequest,
  runAutomationNow,
  runTask,
  saveAutomation,
  setAgentConfig,
  updateSandboxConfig,
  getBacklinks,
  getVaultGraph,
  getVaultNotes,
  getVaultStatus,
  readVaultNote,
  setVaultFolder,
  setVaultSettings,
  syncVaultNow,
  writeVaultNote,
  deleteConversation,
  deletePaper,
  deleteTask,
  deleteVaultNote,
  renameConversation,
  renamePaper,
  setConversationPinned,
  setConversationSources,
  setConversationTier,
  setPaperPinned,
  getAppleStatus,
  getConversation,
  getDbStatus,
  getModelSettings,
  getOllamaStatus,
  getPaperDetail,
  importPaper,
  listConversations,
  listFolders,
  listPapers,
  onIndexProgress,
  removeFolder,
  removeHighlight,
  runIndex,
  runTierPrompt,
  savePaperNotes,
  searchLibrary,
  sendChatMessage,
  updateFeatureTier,
  updateHighlight,
  updateProvider,
  updateTier,
} from "@mental-lab/engine";

// Typed wrapper around ipcMain.handle: validates request and response
// against the shared zod schemas so contract drift fails loudly.
function handle<K extends InvokeChannel>(
  channel: K,
  handler: (
    args: IpcRequest<K>,
    event: IpcMainInvokeEvent
  ) => Promise<IpcResponse<K>> | IpcResponse<K>
) {
  ipcMain.handle(channel, async (event, rawArgs: unknown) => {
    const args = validateRequest(channel, rawArgs);
    const result = await handler(args, event);
    return validateResponse(channel, result);
  });
}

function sendEvent<K extends EventChannel>(
  target: WebContents,
  channel: K,
  payload: EventPayload<K>
) {
  target.send(channel, validateEvent(channel, payload));
}

export function broadcastEvent<K extends EventChannel>(
  channel: K,
  payload: EventPayload<K>
) {
  for (const win of BrowserWindow.getAllWindows()) {
    sendEvent(win.webContents, channel, payload);
  }
}

export function setupIpcHandlers() {
  handle("app:getVersions", () => ({
    app: app.getVersion(),
    electron: process.versions.electron ?? "",
    chrome: process.versions.chrome ?? "",
    node: process.versions.node ?? "",
  }));

  handle("app:getStatus", async () => {
    const { dbOk, dbPath } = await getDbStatus();
    return {
      dbOk,
      dbPath,
      appDataPath: app.getPath("userData"),
    };
  });

  handle("app:openExternal", async (args) => {
    // Only external schemes; file paths go through library:openFile.
    if (!/^(https?|x-apple\.systempreferences):/.test(args.url)) {
      return { ok: false };
    }
    await shell.openExternal(args.url);
    return { ok: true };
  });

  // ------------------------------------------------------------------
  // Models & tiers
  // ------------------------------------------------------------------

  handle("models:getSettings", () => getModelSettings());

  handle("models:setProvider", (args) => updateProvider(args));

  handle("models:setTier", (args) => updateTier(args.tier, args.patch));

  handle("models:setFeatureTier", (args) =>
    updateFeatureTier(args.featureId, args.tier)
  );

  handle("models:ollamaStatus", () => getOllamaStatus());

  handle("models:appleStatus", () => getAppleStatus());

  // ------------------------------------------------------------------
  // Library, search, chat
  // ------------------------------------------------------------------

  onIndexProgress((progress) => {
    for (const win of BrowserWindow.getAllWindows()) {
      sendEvent(win.webContents, "index:progress", progress);
    }
  });

  handle("library:list", () => listFolders());

  handle("library:addFolder", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      message: "Choose a folder to add to your library",
    });
    const chosen = result.filePaths[0];
    if (!result.canceled && chosen) {
      await addFolder(chosen);
      return { added: true, folders: await listFolders() };
    }
    return { added: false, folders: await listFolders() };
  });

  handle("library:removeFolder", async (args) => {
    await removeFolder(args.folderId);
    return listFolders();
  });

  handle("library:reindex", () => {
    void runIndex();
    return { started: true };
  });

  handle("library:openFile", async (args) => {
    const error = await shell.openPath(args.path);
    return { ok: error === "" };
  });

  handle("search:query", (args) => searchLibrary(args.query, args.limit));

  handle("chat:list", () => listConversations());

  handle("chat:get", (args) => getConversation(args.conversationId));

  handle("chat:send", async (args, event) => {
    const { requestId } = args;
    try {
      const result = await sendChatMessage({
        conversationId: args.conversationId,
        message: args.message,
        tier: args.tier ?? null,
        folderIds: args.folderIds ?? null,
        onDelta: (delta) => {
          sendEvent(event.sender, "stream:delta", { requestId, delta });
        },
      });
      sendEvent(event.sender, "stream:done", { requestId, error: null });
      return {
        ok: true,
        error: null,
        conversationId: result.conversationId,
        citations: result.citations,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendEvent(event.sender, "stream:done", { requestId, error: message });
      return { ok: false, error: message, conversationId: null, citations: [] };
    }
  });

  handle("chat:setSources", async (args) => {
    await setConversationSources(args.conversationId, args.folderIds);
    return listConversations();
  });

  handle("chat:setTier", async (args) => {
    await setConversationTier(args.conversationId, args.tier);
    return listConversations();
  });

  handle("chat:delete", async (args) => {
    await deleteConversation(args.conversationId);
    return listConversations();
  });

  handle("chat:rename", async (args) => {
    await renameConversation(args.conversationId, args.title);
    return listConversations();
  });

  handle("chat:setPinned", async (args) => {
    await setConversationPinned(args.conversationId, args.pinned);
    return listConversations();
  });

  // ------------------------------------------------------------------
  // Reader
  // ------------------------------------------------------------------

  handle("reader:deletePaper", async (args) => {
    await deletePaper(args.paperId);
    return listPapers();
  });

  handle("reader:renamePaper", async (args) => {
    await renamePaper(args.paperId, args.title);
    return listPapers();
  });

  handle("reader:setPaperPinned", async (args) => {
    await setPaperPinned(args.paperId, args.pinned);
    return listPapers();
  });

  handle("reader:importPaper", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "PDF", extensions: ["pdf"] }],
      message: "Choose a paper to import",
    });
    const chosen = result.filePaths[0];
    if (result.canceled || !chosen) return { paperId: null };
    const paperId = await importPaper(chosen);
    return { paperId };
  });

  handle("reader:listPapers", () => listPapers());

  handle("reader:findByPath", async (args) => ({
    paperId: await findPaperByPath(args.path),
  }));

  handle("reader:sendToVault", async (args) => {
    try {
      const noteName = await exportPaperToVault(args.paperId);
      return { ok: true, noteName, error: null };
    } catch (err) {
      return {
        ok: false,
        noteName: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  handle("reader:getPaper", (args) => getPaperDetail(args.paperId));

  handle("reader:addHighlight", (args) => addHighlight(args));

  handle("reader:updateHighlight", (args) => updateHighlight(args));

  handle("reader:removeHighlight", async (args) => {
    await removeHighlight(args.highlightId);
    return { ok: true as const };
  });

  handle("reader:saveNotes", async (args) => {
    await savePaperNotes(args.paperId, args.content);
    return { ok: true as const };
  });

  handle("reader:askCopilot", async (args, event) => {
    const { requestId } = args;
    try {
      const evidence = await askPaperCopilot({
        paperId: args.paperId,
        message: args.message,
        onDelta: (delta) => {
          sendEvent(event.sender, "stream:delta", { requestId, delta });
        },
      });
      sendEvent(event.sender, "stream:done", { requestId, error: null });
      return { ok: true, error: null, evidence };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendEvent(event.sender, "stream:done", { requestId, error: message });
      return { ok: false, error: message, evidence: [] };
    }
  });

  // ------------------------------------------------------------------
  // Agent tasks, automations, sandbox, agent config
  // ------------------------------------------------------------------

  handle("tasks:list", () => listTasks());

  handle("tasks:delete", async (args) => {
    await deleteTask(args.taskId);
    return listTasks();
  });

  handle("tasks:get", (args) => getTask(args.taskId));

  handle("tasks:run", async (args) => ({
    taskId: await runTask(args.prompt, "user"),
  }));

  handle("tasks:respond", (args) => ({
    ok: respondToRequest(args.requestId, args.approved, args.response),
  }));

  handle("automations:list", () => listAutomations());

  handle("automations:save", (args) => saveAutomation(args));

  handle("automations:delete", (args) => deleteAutomation(args.automationId));

  handle("automations:runNow", async (args) => ({
    taskId: await runAutomationNow(args.automationId),
  }));

  handle("sandbox:getSettings", () => {
    const config = getSandboxConfig();
    return {
      enabled: config.enabled,
      supported: isSandboxSupported(),
      allowedWritePaths: config.allowedWritePaths,
      deniedReadPaths: config.deniedReadPaths,
      allowedDomains: config.allowedDomains,
    };
  });

  handle("sandbox:setSettings", async (args) => {
    const config = await updateSandboxConfig(args);
    return {
      enabled: config.enabled,
      supported: isSandboxSupported(),
      allowedWritePaths: config.allowedWritePaths,
      deniedReadPaths: config.deniedReadPaths,
      allowedDomains: config.allowedDomains,
    };
  });

  handle("agent:getConfig", () => getAgentConfig());

  handle("agent:setConfig", (args) => setAgentConfig(args));

  // ------------------------------------------------------------------
  // Vault
  // ------------------------------------------------------------------

  handle("vault:getStatus", () => getVaultStatus());

  handle("vault:chooseFolder", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      message: "Choose the folder for your knowledge vault",
    });
    const chosen = result.filePaths[0];
    let error: string | null = null;
    if (!result.canceled && chosen) {
      try {
        await setVaultFolder(chosen);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    }
    return { status: await getVaultStatus(), error };
  });

  handle("vault:setSettings", async (args) => {
    await setVaultSettings(args);
    return getVaultStatus();
  });

  handle("vault:syncNow", async () => ({ started: await syncVaultNow() }));

  handle("vault:listNotes", () => getVaultNotes());

  handle("vault:deleteNote", async (args) => {
    await deleteVaultNote(args.name);
    return getVaultNotes();
  });

  handle("vault:readNote", async (args) => ({
    content: await readVaultNote(args.name),
  }));

  handle("vault:writeNote", async (args) => {
    await writeVaultNote(args.name, args.content);
    return { ok: true as const };
  });

  handle("vault:backlinks", (args) => getBacklinks(args.name));

  handle("vault:graph", () => getVaultGraph());

  handle("models:testPrompt", async (args, event) => {
    const { requestId, tier, prompt } = args;
    try {
      const resolved = await runTierPrompt(tier, prompt, (delta) => {
        sendEvent(event.sender, "stream:delta", { requestId, delta });
      });
      sendEvent(event.sender, "stream:done", { requestId, error: null });
      return {
        ok: true,
        error: null,
        resolvedTier: resolved.tier,
        provider: resolved.provider,
        model: resolved.model,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendEvent(event.sender, "stream:done", { requestId, error: message });
      return {
        ok: false,
        error: message,
        resolvedTier: null,
        provider: null,
        model: null,
      };
    }
  });
}
