import { Skeleton } from '@/components/ui/skeleton';

/** See the sibling list route's loading.tsx for why this exists. */
export default function PortalBugLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="mb-8 space-y-2">
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-4 w-56" />
      </div>
      <Skeleton className="mb-6 h-4 w-40" />
      <div className="space-y-8">
        <Skeleton className="h-32 w-full rounded-lg" />
        <div className="space-y-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-20 w-full" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      </div>
    </main>
  );
}
