/**
 * The list's shape while it loads.
 *
 * Both portal routes are `force-dynamic`, and until a boundary existed here a
 * click left the previous page fully rendered for the whole server round-trip,
 * which read as "it opened the wrong one". A boundary also gives <Link>
 * something to prefetch: in Next 16 a dynamic route is only prefetched down to
 * its nearest loading.tsx.
 *
 * Mirrors the real layout — four tiles, a filter row, a table with a header — so
 * the page settles into place rather than jumping when the data lands.
 */
export default function PortalListLoading() {
  return (
    <>
      <div className="sticky top-0 z-20 border-b border-[var(--p-line)] bg-[rgba(251,251,250,0.88)] backdrop-blur-[12px]">
        <div className="mx-auto flex max-w-[1240px] items-center gap-5 px-5 py-[18px] sm:px-8">
          <div className="mr-auto flex flex-col gap-1.5">
            <Bar className="h-5 w-40" />
            <Bar className="h-3 w-56" />
          </div>
          <Bar className="h-9 w-24 rounded-[9px]" />
        </div>
      </div>

      <div
        aria-busy="true"
        aria-label="Loading your reports"
        className="mx-auto max-w-[1240px] px-5 pb-20 pt-7 sm:px-8"
      >
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-xl border border-[var(--p-line)] bg-[var(--p-card)] px-[18px] py-4"
            >
              <Bar className="h-3 w-12" />
              <Bar className="mt-2.5 h-7 w-10" />
              <Bar className="mt-2.5 h-3 w-24" />
            </div>
          ))}
        </div>

        <div className="mb-3.5 flex gap-2.5">
          <Bar className="h-10 flex-1 rounded-[10px]" />
          <Bar className="hidden h-10 w-32 rounded-[10px] sm:block" />
          <Bar className="hidden h-10 w-40 rounded-[10px] sm:block" />
        </div>

        <div className="mb-[18px] flex gap-[7px]">
          {[0, 1, 2, 3].map((i) => (
            <Bar key={i} className="h-8 w-24 rounded-full" />
          ))}
        </div>

        <div className="overflow-hidden rounded-[14px] border border-[var(--p-line)] bg-[var(--p-card)]">
          <div className="border-b border-[var(--p-line-soft)] bg-[var(--p-sunken)] px-5 py-[11px]">
            <Bar className="h-3 w-full max-w-[420px]" />
          </div>
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="border-b border-[var(--p-line-row)] px-5 py-4 last:border-b-0"
            >
              <Bar className="h-4 w-1/2" />
              <Bar className="mt-2 h-3 w-1/3" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Bar({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded bg-[var(--p-line-row)] ${className}`} />
  );
}
