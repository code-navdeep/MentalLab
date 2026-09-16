import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDocument = pdfjs.PDFDocumentProxy;
export type PdfPage = pdfjs.PDFPageProxy;
export { pdfjs };

/** Load an imported paper's PDF through the mlpdf:// protocol. */
export async function loadPaperDocument(paperId: number): Promise<PdfDocument> {
  const response = await fetch(`mlpdf://paper/${paperId}`);
  if (!response.ok) {
    throw new Error(`Could not load the paper file (${response.status})`);
  }
  const data = await response.arrayBuffer();
  return pdfjs.getDocument({ data }).promise;
}
