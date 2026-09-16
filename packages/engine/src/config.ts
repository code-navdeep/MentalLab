import { eq, sql } from "drizzle-orm";
import { getDb } from "./db/index.js";
import { appConfig } from "./db/schema.js";

export async function getConfigValue<T>(key: string): Promise<T | null> {
  const { db } = getDb();
  const rows = await db
    .select({ value: appConfig.value })
    .from(appConfig)
    .where(eq(appConfig.key, key));
  return rows.length > 0 ? (rows[0]!.value as T) : null;
}

export async function setConfigValue(key: string, value: unknown): Promise<void> {
  const { db } = getDb();
  await db
    .insert(appConfig)
    .values({ key, value })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value, updatedAt: sql`now()` },
    });
}
