import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { NoteType, VaultNoteInfo, VaultStrictness } from "@mental-lab/shared";
import { generateForFeature } from "../models/index.js";
import {
  getFilesToProcess,
  loadGraphState,
  markProcessed,
  saveGraphState,
} from "./graph-state.js";

const BATCH_SIZE = 8;
const SOURCE_CHARS_PER_FILE = 4000;
const NOTE_CONTEXT_CHARS = 4000;
const MAX_CONTEXT_NOTES = 10;

// How aggressively the builder creates new notes versus enriching existing ones.
const STRICTNESS_RULES: Record<VaultStrictness, string> = {
  high: `STRICTNESS: HIGH — "Meetings create notes. Emails enrich them."
- Calendar events and meetings may create new notes.
- Emails may only UPDATE existing notes for people/projects already known.
- Exception: a warm introduction from a known contact may create a person note.
- Skip entirely: newsletters, automated mail, consumer services, cold pitches, recruiters.`,
  medium: `STRICTNESS: MEDIUM — "Both create notes, but emails must be personalized."
- Calendar events and meetings may create new notes.
- Personalized, business-relevant emails may create notes.
- Warm introductions may create person notes.
- Skip entirely: newsletters, automated mail, consumer services (banks, shops, streaming), generic cold pitches, recruiters, support reps.`,
  low: `STRICTNESS: LOW — "Capture broadly. Never miss a potentially important contact."
- Create a note for any identifiable human sender or meeting participant.
- Skip only obvious automated mail and mass newsletters.`,
};

export async function listVaultNotes(
  vaultFolder: string
): Promise<VaultNoteInfo[]> {
  let entries;
  try {
    entries = await readdir(vaultFolder, { withFileTypes: true });
  } catch {
    return [];
  }
  const notes: VaultNoteInfo[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
    const filePath = path.join(vaultFolder, entry.name);
    let mtime = new Date(0);
    let type: NoteType = "other";
    try {
      const s = await stat(filePath);
      mtime = s.mtime;
      const head = (await readFile(filePath, "utf-8")).slice(0, 500);
      const typeMatch = head.match(
        /^type:\s*(person|org|project|topic|paper)\s*$/m
      );
      if (typeMatch) type = typeMatch[1] as NoteType;
    } catch {
      continue;
    }
    notes.push({
      name: entry.name.replace(/\.md$/, ""),
      type,
      updatedAt: mtime.toISOString(),
    });
  }
  notes.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return notes;
}

interface NoteOp {
  action: "create" | "update";
  file: string;
  content: string;
}

function buildPrompt(
  strictness: VaultStrictness,
  sources: { name: string; text: string }[],
  existingNotes: string[],
  noteContext: { name: string; content: string }[]
): string {
  const sourcesBlock = sources
    .map((s) => `### SOURCE: ${s.name}\n${s.text}`)
    .join("\n\n");
  const contextBlock =
    noteContext.length > 0
      ? noteContext
          .map((n) => `### EXISTING NOTE: ${n.name}.md\n${n.content}`)
          .join("\n\n")
      : "(none of the existing notes appear related)";

  return `You maintain a personal knowledge vault of markdown notes about people, organizations, projects and topics, built from the user's emails and calendar events.

${STRICTNESS_RULES[strictness]}

Existing note files: ${existingNotes.length > 0 ? existingNotes.map((n) => `${n}.md`).join(", ") : "(vault is empty)"}

Related note contents:
${contextBlock}

New source material:
${sourcesBlock}

Decide which notes to create or update. Rules for notes:
- One entity per note: a person, organization, project, or topic.
- Filename is the entity name in Title Case, e.g. "Jane Cooper.md", "Acme Corp.md".
- Start with YAML frontmatter (Obsidian conventions):
  ---
  type: person|org|project|topic
  tags: [<type>, <one or two specific topical tags>]
  aliases: [<short names, nicknames, or abbreviations, if any>]
  ---
- Then a # heading with the entity name, then concise dated bullet points of facts.
- Link related entities inline with [[wikilinks]], e.g. "works at [[Acme Corp]]".
- When updating, output the COMPLETE new note content (existing content, merged and deduplicated, plus the new facts). Never drop existing facts.
- Only extract what the sources actually say. No speculation.

Respond with exactly this JSON and nothing else:
{"operations": [{"action": "create"|"update", "file": "<Name>.md", "content": "<full note content>"}]}

If nothing merits a note under the strictness rules, respond {"operations": []}.`;
}

