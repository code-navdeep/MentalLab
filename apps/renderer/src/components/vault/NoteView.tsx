import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface NoteViewProps {
  content: string;
  onOpenNote: (name: string) => void;
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

/** Convert [[Name]] / [[Name|label]] into markdown links with a wikilink: scheme. */
function wikilinksToMarkdown(content: string): string {
  return content.replace(
    /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g,
    (_match, target: string, label?: string) => {
      const name = target.trim();
      return `[${(label ?? name).trim()}](wikilink:${encodeURIComponent(name)})`;
    }
  );
}

export default function NoteView({ content, onOpenNote }: NoteViewProps) {
  const processed = wikilinksToMarkdown(stripFrontmatter(content));
  return (
    <div className="md px-6 py-4">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith("wikilink:")) {
              const name = decodeURIComponent(href.slice("wikilink:".length));
              return (
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    onOpenNote(name);
                  }}
                  className="rounded-sm bg-accent-wash px-1 !no-underline"
                >
                  {children}
                </a>
              );
            }
            return (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  if (href) {
                    void window.ipc.invoke("app:openExternal", { url: href });
                  }
                }}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}
