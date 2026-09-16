interface EmptyStateProps {
  eyebrow: string;
  title: string;
  description: string;
  arrival: string;
}

export default function EmptyState({
  eyebrow,
  title,
  description,
  arrival,
}: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="titlebar-drag h-12 shrink-0" />
      <div className="flex flex-1 items-center justify-center">
        <div className="max-w-md px-8 pb-16">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent-ink">
            {eyebrow}
          </p>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
            {title}
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-muted">
            {description}
          </p>
          <p className="mt-8 border-t border-line pt-4 font-mono text-xs text-ink-muted">
            {arrival}
          </p>
        </div>
      </div>
    </div>
  );
}
