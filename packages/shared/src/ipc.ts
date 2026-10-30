import { z } from "zod";
import {
  AppleStatus,
  ModelSettingsPublic,
  OllamaStatus,
  ProviderId,
  Tier,
} from "./models.js";
import {
  ChatMessage,
  Citation,
  ConversationMeta,
  IndexProgress,
  LibraryFolderInfo,
  SearchResult,
} from "./library.js";
import {
  EvidenceCite,
  Highlight,
  HighlightColor,
  HighlightRect,
  PaperDetail,
  PaperMeta,
} from "./reader.js";
import {
  AgentConfigPublic,
  AutomationInfo,
  McpServerConfig,
  SandboxSettingsPublic,
  TaskMeta,
  TaskStatus,
  TrajectoryStep,
  UserRequest,
} from "./agent.js";
import {
  VaultGraph,
  VaultNoteInfo,
  VaultStatus,
  VaultStrictness,
  VaultSyncProgress,
} from "./vault.js";

// ============================================================================
// Request/response channels (renderer -> main, via ipcRenderer.invoke)
// Zod schemas are the single source of truth; TS types are derived from them.
// ============================================================================

export const ipcSchemas = {
  "app:getVersions": {
    req: z.null(),
    res: z.object({
      app: z.string(),
      electron: z.string(),
      chrome: z.string(),
      node: z.string(),
    }),
  },
  "app:getStatus": {
    req: z.null(),
    res: z.object({
      dbOk: z.boolean(),
      dbPath: z.string(),
      appDataPath: z.string(),
    }),
  },
  "app:openExternal": {
    req: z.object({ url: z.string() }),
    res: z.object({ ok: z.boolean() }),
  },
  "models:getSettings": {
    req: z.null(),
    res: ModelSettingsPublic,
  },
  "models:setProvider": {
    req: z.object({
      provider: ProviderId,
      enabled: z.boolean().optional(),
      // A string stores a new key (encrypted in main); null clears it.
      apiKey: z.string().nullable().optional(),
      baseUrl: z.string().nullable().optional(),
    }),
    res: ModelSettingsPublic,
  },
  "models:setTier": {
    req: z.object({
      tier: Tier,
      patch: z.object({
        enabled: z.boolean().optional(),
        provider: ProviderId.nullable().optional(),
        model: z.string().optional(),
      }),
    }),
    res: ModelSettingsPublic,
  },
  "models:setFeatureTier": {
    req: z.object({
      featureId: z.string(),
      tier: Tier,
    }),
    res: ModelSettingsPublic,
  },
  "models:ollamaStatus": {
    req: z.null(),
    res: OllamaStatus,
  },
  "models:appleStatus": {
    req: z.null(),
    res: AppleStatus,
  },
  "models:testPrompt": {
    req: z.object({
      requestId: z.string(),
      tier: Tier,
      prompt: z.string(),
    }),
    res: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      resolvedTier: Tier.nullable(),
      provider: ProviderId.nullable(),
      model: z.string().nullable(),
    }),
  },
  "library:list": {
    req: z.null(),
    res: z.array(LibraryFolderInfo),
  },
  "library:addFolder": {
    req: z.null(), // main shows the native folder picker
    res: z.object({
      added: z.boolean(),
      folders: z.array(LibraryFolderInfo),
    }),
  },
  "library:removeFolder": {
    req: z.object({ folderId: z.number() }),
    res: z.array(LibraryFolderInfo),
  },
  "library:reindex": {
    req: z.null(),
    res: z.object({ started: z.boolean() }),
  },
  "library:openFile": {
    req: z.object({ path: z.string() }),
    res: z.object({ ok: z.boolean() }),
  },
  "search:query": {
    req: z.object({ query: z.string(), limit: z.number().optional() }),
    res: z.array(SearchResult),
  },
  "chat:list": {
    req: z.null(),
    res: z.array(ConversationMeta),
  },
  "chat:get": {
    req: z.object({ conversationId: z.number() }),
    res: z.object({
      meta: ConversationMeta,
      messages: z.array(ChatMessage),
    }),
  },
  "chat:send": {
    req: z.object({
      requestId: z.string(),
      conversationId: z.number().nullable(),
      message: z.string(),
      tier: Tier.nullable().optional(),
      folderIds: z.array(z.number()).nullable().optional(),
    }),
    res: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      conversationId: z.number().nullable(),
      citations: z.array(Citation),
    }),
  },
  "chat:setSources": {
    req: z.object({
      conversationId: z.number(),
      folderIds: z.array(z.number()).nullable(),
    }),
    res: z.array(ConversationMeta),
  },
  "chat:setTier": {
    req: z.object({
      conversationId: z.number(),
      tier: Tier.nullable(),
    }),
    res: z.array(ConversationMeta),
  },
  "chat:delete": {
    req: z.object({ conversationId: z.number() }),
    res: z.array(ConversationMeta),
  },
  "chat:rename": {
    req: z.object({ conversationId: z.number(), title: z.string() }),
    res: z.array(ConversationMeta),
  },
  "chat:setPinned": {
    req: z.object({ conversationId: z.number(), pinned: z.boolean() }),
    res: z.array(ConversationMeta),
  },
  "reader:importPaper": {
    req: z.null(), // main shows the native file picker (PDF)
    res: z.object({ paperId: z.number().nullable() }),
  },
  "reader:listPapers": {
    req: z.null(),
    res: z.array(PaperMeta),
  },
  "reader:findByPath": {
    req: z.object({ path: z.string() }),
    res: z.object({ paperId: z.number().nullable() }),
  },
  "reader:sendToVault": {
    req: z.object({ paperId: z.number() }),
    res: z.object({
      ok: z.boolean(),
      noteName: z.string().nullable(),
      error: z.string().nullable(),
    }),
  },
  "reader:getPaper": {
    req: z.object({ paperId: z.number() }),
    res: PaperDetail,
  },
  "reader:addHighlight": {
    req: z.object({
      paperId: z.number(),
      page: z.number(),
      selectedText: z.string(),
      color: HighlightColor,
      note: z.string().nullable(),
      rects: z.array(HighlightRect),
    }),
    res: Highlight,
  },
  "reader:updateHighlight": {
    req: z.object({
      highlightId: z.number(),
      color: HighlightColor.optional(),
      note: z.string().nullable().optional(),
    }),
    res: Highlight,
  },
  "reader:removeHighlight": {
    req: z.object({ highlightId: z.number() }),
    res: z.object({ ok: z.literal(true) }),
  },
  "reader:saveNotes": {
    req: z.object({ paperId: z.number(), content: z.string() }),
    res: z.object({ ok: z.literal(true) }),
  },
  "reader:askCopilot": {
    req: z.object({
      requestId: z.string(),
      paperId: z.number(),
      message: z.string(),
    }),
    res: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      evidence: z.array(EvidenceCite),
    }),
  },
  "reader:deletePaper": {
    req: z.object({ paperId: z.number() }),
    res: z.array(PaperMeta),
  },
  "reader:renamePaper": {
    req: z.object({ paperId: z.number(), title: z.string() }),
    res: z.array(PaperMeta),
  },
  "reader:setPaperPinned": {
    req: z.object({ paperId: z.number(), pinned: z.boolean() }),
    res: z.array(PaperMeta),
  },
  "tasks:list": {
    req: z.null(),
    res: z.array(TaskMeta),
  },
  "tasks:get": {
    req: z.object({ taskId: z.number() }),
    res: z.object({
      meta: TaskMeta,
      trajectory: z.array(TrajectoryStep),
      pendingRequest: UserRequest.nullable(),
    }),
  },
  "tasks:run": {
    req: z.object({ prompt: z.string() }),
    res: z.object({ taskId: z.number() }),
  },
  "tasks:respond": {
    req: z.object({
      requestId: z.string(),
      approved: z.boolean(),
      response: z.string().nullable(),
    }),
    res: z.object({ ok: z.boolean() }),
  },
  "tasks:delete": {
    req: z.object({ taskId: z.number() }),
    res: z.array(TaskMeta),
  },
  "automations:list": {
    req: z.null(),
    res: z.array(AutomationInfo),
  },
  "automations:save": {
    req: z.object({
      id: z.number().nullable(), // null = create
      name: z.string(),
      prompt: z.string(),
      cron: z.string(),
      enabled: z.boolean(),
    }),
    res: z.array(AutomationInfo),
  },
  "automations:delete": {
    req: z.object({ automationId: z.number() }),
    res: z.array(AutomationInfo),
  },
  "automations:runNow": {
    req: z.object({ automationId: z.number() }),
    res: z.object({ taskId: z.number() }),
  },
  "sandbox:getSettings": {
    req: z.null(),
    res: SandboxSettingsPublic,
  },
  "sandbox:setSettings": {
    req: z.object({
      enabled: z.boolean().optional(),
      allowedWritePaths: z.array(z.string()).optional(),
      deniedReadPaths: z.array(z.string()).optional(),
      allowedDomains: z.array(z.string()).optional(),
    }),
    res: SandboxSettingsPublic,
  },
  "agent:getConfig": {
    req: z.null(),
    res: AgentConfigPublic,
  },
  "agent:setConfig": {
    req: z.object({
      braveKey: z.string().nullable().optional(),
      mcpServers: z.array(McpServerConfig).optional(),
    }),
    res: AgentConfigPublic,
  },
  "vault:getStatus": {
    req: z.null(),
    res: VaultStatus,
  },
  "vault:chooseFolder": {
    req: z.null(), // main shows the native folder picker
    res: z.object({ status: VaultStatus, error: z.string().nullable() }),
  },
  "vault:setSettings": {
    req: z.object({
      mailEnabled: z.boolean().optional(),
      calendarEnabled: z.boolean().optional(),
      strictness: VaultStrictness.optional(),
      mailDaysBack: z.number().optional(),
      autoSyncEnabled: z.boolean().optional(),
      syncIntervalMinutes: z.number().optional(),
    }),
    res: VaultStatus,
  },
  "vault:syncNow": {
    req: z.null(),
    res: z.object({ started: z.boolean() }),
  },
  "vault:listNotes": {
    req: z.null(),
    res: z.array(VaultNoteInfo),
  },
  "vault:deleteNote": {
    req: z.object({ name: z.string() }),
    res: z.array(VaultNoteInfo),
  },
  "vault:readNote": {
    req: z.object({ name: z.string() }),
    res: z.object({ content: z.string() }),
  },
  "vault:writeNote": {
    req: z.object({ name: z.string(), content: z.string() }),
    res: z.object({ ok: z.literal(true) }),
  },
  "vault:backlinks": {
    req: z.object({ name: z.string() }),
    res: z.array(z.object({ name: z.string(), snippet: z.string() })),
  },
  "vault:graph": {
    req: z.null(),
    res: VaultGraph,
  },
} as const;