const MAX_FAILED_ATTEMPTS = 3;

export interface BuildResult {
  notesWritten: number;
  failedBatches: number;
  skippedSources: number;
  lastError: string | null;
}

/** Run the note builder over changed sources. */
export async function buildGraph(
  vaultFolder: string,
  strictness: VaultStrictness,
  onProgress: (detail: string) => void
): Promise<BuildResult> {
  const state = await loadGraphState(vaultFolder);
  const candidates = await getFilesToProcess(vaultFolder, state);
  const toProcess = candidates.filter(
    (f) => (state.failedAttempts[f] ?? 0) < MAX_FAILED_ATTEMPTS
  );
  const skippedSources = candidates.length - toProcess.length;
  if (skippedSources > 0) {
    onProgress(`Skipped ${skippedSources} sources after repeated failures`);
  }
  if (toProcess.length === 0) {
    await saveGraphState(vaultFolder, state);
    return { notesWritten: 0, failedBatches: 0, skippedSources, lastError: null };
  }

  let notesWritten = 0;
  let failedBatches = 0;
  let lastError: string | null = null;
  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const batch = toProcess.slice(i, i + BATCH_SIZE);
    onProgress(
      `Reading sources ${i + 1}–${Math.min(i + BATCH_SIZE, toProcess.length)} of ${toProcess.length}`
    );

    const sources: { name: string; text: string }[] = [];
    for (const file of batch) {
      try {
        const text = await readFile(file, "utf-8");
        sources.push({
          name: path.basename(file),
          text: text.slice(0, SOURCE_CHARS_PER_FILE),
        });
      } catch {
        // skip unreadable source
      }
    }
    if (sources.length === 0) {
      for (const file of batch) await markProcessed(state, file);
      continue;
    }

    const existing = await listVaultNotes(vaultFolder);
    const existingNames = existing.map((n) => n.name);

    // Pull in contents of notes whose names appear in this batch's text.
    const batchText = sources.map((s) => s.text).join("\n").toLowerCase();
    const related = existingNames
      .filter((name) => batchText.includes(name.toLowerCase()))
      .slice(0, MAX_CONTEXT_NOTES);
    const noteContext: { name: string; content: string }[] = [];
    for (const name of related) {
      try {
        const content = await readFile(
          path.join(vaultFolder, `${name}.md`),
          "utf-8"
        );
        noteContext.push({ name, content: content.slice(0, NOTE_CONTEXT_CHARS) });
      } catch {
        // skip
      }
    }

    let raw: string | null = null;
    try {
      raw = await generateForFeature(
        "vault-notes",
        buildPrompt(strictness, sources, existingNames, noteContext)
      );
      // Models often wrap JSON in markdown fences despite instructions.
      const unfenced = raw.replace(/```(?:json)?\s*([\s\S]*?)\s*```/g, "$1");
      const jsonMatch = unfenced.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : unfenced) as {
        operations?: NoteOp[];
      };
      for (const op of parsed.operations ?? []) {
        // Validate: bare filename, .md, no traversal.
        if (
          !op.file ||
          !op.file.endsWith(".md") ||
          op.file.includes("/") ||
          op.file.includes("\\") ||
          op.file.startsWith(".") ||
          op.file.startsWith("_") ||
          !op.content
        ) {
          continue;
        }
        await writeFile(path.join(vaultFolder, op.file), op.content, "utf-8");
        notesWritten++;
      }
    } catch (err) {
      // A failed batch is retried on later syncs (not marked processed),
      // up to MAX_FAILED_ATTEMPTS per source file.
      failedBatches++;
      const message = err instanceof Error ? err.message : String(err);
      lastError =
        err instanceof SyntaxError && raw !== null
          ? `model returned non-JSON: "${raw.slice(0, 200)}"`
          : message;
      onProgress(
        `Batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${lastError}`
      );
      for (const file of batch) {
        state.failedAttempts[file] = (state.failedAttempts[file] ?? 0) + 1;
      }
      await saveGraphState(vaultFolder, state);
      continue;
    }

    for (const file of batch) await markProcessed(state, file);
    state.lastBuildTime = new Date().toISOString();
    await saveGraphState(vaultFolder, state);
  }

  await saveGraphState(vaultFolder, state);
  return { notesWritten, failedBatches, skippedSources, lastError };
}
