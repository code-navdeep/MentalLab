import { z } from "zod";

export const PaperMeta = z.object({
  id: z.number(),
  title: z.string(),
  originalFilename: z.string(),
  numPages: z.number(),
  status: z.enum(["processing", "ready", "error"]),
  error: z.string().nullable(),
  pinned: z.boolean(),
  createdAt: z.string(),
});
export type PaperMeta = z.infer<typeof PaperMeta>;

/** Highlight rectangle in fractional page coordinates (0..1). */
export const HighlightRect = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});
export type HighlightRect = z.infer<typeof HighlightRect>;

export const HIGHLIGHT_COLORS = ["yellow", "blue", "green", "pink"] as const;
export const HighlightColor = z.enum(HIGHLIGHT_COLORS);
export type HighlightColor = z.infer<typeof HighlightColor>;

export const Highlight = z.object({
  id: z.number(),
  page: z.number(),
  selectedText: z.string(),
  color: HighlightColor,
  note: z.string().nullable(),
  rects: z.array(HighlightRect),
  createdAt: z.string(),
});
export type Highlight = z.infer<typeof Highlight>;

/** A copilot citation: quote from the paper, located on a page (if found). */
export const EvidenceCite = z.object({
  n: z.number(),
  page: z.number().nullable(),
  quote: z.string(),
});
export type EvidenceCite = z.infer<typeof EvidenceCite>;

export const PaperMessage = z.object({
  id: z.number(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  evidence: z.array(EvidenceCite).nullable(),
  createdAt: z.string(),
});
export type PaperMessage = z.infer<typeof PaperMessage>;

export const PaperDetail = z.object({
  meta: PaperMeta,
  overview: z.string().nullable(),
  starterQuestions: z.array(z.string()),
  highlights: z.array(Highlight),
  notes: z.string(),
  messages: z.array(PaperMessage),
});
export type PaperDetail = z.infer<typeof PaperDetail>;
