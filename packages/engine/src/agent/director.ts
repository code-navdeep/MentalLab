import { desc, eq, sql } from "drizzle-orm";
import { stepCountIs, streamText, type Tool } from "ai";
import { createMCPClient } from "@ai-sdk/mcp";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  TaskMeta,
  TaskStatus,
  TrajectoryStep,
  UserRequest,
} from "@mental-lab/shared";
import { getDb } from "../db/index.js";
import { agentTasks } from "../db/schema.js";
import { generateForFeature, loadSettings } from "../models/index.js";
import { buildLanguageModel } from "../models/providers.js";
import { resolveFeature } from "../models/router.js";
import { getMcpServers } from "./agent-config.js";
import { buildAgentSystemPrompt } from "./prompts.js";
import { loadSkills } from "./skills.js";
import { buildTools, truncateOutput, type TaskContext } from "./tools.js";

const MAX_STEPS = 30;

// ---------------------------------------------------------------------------
// Event wiring (main injects broadcasters at boot)
// ---------------------------------------------------------------------------

interface AgentEvents {
  onStep: (taskId: number, step: TrajectoryStep) => void;
  onStatus: (taskId: number, status: TaskStatus) => void;
  onRequest: (request: UserRequest) => void;
}

let events: AgentEvents = {
  onStep: () => {},
  onStatus: () => {},
  onRequest: () => {},
};

export function configureAgentEvents(e: AgentEvents): void {
  events = e;
}

// ---------------------------------------------------------------------------
// Pending user requests (confirmation gate + ask_user)
// ---------------------------------------------------------------------------

interface PendingRequest {
  request: UserRequest;
  resolve: (result: { approved: boolean; response: string | null }) => void;
}

const pendingRequests = new Map<string, PendingRequest>();
const pendingByTask = new Map<number, UserRequest>();

export function respondToRequest(
  requestId: string,
  approved: boolean,
  response: string | null
): boolean {
  const pending = pendingRequests.get(requestId);
  if (!pending) return false;
  pendingRequests.delete(requestId);
  pendingByTask.delete(pending.request.taskId);
  pending.resolve({ approved, response });
  return true;
}

export function getPendingRequest(taskId: number): UserRequest | null {
  return pendingByTask.get(taskId) ?? null;
}

// MCP tool-server connections of running tasks, so app quit can close them.
const openMcpClients = new Set<{ close: () => Promise<void> }>();

/** Quit, step 2: close every MCP connection still open. */
export async function closeAgentConnections(): Promise<void> {
  const clients = [...openMcpClients];
  openMcpClients.clear();
  await Promise.all(clients.map((client) => client.close().catch(() => {})));
}

// ---------------------------------------------------------------------------
// Task persistence helpers
// ---------------------------------------------------------------------------

