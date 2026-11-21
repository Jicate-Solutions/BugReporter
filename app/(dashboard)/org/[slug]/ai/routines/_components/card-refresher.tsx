'use client';

/**
 * Re-reads the page every few seconds. The AI Routines page renders this only
 * while a key saved in the last 20 minutes still waits for its check result
 * (cardIsSettling), so the result appears on the account's row without a
 * reload and the refreshing stops by itself. What is typed in a form is kept.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function CardRefresher({ everyMs = 10_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) router.refresh();
    }, everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs]);
  return null;
}
