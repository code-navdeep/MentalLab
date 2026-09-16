import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Highlight, HighlightRect } from "@mental-lab/shared";
import { loadPaperDocument, type PdfDocument, type PdfPage } from "../../lib/pdf";
import { TextLayer } from "pdfjs-dist";

export interface JumpRequest {
  nonce: number;
  page: number;
  quote?: string;
  rects?: HighlightRect[];
}

export interface SelectionInfo {
  page: number;
  text: string;
  rects: HighlightRect[];
  /** viewport coordinates for anchoring the selection menu */
  menuX: number;
  menuY: number;
}

interface PdfViewerProps {
  paperId: number;
  highlights: Highlight[];
  jump: JumpRequest | null;
  onSelection: (info: SelectionInfo | null) => void;
}

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Flash the spans of the text layer covering `quote`, if it can be found. */
function flashQuote(textLayerDiv: HTMLDivElement, quote: string): boolean {
  const spans = [...textLayerDiv.querySelectorAll("span")];
  if (spans.length === 0) return false;

  let joined = "";
  const spanRanges: { span: HTMLSpanElement; start: number; end: number }[] = [];
  for (const span of spans) {
    const norm = normalizeForMatch(span.textContent ?? "");
    spanRanges.push({
      span: span as HTMLSpanElement,
      start: joined.length,
      end: joined.length + norm.length,
    });
    joined += norm;
  }

  let probe = normalizeForMatch(quote);
  if (probe.length > 90) probe = probe.slice(0, 90);
  if (!probe) return false;
  const at = joined.indexOf(probe);
  if (at < 0) return false;

  const matchEnd = at + probe.length;
  const hit = spanRanges.filter((r) => r.end > at && r.start < matchEnd);
  for (const { span } of hit) {
    span.classList.remove("cite-flash");
    // Restart the animation when re-flashing the same spans.
    void span.offsetWidth;
    span.classList.add("cite-flash");
  }
  hit[0]?.span.scrollIntoView({ block: "center", behavior: "smooth" });
  return hit.length > 0;
}

interface PageViewProps {
  doc: PdfDocument;
  pageNumber: number;
  width: number;
  aspectRatio: number; // height / width fallback before render
  highlights: Highlight[];
  registerEl: (page: number, el: HTMLDivElement | null) => void;
}

