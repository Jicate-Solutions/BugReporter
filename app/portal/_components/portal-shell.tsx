import type { ReactNode } from 'react';

/**
 * Chrome for every portal page.
 *
 * The header is sticky and translucent so the application name and the reporter's
 * own address stay visible while they scroll a long list — on a page whose whole
 * job is "these are *your* reports", losing the attribution to a scroll would be
 * the wrong thing to lose.
 */
export function PortalShell({
  title,
  subtitle,
  action,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const width = wide ? 'max-w-[1240px]' : 'max-w-3xl';

  return (
    <>
      <div className="sticky top-0 z-20 border-b border-[var(--p-line)] bg-[rgba(251,251,250,0.88)] backdrop-blur-[12px]">
        <div
          className={`mx-auto flex items-center gap-5 px-5 py-[18px] sm:px-8 ${width}`}
        >
          <div className="mr-auto flex min-w-0 flex-col gap-0.5">
            <h1 className="portal-display truncate text-[19px] font-extrabold tracking-[-0.02em]">
              {title}
            </h1>
            {subtitle && (
              <p className="truncate text-[12.5px] text-[var(--p-muted)]">
                {subtitle}
              </p>
            )}
          </div>
          {action}
        </div>
      </div>

      <main className={`mx-auto px-5 pb-20 pt-7 sm:px-8 ${width}`}>
        {children}
      </main>
    </>
  );
}

export function PortalNotice({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--p-line-ctrl)] bg-[var(--p-card)] p-12 text-center">
      <p className="portal-display text-[15px] font-bold">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-[1.6] text-[var(--p-muted)]">
        {body}
      </p>
    </div>
  );
}
