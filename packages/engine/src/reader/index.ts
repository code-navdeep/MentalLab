import { randomUUID } from "node:crypto";
import { copyFile, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { asc, desc, eq, sql } from "drizzle-orm";
import type {
  EvidenceCite,
  Highlight,
  HighlightColor,
  HighlightRect,
  PaperDetail,
  PaperMessage,
  PaperMeta,
} from "@mental-lab/shared";
import { getDb } from "../db/index.js";
import {
  files,
  highlights,
  paperMessages,
  paperNotes,
  paperPages,
  papers,
} from "../db/schema.js";
import { readPdfDocument } from "../indexer/parse.js";
import { retrieveContext } from "../indexer/search.js";
import {
  generateForFeature,
  streamForFeature,
  type ChatTurn,
} from "../models/index.js";

const FULL_TEXT_LIMIT = 30_000;
const HISTORY_TURNS = 8;

let papersDir: string | null = null;
type StatusListener = (paperId: number, status: "processing" | "ready" | "error") => void;
let statusListener: StatusListener = () => {};

export function configureReader(opts: {
  papersDir: string;
  onStatus?: StatusListener;
}): void {
  papersDir = opts.papersDir;
  if (opts.onStatus) statusListener = opts.onStatus;
}

export function getPapersDir(): string {
  if (!papersDir) throw new Error("Reader not configured");
  return papersDir;
}

// ---------------------------------------------------------------------------
// Import + brief generation
// ---------------------------------------------------------------------------

export async function importPaper(sourcePath: string): Promise<number> {
  const dir = getPapersDir();
  await mkdir(dir, { recursive: true });
  const destPath = path.join(dir, `${randomUUID()}.pdf`);
  await copyFile(sourcePath, destPath);

  const doc = await readPdfDocument(destPath);
  const originalFilename = path.basename(sourcePath);
  const title =
    doc.title ?? originalFilename.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ");

  const { db } = getDb();
  const inserted = await db
    .insert(papers)
    .values({
      title,
      filePath: destPath,
      originalFilename,
      numPages: doc.numPages,
      status: "processing",
    })
    .returning({ id: papers.id });
  const paperId = inserted[0]!.id;

  for (const page of doc.pages) {
    await db
      .insert(paperPages)
      .values({ paperId, page: page.page, text: page.text });
  }

  void generatePaperBrief(paperId);
  return paperId;
}

async function paperFullText(paperId: number): Promise<string> {
  const { db } = getDb();
  const pages = await db
    .select()
    .from(paperPages)
    .where(eq(paperPages.paperId, paperId))
    .orderBy(asc(paperPages.page));
  return pages.map((p) => `[Page ${p.page}]\n${p.text}`).join("\n\n");
}

export async function generatePaperBrief(paperId: number): Promise<void> {
  const { db } = getDb();
  try {
    const text = await paperFullText(paperId);
    const clipped = text.slice(0, FULL_TEXT_LIMIT);
    const raw = await generateForFeature(
      "summaries",
      `Here is a paper. Write a brief for a reader about to study it.

Respond with exactly this JSON, nothing else:
{"overview": "<one dense paragraph: what the paper does, how, and what it finds>", "questions": ["<q1>", "<q2>", "<q3>"]}

The three questions should be the sharpest starter questions a reader would want answered while reading.

Paper:
${clipped}`
    );

    let overview = "";
    let questions: string[] = [];
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw) as {
        overview?: string;
        questions?: string[];
      };
      overview = parsed.overview ?? "";
      questions = (parsed.questions ?? []).slice(0, 3);
    } catch {
      overview = raw; // model ignored the format — keep its text as overview
    }

    await db
      .update(papers)
      .set({
        overview,
        starterQuestions: questions,
        status: "ready",
        updatedAt: sql`now()`,
      })
      .where(eq(papers.id, paperId));
    statusListener(paperId, "ready");
  } catch (err) {
    await db
      .update(papers)
      .set({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      })
      .where(eq(papers.id, paperId));
    statusListener(paperId, "error");
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

function rowToMeta(row: typeof papers.$inferSelect): PaperMeta {
  return {
    id: row.id,
    title: row.title,
    originalFilename: row.originalFilename,
    numPages: row.numPages,
    status: row.status as PaperMeta["status"],
    error: row.error,
    pinned: row.pinned,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listPapers(): Promise<PaperMeta[]> {
  const { db } = getDb();
  const rows = await db
    .select()
    .from(papers)
    .orderBy(desc(papers.pinned), desc(papers.createdAt));
  return rows.map(rowToMeta);
}

export async function deletePaper(paperId: number): Promise<void> {
  const { db } = getDb();
  const rows = await db.select().from(papers).where(eq(papers.id, paperId));
  const paper = rows[0];
  if (!paper) return;
  // Row first (pages/highlights/notes/messages cascade), then the stored PDF,
  // then its library index entry (chunks cascade) so search stops citing it.
  await db.delete(papers).where(eq(papers.id, paperId));
  await unlink(paper.filePath).catch(() => {});
  await db.delete(files).where(eq(files.path, paper.filePath));
}

export async function renamePaper(paperId: number, title: string): Promise<void> {
  const cleaned = title.trim().slice(0, 200);
  if (!cleaned) throw new Error("Title cannot be empty");
  const { db } = getDb();
  await db
    .update(papers)
    .set({ title: cleaned, updatedAt: sql`now()` })
    .where(eq(papers.id, paperId));
}

export async function setPaperPinned(
  paperId: number,
  pinned: boolean
): Promise<void> {
  const { db } = getDb();
  await db.update(papers).set({ pinned }).where(eq(papers.id, paperId));
}

export async function getPaperFilePath(paperId: number): Promise<string | null> {
  const { db } = getDb();
  const rows = await db.select().from(papers).where(eq(papers.id, paperId));
  return rows[0]?.filePath ?? null;
}

export async function findPaperByPath(filePath: string): Promise<number | null> {
  const { db } = getDb();
  const rows = await db
    .select({ id: papers.id })
    .from(papers)
    .where(eq(papers.filePath, filePath));
  return rows[0]?.id ?? null;
}

function rowToHighlight(row: typeof highlights.$inferSelect): Highlight {
  return {
    id: row.id,
    page: row.page,
    selectedText: row.selectedText,
    color: row.color as HighlightColor,
    note: row.note,
    rects: row.rects as HighlightRect[],
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getPaperDetail(paperId: number): Promise<PaperDetail> {
  const { db } = getDb();
  const paperRows = await db.select().from(papers).where(eq(papers.id, paperId));
  const paper = paperRows[0];
  if (!paper) throw new Error("Paper not found");

  const highlightRows = await db
    .select()
    .from(highlights)
    .where(eq(highlights.paperId, paperId))
    .orderBy(asc(highlights.page), asc(highlights.id));

  const noteRows = await db
    .select()
    .from(paperNotes)
    .where(eq(paperNotes.paperId, paperId));

  const messageRows = await db
    .select()
    .from(paperMessages)
    .where(eq(paperMessages.paperId, paperId))
    .orderBy(asc(paperMessages.createdAt), asc(paperMessages.id));

  return {
    meta: rowToMeta(paper),
    overview: paper.overview,
    starterQuestions: (paper.starterQuestions as string[] | null) ?? [],
    highlights: highlightRows.map(rowToHighlight),
    notes: noteRows[0]?.content ?? "",
    messages: messageRows.map((m) => ({
      id: m.id,
      role: m.role as PaperMessage["role"],
      content: m.content,
      evidence: (m.evidence as EvidenceCite[] | null) ?? null,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

// ---------------------------------------------------------------------------
// Highlights + notes
// ---------------------------------------------------------------------------

export async function addHighlight(input: {
  paperId: number;
  page: number;
  selectedText: string;
  color: HighlightColor;
  note: string | null;
  rects: HighlightRect[];
}): Promise<Highlight> {
  const { db } = getDb();
  const rows = await db
    .insert(highlights)
    .values(input)
    .returning();
  return rowToHighlight(rows[0]!);
}

export async function updateHighlight(input: {
  highlightId: number;
  color?: HighlightColor;
  note?: string | null;
}): Promise<Highlight> {
  const { db } = getDb();
  const set: Partial<typeof highlights.$inferInsert> = {};
  if (input.color !== undefined) set.color = input.color;
  if (input.note !== undefined) set.note = input.note;
  const rows = await db
    .update(highlights)
    .set(set)
    .where(eq(highlights.id, input.highlightId))
    .returning();
  if (!rows[0]) throw new Error("Highlight not found");
  return rowToHighlight(rows[0]);
}

export async function removeHighlight(highlightId: number): Promise<void> {
  const { db } = getDb();
  await db.delete(highlights).where(eq(highlights.id, highlightId));
}

export async function savePaperNotes(
  paperId: number,
  content: string
): Promise<void> {
  const { db } = getDb();
  await db
    .insert(paperNotes)
    .values({ paperId, content })
    .onConflictDoUpdate({
      target: paperNotes.paperId,
      set: { content, updatedAt: sql`now()` },
    });
}

// ---------------------------------------------------------------------------
// Copilot with the @cite evidence protocol
// ---------------------------------------------------------------------------

const COPILOT_SYSTEM = `You are the reading copilot for a research paper inside Mental Lab. Answer the reader's question from the paper content provided.

Cite your claims with inline markers [1], [2], … Then, after your answer, output an evidence block in exactly this format:

---EVIDENCE---
@cite[1]
"verbatim quote from the paper supporting claim 1"
@cite[2]
"verbatim quote supporting claim 2"
---END-EVIDENCE---

Rules:
- Quotes must be exact substrings of the paper text, 5 to 40 words each.
- Every [n] used in the answer must have a matching @cite[n] entry.
- If the paper does not answer the question, say so; include no evidence block.
- Be direct and concise. Use markdown when it helps.`;

const EVIDENCE_MARKER = "---EVIDENCE---";
const EVIDENCE_END = "---END-EVIDENCE-";

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseEvidence(full: string): { answer: string; cites: { n: number; quote: string }[] } {
  const idx = full.indexOf(EVIDENCE_MARKER);
  if (idx < 0) return { answer: full.trim(), cites: [] };
  const answer = full.slice(0, idx).trim();
  const block = full.slice(idx + EVIDENCE_MARKER.length);
  const cites: { n: number; quote: string }[] = [];
  const re = /@cite\[(\d+)\]\s*\n?"?([\s\S]*?)"?\s*(?=@cite\[|---END-EVIDENCE-|$)/g;
  for (const m of block.matchAll(re)) {
    const quote = m[2]!.replace(/\s+/g, " ").trim();
    if (quote) cites.push({ n: Number(m[1]), quote });
  }
  return { answer, cites };
}

async function locateQuotes(
  paperId: number,
  cites: { n: number; quote: string }[]
): Promise<EvidenceCite[]> {
  const { db } = getDb();
  const pages = await db
    .select()
    .from(paperPages)
    .where(eq(paperPages.paperId, paperId))
    .orderBy(asc(paperPages.page));
  const normalizedPages = pages.map((p) => ({
    page: p.page,
    norm: normalize(p.text),
  }));

  return cites.map((c) => {
    const normQuote = normalize(c.quote);
    const probe =
      normQuote.length > 120 ? normQuote.slice(0, 120) : normQuote;
    const hit = normalizedPages.find((p) => p.norm.includes(probe));
    return { n: c.n, page: hit?.page ?? null, quote: c.quote };
  });
}

export async function askPaperCopilot(opts: {
  paperId: number;
  message: string;
  onDelta: (delta: string) => void;
}): Promise<EvidenceCite[]> {
  const { db } = getDb();
  const paperRows = await db
    .select()
    .from(papers)
    .where(eq(papers.id, opts.paperId));
  const paper = paperRows[0];
  if (!paper) throw new Error("Paper not found");

  await db.insert(paperMessages).values({
    paperId: opts.paperId,
    role: "user",
    content: opts.message,
  });

  // Context: whole paper when small, targeted retrieval when large.
  const fullText = await paperFullText(opts.paperId);
  let contextBlock: string;
  if (fullText.length <= FULL_TEXT_LIMIT) {
    contextBlock = fullText;
  } else {
    const hits = await retrieveContext(opts.message, 10, paper.filePath);
    contextBlock = hits
      .map(
        (h) => `[Page ${h.page ?? "?"}]\n${h.fullText}`
      )
      .join("\n\n");
  }

  const historyRows = await db
    .select()
    .from(paperMessages)
    .where(eq(paperMessages.paperId, opts.paperId))
    .orderBy(desc(paperMessages.createdAt), desc(paperMessages.id))
    .limit(HISTORY_TURNS + 1);
  const turns: ChatTurn[] = historyRows
    .slice(1)
    .reverse()
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
  turns.push({
    role: "user",
    content: `Paper: "${paper.title}"\n\n${contextBlock}\n\n---\n\nQuestion: ${opts.message}`,
  });

  // Stream while suppressing the evidence block from the visible answer.
  // A holdback window keeps a partially-arrived marker off the screen.
  const HOLDBACK = EVIDENCE_MARKER.length + 2;
  let acc = "";
  let sent = 0;
  await streamForFeature(
    "paper-copilot",
    { system: COPILOT_SYSTEM, messages: turns },
    (delta) => {
      acc += delta;
      const markerIdx = acc.indexOf(EVIDENCE_MARKER);
      const visibleEnd =
        markerIdx >= 0 ? markerIdx : Math.max(sent, acc.length - HOLDBACK);
      if (visibleEnd > sent) {
        opts.onDelta(acc.slice(sent, visibleEnd));
        sent = visibleEnd;
      }
    }
  );
  // Flush any held-back tail that turned out not to be the marker.
  const finalMarkerIdx = acc.indexOf(EVIDENCE_MARKER);
  const answerEnd = finalMarkerIdx >= 0 ? finalMarkerIdx : acc.length;
  if (answerEnd > sent) opts.onDelta(acc.slice(sent, answerEnd));

  const { answer, cites } = parseEvidence(acc);
  const evidence = await locateQuotes(opts.paperId, cites);

  await db.insert(paperMessages).values({
    paperId: opts.paperId,
    role: "assistant",
    content: answer,
    evidence,
  });

  return evidence;
}
