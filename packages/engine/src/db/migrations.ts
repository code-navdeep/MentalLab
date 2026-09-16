import type { PGlite } from "@electric-sql/pglite";

// Forward-only, ordered migrations. Each entry runs once, tracked by name in
// the _migrations table. SQL lives in code so esbuild inlines it into the
// main-process bundle (no migration files to ship with the packaged app).
const migrations: { name: string; sql: string }[] = [
  {
    name: "0000_app_config",
    sql: `
      CREATE TABLE IF NOT EXISTS app_config (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      );
    `,
  },
  {
    name: "0001_library_chat",
    sql: `
      CREATE EXTENSION IF NOT EXISTS vector;

      CREATE TABLE library_folders (
        id SERIAL PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      );

      CREATE TABLE files (
        id SERIAL PRIMARY KEY,
        folder_id INTEGER NOT NULL REFERENCES library_folders(id) ON DELETE CASCADE,
        path TEXT NOT NULL UNIQUE,
        rel_path TEXT NOT NULL,
        file_type TEXT NOT NULL,
        size_bytes BIGINT NOT NULL DEFAULT 0,
        mtime TIMESTAMP,
        content_hash TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT,
        indexed_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      );

      CREATE TABLE chunks (
        id SERIAL PRIMARY KEY,
        file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        page INTEGER,
        text TEXT NOT NULL,
        embedding vector,
        fts TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', text)) STORED,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      );
      CREATE INDEX chunks_fts_idx ON chunks USING GIN (fts);
      CREATE INDEX chunks_file_idx ON chunks(file_id);

      CREATE TABLE conversations (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'New chat',
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      );

      CREATE TABLE messages (
        id SERIAL PRIMARY KEY,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        citations JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      );
      CREATE INDEX messages_conversation_idx ON messages(conversation_id);
    `,
  },
  {
    name: "0002_reader",
    sql: `
      CREATE TABLE papers (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        file_path TEXT NOT NULL UNIQUE,
        original_filename TEXT NOT NULL,
        num_pages INTEGER NOT NULL DEFAULT 0,
        overview TEXT,
        starter_questions JSONB,
        status TEXT NOT NULL DEFAULT 'processing',
        error TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      );

      CREATE TABLE paper_pages (
        id SERIAL PRIMARY KEY,
        paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
        page INTEGER NOT NULL,
        text TEXT NOT NULL,
        UNIQUE(paper_id, page)
      );

      CREATE TABLE highlights (
        id SERIAL PRIMARY KEY,
        paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
        page INTEGER NOT NULL,
        selected_text TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT 'yellow',
        note TEXT,
        rects JSONB NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      );
      CREATE INDEX highlights_paper_idx ON highlights(paper_id);

      CREATE TABLE paper_notes (
        paper_id INTEGER PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
        content TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      );

      CREATE TABLE paper_messages (
        id SERIAL PRIMARY KEY,
        paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        evidence JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      );
      CREATE INDEX paper_messages_paper_idx ON paper_messages(paper_id);
    `,
  },
  {
    name: "0003_agent",
    sql: `
      CREATE TABLE agent_tasks (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        source TEXT NOT NULL DEFAULT 'user',
        trajectory JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      );

      CREATE TABLE automations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        cron TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT true,
        last_run_at TIMESTAMP,
        last_task_id INTEGER,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      );
    `,
  },
  {
    name: "0004_chat_controls",
    sql: `
      ALTER TABLE conversations ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE conversations ADD COLUMN tier TEXT;
      ALTER TABLE conversations ADD COLUMN folder_ids JSONB;
      ALTER TABLE papers ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT false;
    `,
  },
];

export async function runMigrations(pg: PGlite): Promise<string[]> {
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT now()
    );
  `);

  const { rows } = await pg.query<{ name: string }>(
    "SELECT name FROM _migrations"
  );
  const applied = new Set(rows.map((r) => r.name));

  const newlyApplied: string[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    await pg.transaction(async (tx) => {
      await tx.exec(migration.sql);
      await tx.query("INSERT INTO _migrations (name) VALUES ($1)", [
        migration.name,
      ]);
    });
    newlyApplied.push(migration.name);
  }
  return newlyApplied;
}
