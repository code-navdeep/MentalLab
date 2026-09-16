import { z } from "zod";

export const VaultStrictness = z.enum(["high", "medium", "low"]);
export type VaultStrictness = z.infer<typeof VaultStrictness>;

export const ConnectorAccess = z.enum(["granted", "denied", "unknown"]);
export type ConnectorAccess = z.infer<typeof ConnectorAccess>;

export const VaultStatus = z.object({
  folder: z.string().nullable(),
  mailEnabled: z.boolean(),
  calendarEnabled: z.boolean(),
  strictness: VaultStrictness,
  mailDaysBack: z.number(),
  autoSyncEnabled: z.boolean(),
  syncIntervalMinutes: z.number(),
  mailAccess: ConnectorAccess,
  calendarAccess: ConnectorAccess,
  lastSyncAt: z.string().nullable(),
  syncing: z.boolean(),
  noteCount: z.number(),
  sourceCount: z.number(),
});
export type VaultStatus = z.infer<typeof VaultStatus>;

export const NOTE_TYPES = [
  "person",
  "org",
  "project",
  "topic",
  "paper",
  "other",
] as const;
export const NoteType = z.enum(NOTE_TYPES);
export type NoteType = z.infer<typeof NoteType>;

export const VaultNoteInfo = z.object({
  name: z.string(), // filename without .md
  type: NoteType,
  updatedAt: z.string(),
});
export type VaultNoteInfo = z.infer<typeof VaultNoteInfo>;

export const VaultGraph = z.object({
  nodes: z.array(
    z.object({
      id: z.string(), // note name
      type: NoteType,
      degree: z.number(),
    })
  ),
  edges: z.array(z.object({ from: z.string(), to: z.string() })),
});
export type VaultGraph = z.infer<typeof VaultGraph>;

export const VaultSyncProgress = z.object({
  phase: z.enum(["mail", "calendar", "graph", "indexing", "idle", "error"]),
  detail: z.string().nullable(),
});
export type VaultSyncProgress = z.infer<typeof VaultSyncProgress>;
