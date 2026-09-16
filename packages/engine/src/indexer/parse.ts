import { readFile } from "node:fs/promises";
import path from "node:path";

export const SUPPORTED_EXTENSIONS = [
  ".pdf",
  ".md",
  ".markdown",
  ".org",
  ".txt",
  ".docx",
] as const;

export function isSupportedFile(filePath: string): boolean {
  return SUPPORTED_EXTENSIONS.includes(
    path.extname(filePath).toLowerCase() as (typeof SUPPORTED_EXTENSIONS)[number]
  );
}

export function fileTypeOf(filePath: string): string {
  return path.extname(filePath).toLowerCase().replace(/^\./, "");
}

export interface ParsedSegment {
  page: number | null; // 1-based page for PDFs, null for flowing text
  text: string;
}

export async function parseFile(filePath: string): Promise<ParsedSegment[]> {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".pdf":
      return parsePdf(filePath);
    case ".docx":
      return parseDocx(filePath);
    default: {
      const text = await readFile(filePath, "utf-8");
      return [{ page: null, text }];
    }
  }
}

async function parsePdf(filePath: string): Promise<ParsedSegment[]> {
  const { pages } = await readPdfDocument(filePath);
  return pages.map((p) => ({ page: p.page, text: p.text }));
}

export interface PdfDocumentContent {
  title: string | null;
  numPages: number;
  pages: { page: number; text: string }[];
}

export async function readPdfDocument(
  filePath: string
): Promise<PdfDocumentContent> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await readFile(filePath));
  const doc = await getDocument({ data, useSystemFonts: true }).promise;
  const pages: { page: number; text: string }[] = [];
  let title: string | null = null;
  try {
    const meta = await doc.getMetadata().catch(() => null);
    const info = meta?.info as { Title?: string } | undefined;
    title = info?.Title?.trim() || null;

    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) pages.push({ page: pageNum, text });
      page.cleanup();
    }
    return { title, numPages: doc.numPages, pages };
  } finally {
    await doc.destroy();
  }
}

async function parseDocx(filePath: string): Promise<ParsedSegment[]> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ path: filePath });
  return [{ page: null, text: result.value }];
}
