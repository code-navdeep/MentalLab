import {
  bigint,
  boolean,
  customType,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
};

// Dimensionless pgvector column. The embedding dimension is decided at
// runtime by the active embeddings source (384 local / 768 Ollama), so the
// DDL stays dimension-free and rows carry their own width.
const vectorCol = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector";
  },
  toDriver(value) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value) {
    return JSON.parse(value) as number[];
  },
});

// Generic key-value store for app configuration (model tier mappings,
// provider settings, library folders, etc.). Values are JSON.
export const appConfig = pgTable("app_config", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  ...timestamps,
});

export const libraryFolders = pgTable("library_folders", {
  id: serial("id").primaryKey(),
  path: text("path").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const files = pgTable("files", {
  id: serial("id").primaryKey(),
  folderId: integer("folder_id")
    .notNull()
    .references(() => libraryFolders.id, { onDelete: "cascade" }),
  path: text("path").notNull().unique(),
  relPath: text("rel_path").notNull(),
  fileType: text("file_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
  mtime: timestamp("mtime"),
  contentHash: text("content_hash"),
  status: text("status").notNull().default("pending"),
  error: text("error"),
  indexedAt: timestamp("indexed_at"),
  ...timestamps,
});

export const chunks = pgTable("chunks", {
  id: serial("id").primaryKey(),
  fileId: integer("file_id")
    .notNull()
    .references(() => files.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(),
  page: integer("page"),
  text: text("text").notNull(),
  embedding: vectorCol("embedding"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull().default("New chat"),
  pinned: boolean("pinned").notNull().default(false),
  tier: text("tier"),
  folderIds: jsonb("folder_ids"),
  ...timestamps,
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  citations: jsonb("citations"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const papers = pgTable("papers", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  filePath: text("file_path").notNull().unique(),
  originalFilename: text("original_filename").notNull(),
  numPages: integer("num_pages").notNull().default(0),
  overview: text("overview"),
  starterQuestions: jsonb("starter_questions"),
  status: text("status").notNull().default("processing"),
  error: text("error"),
  pinned: boolean("pinned").notNull().default(false),
  ...timestamps,
});

export const paperPages = pgTable("paper_pages", {
  id: serial("id").primaryKey(),
  paperId: integer("paper_id")
    .notNull()
    .references(() => papers.id, { onDelete: "cascade" }),
  page: integer("page").notNull(),
  text: text("text").notNull(),
});

export const highlights = pgTable("highlights", {
  id: serial("id").primaryKey(),
  paperId: integer("paper_id")
    .notNull()
    .references(() => papers.id, { onDelete: "cascade" }),
  page: integer("page").notNull(),
  selectedText: text("selected_text").notNull(),
  color: text("color").notNull().default("yellow"),
  note: text("note"),
  rects: jsonb("rects").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const paperNotes = pgTable("paper_notes", {
  paperId: integer("paper_id")
    .primaryKey()
    .references(() => papers.id, { onDelete: "cascade" }),
  content: text("content").notNull().default(""),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const paperMessages = pgTable("paper_messages", {
  id: serial("id").primaryKey(),
  paperId: integer("paper_id")
    .notNull()
    .references(() => papers.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  evidence: jsonb("evidence"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const agentTasks = pgTable("agent_tasks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  status: text("status").notNull().default("running"),
  source: text("source").notNull().default("user"),
  trajectory: jsonb("trajectory").notNull().default([]),
  ...timestamps,
});

export const automations = pgTable("automations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  prompt: text("prompt").notNull(),
  cron: text("cron").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at"),
  lastTaskId: integer("last_task_id"),
  ...timestamps,
});
