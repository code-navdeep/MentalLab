import { z } from "zod";

// ============================================================================
// Trajectory — the ordered record of one agent task run.
// Persisted as JSONB on agent_tasks and streamed live to the UI.
// ============================================================================

export const TrajectoryStep = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user"), text: z.string() }),
  z.object({ type: z.literal("thought"), text: z.string() }),
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("tool_call"),
    callId: z.string(),
    name: z.string(),
    args: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("tool_result"),
    callId: z.string(),
    name: z.string(),
    result: z.string(),
  }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type TrajectoryStep = z.infer<typeof TrajectoryStep>;

export const TaskStatus = z.enum(["running", "waiting", "done", "error"]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const TaskMeta = z.object({
  id: z.number(),
  title: z.string(),
  status: TaskStatus,
  source: z.enum(["user", "automation"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TaskMeta = z.infer<typeof TaskMeta>;

// ============================================================================
// Mid-task requests to the user (confirmation gate + ask_user tool)
// ============================================================================

export const UserRequest = z.object({
  requestId: z.string(),
  taskId: z.number(),
  kind: z.enum(["confirm", "ask"]),
  title: z.string(),
  description: z.string().nullable(),
  /** For confirm: the shell command awaiting approval */
  command: z.string().nullable(),
  /** For ask with choices */
  options: z.array(z.string()),
  /** ask only: expect free text instead of a choice */
  textInput: z.boolean(),
});
export type UserRequest = z.infer<typeof UserRequest>;

// ============================================================================
// Sandbox settings (user-editable; enforced by Seatbelt on macOS)
// ============================================================================

export const SandboxSettingsPublic = z.object({
  enabled: z.boolean(),
  supported: z.boolean(),
  allowedWritePaths: z.array(z.string()),
  deniedReadPaths: z.array(z.string()),
  allowedDomains: z.array(z.string()),
});
export type SandboxSettingsPublic = z.infer<typeof SandboxSettingsPublic>;

// ============================================================================
// Automations
// ============================================================================

export const AutomationInfo = z.object({
  id: z.number(),
  name: z.string(),
  prompt: z.string(),
  cron: z.string(),
  enabled: z.boolean(),
  lastRunAt: z.string().nullable(),
  lastTaskId: z.number().nullable(),
  nextRunAt: z.string().nullable(),
});
export type AutomationInfo = z.infer<typeof AutomationInfo>;

// ============================================================================
// Agent config (web search key, MCP servers)
// ============================================================================

export const McpServerConfig = z.object({
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()),
});
export type McpServerConfig = z.infer<typeof McpServerConfig>;

export const AgentConfigPublic = z.object({
  braveKeySet: z.boolean(),
  mcpServers: z.array(McpServerConfig),
});
export type AgentConfigPublic = z.infer<typeof AgentConfigPublic>;
