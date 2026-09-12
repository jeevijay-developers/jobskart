import { ChevronLeft, ChevronRight } from "lucide-react";

// Shared page-number pagination, used by /jobs and the candidate dashboard's
// "Recommended for you" widget so pagination behavior/styling stays consistent.
export function Pagination({
  page,
  totalPages,
  onChange,
  ariaLabel = "Pagination",
  className = "mt-8",
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
  ariaLabel?: string;
  className?: string;
}) {
  const windowSize = 5;
  const start = Math.max(1, Math.min(page - 2, totalPages - windowSize + 1));
  const end = Math.min(totalPages, start + windowSize - 1);
  const pages: number[] = [];
  for (let p = start; p <= end; p++) pages.push(p);

  return (
    <nav className={`flex flex-wrap items-center justify-center gap-1 ${className}`} aria-label={ariaLabel}>
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className="inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-surface disabled:opacity-50"
      >
        <ChevronLeft className="h-4 w-4" /> Prev
      </button>
      {start > 1 && (
        <>
          <PageBtn n={1} active={page === 1} onClick={onChange} />
          {start > 2 && <span className="px-2 text-muted-foreground">…</span>}
        </>
      )}
      {pages.map((p) => (
        <PageBtn key={p} n={p} active={p === page} onClick={onChange} />
      ))}
      {end < totalPages && (
        <>
          {end < totalPages - 1 && <span className="px-2 text-muted-foreground">…</span>}
          <PageBtn n={totalPages} active={page === totalPages} onClick={onChange} />
        </>
      )}
      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        className="inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-surface disabled:opacity-50"
      >
        Next <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  );
}

function PageBtn({ n, active, onClick }: { n: number; active: boolean; onClick: (p: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onClick(n)}
      aria-current={active ? "page" : undefined}
      className={`inline-flex h-9 min-w-9 items-center justify-center rounded-lg border px-3 text-sm font-medium ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground hover:bg-surface"
      }`}
    >
      {n}
    </button>
  );
}
