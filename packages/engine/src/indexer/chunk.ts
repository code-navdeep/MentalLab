import type { ParsedSegment } from "./parse.js";

const TARGET_SIZE = 1200;
const OVERLAP = 150;

export interface Chunk {
  page: number | null;
  text: string;
}

export function chunkSegments(segments: ParsedSegment[]): Chunk[] {
  const chunks: Chunk[] = [];
  for (const segment of segments) {
    for (const text of chunkText(segment.text)) {
      chunks.push({ page: segment.page, text });
    }
  }
  return chunks;
}

function chunkText(text: string): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const out: string[] = [];
  let current = "";

  const flush = () => {
    if (current.trim()) out.push(current.trim());
    // Seed the next chunk with the tail of this one for continuity.
    current = current.length > OVERLAP ? current.slice(-OVERLAP) : "";
  };

  for (const para of paragraphs) {
    if (para.length > TARGET_SIZE) {
      // Oversized paragraph: hard-split on sentence-ish boundaries.
      for (const piece of hardSplit(para)) {
        if (current.length + piece.length > TARGET_SIZE) flush();
        current += (current ? " " : "") + piece;
      }
      continue;
    }
    if (current.length + para.length > TARGET_SIZE) flush();
    current += (current ? "\n\n" : "") + para;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function hardSplit(text: string): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const pieces: string[] = [];
  let current = "";
  for (const s of sentences) {
    if (current.length + s.length > TARGET_SIZE && current) {
      pieces.push(current);
      current = "";
    }
    current += (current ? " " : "") + s;
  }
  if (current) pieces.push(current);
  return pieces;
}