function rowToMeta(row: typeof agentTasks.$inferSelect): TaskMeta {
  return {
    id: row.id,
    title: row.title,
    status: row.status as TaskStatus,
    source: row.source as TaskMeta["source"],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listTasks(): Promise<TaskMeta[]> {
  const { db } = getDb();
  const rows = await db
    .select()
    .from(agentTasks)
    .orderBy(desc(agentTasks.createdAt));
  return rows.map(rowToMeta);
}

export async function getTask(taskId: number): Promise<{
  meta: TaskMeta;
  trajectory: TrajectoryStep[];
  pendingRequest: UserRequest | null;
}> {
  const { db } = getDb();
  const rows = await db
    .select()
    .from(agentTasks)
    .where(eq(agentTasks.id, taskId));
  const row = rows[0];
  if (!row) throw new Error("Task not found");
  return {
    meta: rowToMeta(row),
    trajectory: (row.trajectory as TrajectoryStep[]) ?? [],
    pendingRequest: getPendingRequest(taskId),
  };
}

export async function deleteTask(taskId: number): Promise<void> {
  const { db } = getDb();
  const rows = await db
    .select({ status: agentTasks.status })
    .from(agentTasks)
    .where(eq(agentTasks.id, taskId));
  const row = rows[0];
  if (!row) return;
  if (row.status === "running" || row.status === "waiting") {
    throw new Error("Stop the task before deleting it");
  }
  await db.delete(agentTasks).where(eq(agentTasks.id, taskId));
}

/** Mark tasks left running by a previous app session as interrupted. */
export async function cleanupOrphanedTasks(): Promise<void> {
  const { db } = getDb();
  await db
    .update(agentTasks)
    .set({ status: "error", updatedAt: sql`now()` })
    .where(sql`${agentTasks.status} IN ('running', 'waiting')`);
}

// ---------------------------------------------------------------------------
// The run loop
// ---------------------------------------------------------------------------

export async function runTask(
  prompt: string,
  source: "user" | "automation" = "user"
): Promise<number> {
  const { db } = getDb();
  const inserted = await db
    .insert(agentTasks)
    .values({
      title: prompt.length > 80 ? prompt.slice(0, 77) + "…" : prompt,
      status: "running",
      source,
      trajectory: [{ type: "user", text: prompt }],
    })
    .returning({ id: agentTasks.id });
  const taskId = inserted[0]!.id;

  void executeTask(taskId, prompt).catch(() => {});
  void nameTask(taskId, prompt);
  return taskId;
}

async function nameTask(taskId: number, prompt: string): Promise<void> {
  try {
    const title = await generateForFeature(
      "titles",
      `Write a title of at most six words for this task. Reply with the title only, no quotes.\n\nTask: ${prompt.slice(0, 500)}`
    );
    const cleaned = title.replace(/^["']|["']$/g, "").slice(0, 80);
    if (cleaned) {
      const { db } = getDb();
      await db
        .update(agentTasks)
        .set({ title: cleaned })
        .where(eq(agentTasks.id, taskId));
    }
  } catch {
    // best-effort
  }
}

async function executeTask(taskId: number, prompt: string): Promise<void> {
  const { db } = getDb();
  const trajectory: TrajectoryStep[] = [{ type: "user", text: prompt }];

  const persist = async () => {
    await db
      .update(agentTasks)
      .set({ trajectory, updatedAt: sql`now()` })
      .where(eq(agentTasks.id, taskId));
  };

  const emit = async (step: TrajectoryStep) => {
    trajectory.push(step);
    events.onStep(taskId, step);
    await persist();
  };

  const setStatus = async (status: TaskStatus) => {
    await db
      .update(agentTasks)
      .set({ status, updatedAt: sql`now()` })
      .where(eq(agentTasks.id, taskId));
    events.onStatus(taskId, status);
  };

  const ctx: TaskContext = {
    requestUser: (req) => {
      const requestId = crypto.randomUUID();
      const request: UserRequest = { requestId, taskId, ...req };
      return new Promise((resolve) => {
        pendingRequests.set(requestId, {
          request,
          resolve: (result) => {
            void setStatus("running");
            resolve(result);
          },
        });
        pendingByTask.set(taskId, request);
        void setStatus("waiting");
        events.onRequest(request);
      });
    },
  };

  const mcpClients: { close: () => Promise<void> }[] = [];
  try {
    // Model: the 'agent' feature must land on a tool-capable provider.
    const settings = await loadSettings();
    const resolved = resolveFeature(settings, "agent");
    if (resolved.provider === "apple") {
      throw new Error(
        "Agent tasks need a tool-capable model — assign Ollama or an API model to the tier that handles agent tasks"
      );
    }
    const model = buildLanguageModel(settings, resolved.provider, resolved.model);

    // Tools: built-ins + MCP servers (connected per run, namespaced).
    await loadSkills();
    const tools: Record<string, Tool> = await buildTools(ctx);
    for (const server of await getMcpServers()) {
      try {
        const client = await createMCPClient({
          transport: new StdioClientTransport({
            command: server.command,
            args: server.args,
          }),
        });
        mcpClients.push(client);
        openMcpClients.add(client);
        const serverTools = await client.tools();
        for (const [name, t] of Object.entries(serverTools)) {
          tools[`${server.name}__${name}`] = t as Tool;
        }
      } catch (err) {
        await emit({
          type: "error",
          message: `MCP server "${server.name}" failed to start: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    const result = streamText({
      model,
      system: buildAgentSystemPrompt(),
      messages: [{ role: "user", content: prompt }],
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
    });

    let textBuffer = "";
    let thoughtBuffer = "";
    const flushText = async () => {
      if (textBuffer.trim()) {
        await emit({ type: "text", text: textBuffer.trim() });
      }
      textBuffer = "";
    };
    const flushThought = async () => {
      if (thoughtBuffer.trim()) {
        await emit({ type: "thought", text: thoughtBuffer.trim() });
      }
      thoughtBuffer = "";
    };

    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta":
          textBuffer += part.text;
          break;
        case "reasoning-delta":
          thoughtBuffer += part.text;
          break;
        case "tool-call": {
          await flushThought();
          await flushText();
          await emit({
            type: "tool_call",
            callId: part.toolCallId,
            name: part.toolName,
            args: (part.input ?? {}) as Record<string, unknown>,
          });
          break;
        }
        case "tool-result": {
          const output =
            typeof part.output === "string"
              ? part.output
              : JSON.stringify(part.output, null, 2);
          await emit({
            type: "tool_result",
            callId: part.toolCallId,
            name: part.toolName,
            result: truncateOutput(output ?? ""),
          });
          break;
        }
        case "error": {
          const message =
            part.error instanceof Error
              ? part.error.message
              : String(part.error);
          await emit({ type: "error", message });
          break;
        }
        default:
          break;
      }
    }
    await flushThought();
    await flushText();
    await setStatus("done");
  } catch (err) {
    trajectory.push({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
    events.onStep(taskId, trajectory[trajectory.length - 1]!);
    await persist();
    await setStatus("error");
  } finally {
    for (const client of mcpClients) {
      openMcpClients.delete(client);
      void client.close().catch(() => {});
    }
  }
}
