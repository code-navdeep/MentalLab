import { z } from "zod";
import { Tier } from "./models.js";

export const LibraryFolderInfo = z.object({
  id: z.number(),
  path: z.string(),
  fileCount: z.number(),
  indexedCount: z.number(),
  errorCount: z.number(),
  /** Subdirectories the last scan could not read (permissions) */
  unreadableCount: z.number(),
  unreadablePaths: z.array(z.string()),
});
export type LibraryFolderInfo = z.infer<typeof LibraryFolderInfo>;

export const IndexProgress = z.object({
  phase: z.enum(["scanning", "indexing", "idle"]),
  currentFile: z.string().nullable(),
  done: z.number(),
  total: z.number(),
});
export type IndexProgress = z.infer<typeof IndexProgress>;

export const SearchResult = z.object({
  chunkId: z.number(),
  fileId: z.number(),
  path: z.string(),
  relPath: z.string(),
  fileType: z.string(),
  page: z.number().nullable(),
  snippet: z.string(),
  score: z.number(),
});
export type SearchResult = z.infer<typeof SearchResult>;

export const Citation = z.object({
  n: z.number(),
  fileId: z.number(),
  path: z.string(),
  relPath: z.string(),
  page: z.number().nullable(),
  snippet: z.string(),
});
export type Citation = z.infer<typeof Citation>;

export const ConversationMeta = z.object({
  id: z.number(),
  title: z.string(),
  updatedAt: z.string(),
  pinned: z.boolean(),
  tier: Tier.nullable(),
  folderIds: z.array(z.number()).nullable(),
});
export type ConversationMeta = z.infer<typeof ConversationMeta>;

export const ChatMessage = z.object({
  id: z.number(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  citations: z.array(Citation).nullable(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;
