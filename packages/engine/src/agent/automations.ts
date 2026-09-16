import { Cron } from "croner";
import { desc, eq, sql } from "drizzle-orm";
import type { AutomationInfo } from "@mental-lab/shared";
import { getDb } from "../db/index.js";
import { automations } from "../db/schema.js";
import { runTask } from "./director.js";

const jobs = new Map<number, Cron>();

function rowToInfo(row: typeof automations.$inferSelect): AutomationInfo {
  let nextRunAt: string | null = null;
  if (row.enabled) {
    try {
      const next = new Cron(row.cron).nextRun();
      nextRunAt = next ? next.toISOString() : null;
    } catch {
      nextRunAt = null;
    }
  }
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    cron: row.cron,
    enabled: row.enabled,
    lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
    lastTaskId: row.lastTaskId,
    nextRunAt,
  };
}

async function fireAutomation(automationId: number): Promise<number> {
  const { db } = getDb();
  const rows = await db
    .select()
    .from(automations)
    .where(eq(automations.id, automationId));
  const automation = rows[0];
  if (!automation) throw new Error("Automation not found");

  const taskId = await runTask(automation.prompt, "automation");
  await db
    .update(automations)
    .set({ lastRunAt: sql`now()`, lastTaskId: taskId, updatedAt: sql`now()` })
    .where(eq(automations.id, automationId));
  return taskId;
}

function schedule(row: typeof automations.$inferSelect): void {
  jobs.get(row.id)?.stop();
  jobs.delete(row.id);
  if (!row.enabled) return;
  try {
    const job = new Cron(row.cron, () => {
      void fireAutomation(row.id).catch(() => {});
    });
    jobs.set(row.id, job);
  } catch {
    // Invalid cron expressions simply do not schedule; visible via nextRunAt: null
  }
}

export async function startAutomations(): Promise<void> {
  const { db } = getDb();
  const rows = await db.select().from(automations);
  for (const row of rows) schedule(row);
}

export async function listAutomations(): Promise<AutomationInfo[]> {
  const { db } = getDb();
  const rows = await db
    .select()
    .from(automations)
    .orderBy(desc(automations.createdAt));
  return rows.map(rowToInfo);
}

export async function saveAutomation(input: {
  id: number | null;
  name: string;
  prompt: string;
  cron: string;
  enabled: boolean;
}): Promise<AutomationInfo[]> {
  const { db } = getDb();
  if (input.id === null) {
    const inserted = await db
      .insert(automations)
      .values({
        name: input.name,
        prompt: input.prompt,
        cron: input.cron,
        enabled: input.enabled,
      })
      .returning();
    schedule(inserted[0]!);
  } else {
    const updated = await db
      .update(automations)
      .set({
        name: input.name,
        prompt: input.prompt,
        cron: input.cron,
        enabled: input.enabled,
        updatedAt: sql`now()`,
      })
      .where(eq(automations.id, input.id))
      .returning();
    if (updated[0]) schedule(updated[0]);
  }
  return listAutomations();
}

export async function deleteAutomation(
  automationId: number
): Promise<AutomationInfo[]> {
  const { db } = getDb();
  jobs.get(automationId)?.stop();
  jobs.delete(automationId);
  await db.delete(automations).where(eq(automations.id, automationId));
  return listAutomations();
}

export async function runAutomationNow(automationId: number): Promise<number> {
  return fireAutomation(automationId);
}
