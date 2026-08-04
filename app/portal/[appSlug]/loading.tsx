import { Skeleton } from '@/components/ui/skeleton';

/**
 * Both portal routes are `force-dynamic`, and until this existed there was no
 * loading boundary anywhere in the app — so a click left the previous page fully
 * rendered for the whole server round-trip, which read as "it opened the wrong
 * one". A boundary also gives <Link> something to prefetch: in Next 16 a dynamic
 * route is only prefetched down to its nearest loading.tsx.
 */
export default function PortalListLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="mb-8 space-y-2">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-48" />
      </div>
      <Skeleton className="mb-4 h-10 w-full" />
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
    </main>
  );
}
