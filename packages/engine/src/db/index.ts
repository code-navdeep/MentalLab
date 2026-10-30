import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";
import path from "node:path";
import * as schema from "./schema.js";
import { runMigrations } from "./migrations.js";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface DbHandle {
  db: Db;
  pg: PGlite;
  dbPath: string;
}

let handle: DbHandle | null = null;

export async function initDb(dataDir: string): Promise<DbHandle> {
  if (handle) return handle;

  const dbPath = path.join(dataDir, "db");
  const pg = await PGlite.create(dbPath, { extensions: { vector } });
  await runMigrations(pg);

  const db = drizzle(pg, { schema });
  handle = { db, pg, dbPath };
  return handle;
}

export function getDb(): DbHandle {
  if (!handle) throw new Error("Database not initialized — call initDb first");
  return handle;
}

/** Quit, last step: close the database cleanly, after everything that writes. */
export async function closeDb(): Promise<void> {
  if (!handle) return;
  const { pg } = handle;
  handle = null;
  await pg.close();
}

export async function getDbStatus(): Promise<{ dbOk: boolean; dbPath: string }> {
  if (!handle) return { dbOk: false, dbPath: "" };
  try {
    await handle.pg.query("SELECT 1");
    return { dbOk: true, dbPath: handle.dbPath };
  } catch {
    return { dbOk: false, dbPath: handle.dbPath };
  }
}

export { schema };
