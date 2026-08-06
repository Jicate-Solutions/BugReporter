/**
 * The drawer's frame, immediately.
 *
 * Both portal routes are force-dynamic, so opening a report is a server round
 * trip. Without this boundary the click does nothing visible until that trip
 * finishes and the list just sits there, which reads as a dead row rather than
 * a slow one. Painting the panel first means the motion starts on the click and
 * only the contents arrive late.
 */
export default function DrawerLoading() {
  return (
    <>
      <div className="portal-panel-scrim portal-fade-in" />
      <div
        aria-busy="true"
        aria-label="Loading report"
        className="portal-panel portal-slide-in"
      >
        <div className="border-b border-[var(--p-line-soft)] px-[26px] pb-[18px] pt-[22px]">
          <div className="flex items-center gap-2.5">
            <Bar className="h-3.5 w-16" />
            <Bar className="h-5 w-20 rounded-md" />
          </div>
          <Bar className="mt-2.5 h-6 w-3/4" />
        </div>

        <div className="flex-1 px-[26px] pt-[22px]">
          {/* Five cells, matching the real grid: a full-width "Reported by"
              row over the 2×2. A skeleton one cell short shifts everything
              below it the moment the content lands. */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-[var(--p-line-soft)] bg-[var(--p-line-soft)]">
            <div className="col-span-2 bg-[var(--p-card)] px-3.5 py-3">
              <Bar className="h-2.5 w-20" />
              <Bar className="mt-2 h-3.5 w-56 max-w-full" />
            </div>
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