function PageView({
  doc,
  pageNumber,
  width,
  aspectRatio,
  highlights,
  registerEl,
}: PageViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [ratio, setRatio] = useState(aspectRatio);
  const renderedWidth = useRef(0);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setVisible(true);
        }
      },
      { rootMargin: "600px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    registerEl(pageNumber, wrapperRef.current);
    return () => registerEl(pageNumber, null);
  }, [pageNumber, registerEl]);

  useEffect(() => {
    if (!visible || width <= 0) return;
    if (Math.abs(renderedWidth.current - width) < 2) return;
    let cancelled = false;

    void (async () => {
      let page: PdfPage;
      try {
        page = await doc.getPage(pageNumber);
      } catch {
        return;
      }
      if (cancelled) return;

      const base = page.getViewport({ scale: 1 });
      const scale = width / base.width;
      const viewport = page.getViewport({ scale });
      setRatio(viewport.height / viewport.width);

      const canvas = canvasRef.current;
      const textDiv = textRef.current;
      if (!canvas || !textDiv) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      await page.render({
        canvasContext: ctx,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      }).promise;
      if (cancelled) return;

      textDiv.replaceChildren();
      textDiv.style.setProperty("--scale-factor", String(scale));
      const textLayer = new TextLayer({
        textContentSource: page.streamTextContent(),
        container: textDiv,
        viewport,
      });
      await textLayer.render();
      renderedWidth.current = width;
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, width, doc, pageNumber]);

  return (
    <div
      ref={wrapperRef}
      data-page={pageNumber}
      className="relative mx-auto mb-4 bg-white shadow-sm"
      style={{ width, height: visible ? undefined : width * ratio }}
    >
      <canvas ref={canvasRef} className="block" />
      <div ref={textRef} className="pdf-text-layer" />
      <div className="pointer-events-none absolute inset-0">
        {highlights.map((h) =>
          h.rects.map((r, i) => (
            <div
              key={`${h.id}-${i}`}
              className="pdf-highlight"
              data-color={h.color}
              style={{
                left: `${r.x * 100}%`,
                top: `${r.y * 100}%`,
                width: `${r.w * 100}%`,
                height: `${r.h * 100}%`,
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default function PdfViewer({
  paperId,
  highlights,
  jump,
  onSelection,
}: PdfViewerProps) {
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const [aspectRatio, setAspectRatio] = useState(1.4);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageEls = useRef(new Map<number, HTMLDivElement>());
  const lastJump = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    loadPaperDocument(paperId)
      .then(async (d) => {
        if (cancelled) {
          void d.destroy();
          return;
        }
        const first = await d.getPage(1);
        const vp = first.getViewport({ scale: 1 });
        if (!cancelled) {
          setAspectRatio(vp.height / vp.width);
          setDoc(d);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [paperId]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.min(el.clientWidth - 48, 900));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const registerEl = useCallback((page: number, el: HTMLDivElement | null) => {
    if (el) pageEls.current.set(page, el);
    else pageEls.current.delete(page);
  }, []);

  // Citation / highlight jumps
  useEffect(() => {
    if (!jump || jump.nonce === lastJump.current) return;
    lastJump.current = jump.nonce;
    const el = pageEls.current.get(jump.page);
    if (!el) return;
    el.scrollIntoView({ block: "start", behavior: "smooth" });

    // Give the lazy renderer a moment if the page was not rendered yet.
    const attempt = (tries: number) => {
      const textDiv = el.querySelector<HTMLDivElement>(".pdf-text-layer");
      let done = false;
      if (jump.quote && textDiv) {
        done = flashQuote(textDiv, jump.quote);
      }
      if (!done && jump.rects && jump.rects.length > 0) {
        el.querySelectorAll(".jump-rect").forEach((n) => n.remove());
        for (const r of jump.rects) {
          const flash = document.createElement("div");
          flash.className = "cite-flash jump-rect";
          flash.style.cssText = `position:absolute;pointer-events:none;left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%;`;
          el.appendChild(flash);
          setTimeout(() => flash.remove(), 2500);
        }
        done = true;
      }
      if (!done && tries > 0) {
        setTimeout(() => attempt(tries - 1), 400);
      } else if (!done) {
        el.classList.remove("cite-flash");
        void el.offsetWidth;
        el.classList.add("cite-flash");
      }
    };
    setTimeout(() => attempt(5), 300);
  }, [jump]);

  // Text selection → fractional rects + menu anchor
  const handleMouseUp = useCallback(
    (event: React.MouseEvent) => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        onSelection(null);
        return;
      }
      const text = selection.toString().trim();
      if (!text) {
        onSelection(null);
        return;
      }
      const anchorEl =
        selection.anchorNode instanceof Element
          ? selection.anchorNode
          : selection.anchorNode?.parentElement;
      const pageEl = anchorEl?.closest<HTMLDivElement>("[data-page]");
      if (!pageEl) {
        onSelection(null);
        return;
      }
      const pageNumber = Number(pageEl.dataset.page);
      const pageRect = pageEl.getBoundingClientRect();
      const rects: HighlightRect[] = [];
      for (const r of selection.getRangeAt(0).getClientRects()) {
        if (r.width < 2 || r.height < 2) continue;
        // Ignore rects outside this page (cross-page selections clip).
        if (r.bottom < pageRect.top || r.top > pageRect.bottom) continue;
        rects.push({
          x: (r.left - pageRect.left) / pageRect.width,
          y: (r.top - pageRect.top) / pageRect.height,
          w: r.width / pageRect.width,
          h: r.height / pageRect.height,
        });
      }
      if (rects.length === 0) {
        onSelection(null);
        return;
      }
      onSelection({
        page: pageNumber,
        text,
        rects,
        menuX: event.clientX,
        menuY: event.clientY,
      });
    },
    [onSelection]
  );

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-mono text-xs text-amber">{error}</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onMouseUp={handleMouseUp}
      className="h-full overflow-y-auto bg-line/30 px-6 py-6"
    >
      {doc &&
        width > 0 &&
        Array.from({ length: doc.numPages }, (_, i) => (
          <PageView
            key={i + 1}
            doc={doc}
            pageNumber={i + 1}
            width={width}
            aspectRatio={aspectRatio}
            highlights={highlights.filter((h) => h.page === i + 1)}
            registerEl={registerEl}
          />
        ))}
      {!doc && (
        <p className="pt-24 text-center font-mono text-xs text-ink-muted">
          Opening paper…
        </p>
      )}
    </div>
  );
}
