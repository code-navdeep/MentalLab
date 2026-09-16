import type { SearchResult } from "@mental-lab/shared";
import { getDb } from "../db/index.js";
import { embedTexts } from "./embeddings.js";

const CANDIDATES = 20;
const RRF_K = 60;

interface Candidate {
  chunkId: number;
  fileId: number;
  path: string;
  relPath: string;
  fileType: string;
  page: number | null;
  text: string;
}

function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

async function vectorCandidates(
  query: string,
  filePath?: string,
  folderIds?: number[] | null
): Promise<Candidate[]> {
  const { pg } = getDb();
  const { vectors } = await embedTexts([query]);
  const literal = toVectorLiteral(vectors[0]!);
  const { rows } = await pg.query<Candidate>(
    `SELECT c.id AS "chunkId", c.file_id AS "fileId", f.path,
            f.rel_path AS "relPath", f.file_type AS "fileType",
            c.page, c.text
     FROM chunks c JOIN files f ON f.id = c.file_id
     WHERE c.embedding IS NOT NULL
       AND ($3::text IS NULL OR f.path = $3)
       AND ($4::int[] IS NULL OR f.folder_id = ANY($4::int[]))
     ORDER BY c.embedding <=> $1
     LIMIT $2`,
    [literal, CANDIDATES, filePath ?? null, folderIds ?? null]
  );
  return rows;
}

async function keywordCandidates(
  query: string,
  filePath?: string,
  folderIds?: number[] | null
): Promise<Candidate[]> {
  const { pg } = getDb();
  const { rows } = await pg.query<Candidate>(
    `SELECT c.id AS "chunkId", c.file_id AS "fileId", f.path,
            f.rel_path AS "relPath", f.file_type AS "fileType",
            c.page, c.text
     FROM chunks c JOIN files f ON f.id = c.file_id
     WHERE c.fts @@ websearch_to_tsquery('english', $1)
       AND ($3::text IS NULL OR f.path = $3)
       AND ($4::int[] IS NULL OR f.folder_id = ANY($4::int[]))
     ORDER BY ts_rank(c.fts, websearch_to_tsquery('english', $1)) DESC
     LIMIT $2`,
    [query, CANDIDATES, filePath ?? null, folderIds ?? null]
  );
  return rows;
}

/** Hybrid search: vector + keyword lists fused with reciprocal rank. */
export async function searchLibrary(
  query: string,
  limit = 8,
  filePath?: string,
  folderIds?: number[] | null
): Promise<SearchResult[]> {
  const [byVector, byKeyword] = await Promise.all([
    vectorCandidates(query, filePath, folderIds).catch(() => [] as Candidate[]),
    keywordCandidates(query, filePath, folderIds).catch(() => [] as Candidate[]),
  ]);

  const scores = new Map<number, { candidate: Candidate; score: number }>();
  for (const [rank, c] of byVector.entries()) {
    const entry = scores.get(c.chunkId) ?? { candidate: c, score: 0 };
    entry.score += 1 / (RRF_K + rank + 1);
    scores.set(c.chunkId, entry);
  }
  for (const [rank, c] of byKeyword.entries()) {
    const entry = scores.get(c.chunkId) ?? { candidate: c, score: 0 };
    entry.score += 1 / (RRF_K + rank + 1);
    scores.set(c.chunkId, entry);
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ candidate, score }) => ({
      chunkId: candidate.chunkId,
      fileId: candidate.fileId,
      path: candidate.path,
      relPath: candidate.relPath,
      fileType: candidate.fileType,
      page: candidate.page,
      snippet:
        candidate.text.length > 300
          ? candidate.text.slice(0, 300) + "…"
          : candidate.text,
      score,
    }));
}

/** Full chunk texts for context assembly (chat prompt building). */
export async function retrieveContext(
  query: string,
  limit = 8,
  filePath?: string,
  folderIds?: number[] | null
): Promise<(SearchResult & { fullText: string })[]> {
  const results = await searchLibrary(query, limit, filePath, folderIds);
  const { pg } = getDb();
  const out: (SearchResult & { fullText: string })[] = [];
  for (const r of results) {
    const { rows } = await pg.query<{ text: string }>(
      "SELECT text FROM chunks WHERE id = $1",
      [r.chunkId]
    );
    out.push({ ...r, fullText: rows[0]?.text ?? r.snippet });
  }
  return out;
}
