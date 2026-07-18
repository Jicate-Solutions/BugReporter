'use client';

/**
 * Per-app control-surface tab bar. One app, five lenses: Overview · Bugs · AI ·
 * Routines · Uptime. Route-based (each tab is a real nested page), so URLs are
 * shareable and the back button works. Horizontally scrollable so the row never
 * overflows a narrow screen.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { LayoutDashboard, Bug, Sparkles, CalendarClock, Activity, type LucideIcon } from 'lucide-react';

export function AppTabNav({ slug, appSlug }: { slug: string; appSlug: string }) {
  const pathname = usePathname();
  const base = `/org/${slug}/apps/${appSlug}`;

  const tabs: { label: string; href: string; icon: LucideIcon }[] = [
    { label: 'Overview', href: base, icon: LayoutDashboard },
    { label: 'Bugs', href: `${base}/bugs`, icon: Bug },
    { label: 'AI', href: `${base}/ai`, icon: Sparkles },
    { label: 'Routines', href: `${base}/routines`, icon: CalendarClock },
    { label: 'Uptime', href: `${base}/uptime`, icon: Activity }
  ];

  return (
    <div className="overflow-x-auto border-b">
      <nav className="flex min-w-max gap-1" aria-label="Application sections">
        {tabs.map((t) => {
          // Overview is the base path → exact match; the rest own their subtree.
          const active = t.href === base ? pathname === base : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground'
              )}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