export type IpcSchemas = typeof ipcSchemas;
export type InvokeChannel = keyof IpcSchemas;

export type IpcRequest<K extends InvokeChannel> = z.infer<IpcSchemas[K]["req"]>;
export type IpcResponse<K extends InvokeChannel> = z.infer<IpcSchemas[K]["res"]>;

export function validateRequest<K extends InvokeChannel>(
  channel: K,
  args: unknown
): IpcRequest<K> {
  const schema = ipcSchemas[channel];
  if (!schema) throw new Error(`Unknown IPC channel: ${channel}`);
  return schema.req.parse(args) as IpcRequest<K>;
}

export function validateResponse<K extends InvokeChannel>(
  channel: K,
  result: unknown
): IpcResponse<K> {
  const schema = ipcSchemas[channel];
  if (!schema) throw new Error(`Unknown IPC channel: ${channel}`);
  return schema.res.parse(result) as IpcResponse<K>;
}

// ============================================================================
// Push events (main -> renderer, via webContents.send)
// ============================================================================

export const eventSchemas = {
  "engine:log": z.object({
    level: z.enum(["debug", "info", "warn", "error"]),
    message: z.string(),
  }),
  // Generic model-output streaming, keyed by requestId. Used by the settings
  // test box now; chat and agent trajectories reuse the same channel shape.
  "stream:delta": z.object({
    requestId: z.string(),
    delta: z.string(),
  }),
  "stream:done": z.object({
    requestId: z.string(),
    error: z.string().nullable(),
  }),
  "index:progress": IndexProgress,
  // Paper import/processing lifecycle (overview generation finishing, errors).
  "paper:status": z.object({
    paperId: z.number(),
    status: z.enum(["processing", "ready", "error"]),
  }),
  // Agent task lifecycle
  "task:step": z.object({
    taskId: z.number(),
    step: TrajectoryStep,
  }),
  "task:status": z.object({
    taskId: z.number(),
    status: TaskStatus,
  }),
  "task:request": UserRequest,
  "vault:sync": VaultSyncProgress,
} as const;

export type EventSchemas = typeof eventSchemas;
export type EventChannel = keyof EventSchemas;
export type EventPayload<K extends EventChannel> = z.infer<EventSchemas[K]>;

export function validateEvent<K extends EventChannel>(
  channel: K,
  payload: unknown
): EventPayload<K> {
  const schema = eventSchemas[channel];
  if (!schema) throw new Error(`Unknown event channel: ${channel}`);
  return schema.parse(payload) as EventPayload<K>;
}

// ============================================================================
// The API surface preload exposes on window.ipc
// ============================================================================

export interface IpcApi {
  invoke<K extends InvokeChannel>(
    channel: K,
    args: IpcRequest<K>
  ): Promise<IpcResponse<K>>;
  on<K extends EventChannel>(
    channel: K,
    handler: (payload: EventPayload<K>) => void
  ): () => void;
}
