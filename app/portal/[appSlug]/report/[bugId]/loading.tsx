/**
 * The standalone report page while it loads.
 *
 * Only reached on a cold navigation — a pasted link or a refresh. Clicking a row
 * from the list goes through the drawer's own loading boundary instead.
 */
export default function PortalBugLoading() {
  return (
    <>
      <div className="sticky top-0 z-20 border-b border-[var(--p-line)] bg-[rgba(251,251,250,0.88)] backdrop-blur-[12px]">
        <div className="mx-auto flex max-w-3xl items-center gap-5 px-5 py-[18px] sm:px-8">
          <div className="flex flex-col gap-1.5">
            <Bar className="h-5 w-40" />
            <Bar className="h-3 w-56" />
          </div>
        </div>
      </div>

      <div
        aria-busy="true"
        aria-label="Loading report"
        className="mx-auto max-w-3xl px-5 pb-20 pt-7 sm:px-8"
      >
        <Bar className="mb-6 h-3.5 w-32" />

        <div className="rounded-[14px] border border-[var(--p-line)] bg-[var(--p-card)] p-6">
          <div className="mb-5 border-b border-[var(--p-line-soft)] pb-5">
            <div className="flex items-center gap-2.5">
              <Bar className="h-3.5 w-16" />
              <Bar className="h-5 w-20 rounded-md" />
            </div>
            <Bar className="mt-2.5 h-6 w-3/4" />
          </div>

          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-[var(--p-line-soft)] bg-[var(--p-line-soft)]">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="bg-[var(--p-card)] px-3.5 py-3">
                <Bar className="h-2.5 w-12" />
                <Bar className="mt-2 h-3.5 w-20" />
              </div>
            ))}
          </div>

          <Bar className="mt-6 h-2.5 w-24" />
          <Bar className="mt-3 h-3.5 w-full" />
          <Bar className="mt-2 h-3.5 w-5/6" />
          <Bar className="mt-6 h-[180px] w-full rounded-[10px]" />
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
