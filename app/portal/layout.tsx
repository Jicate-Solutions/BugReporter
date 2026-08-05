import type { ReactNode } from 'react';
import { Manrope, Public_Sans, IBM_Plex_Mono } from 'next/font/google';

/**
 * The portal has its own typographic identity, separate from the dashboard.
 *
 * The dashboard is Geist throughout. The portal is read by the customer's users
 * — people who never see the dashboard — so it is free to look like its own
 * thing, and giving it a distinct voice stops it reading as an admin screen that
 * leaked out to the public.
 *
 * Three faces, three jobs. Manrope carries headings and every number, because
 * its tight counters make tabular figures read as data rather than prose. Public
 * Sans does body text. IBM Plex Mono is reserved for identifiers — report codes,
 * viewports, user agents — the things people copy, quote back, and compare
 * character by character.
 */
const display = Manrope({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-portal-display',
});

const body = Public_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-portal-body',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-portal-mono',
});

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${display.variable} ${body.variable} ${mono.variable} portal-root`}
    >
      {/*
        Light-only, and deliberately so. The palette is a single warm neutral
        ramp where the only saturated colour in the entire interface is the
        status chip — that is what makes status readable at a glance from across
        a list. A dark variant would need a second set of chip tints tuned to
        hold the same meaning, and nobody is choosing a theme on a page they
        visit to check whether their bug got fixed.
      */}
      <style>{`
        .portal-root {
          --p-page:    #fbfbfa;
          --p-card:    #ffffff;
          --p-sunken:  #fcfcfb;
          --p-hover:   #fafaf9;

          --p-line:      #ececea;
          --p-line-ctrl: #e2e2df;
          --p-line-soft: #f0f0ee;
          --p-line-row:  #f4f4f2;

          --p-ink:    #1a1c1f;
          --p-body:   #3a3d43;
          --p-second: #5a5f68;
          --p-muted:  #8b8f96;
          --p-faint:  #9a9ea5;

          background: var(--p-page);
          color: var(--p-ink);
          font-family: var(--font-portal-body), system-ui, sans-serif;
          min-height: 100vh;
          -webkit-font-smoothing: antialiased;
        }
        .portal-root ::selection { background: #e4e7ff; }
        .portal-display { font-family: var(--font-portal-display), system-ui, sans-serif; }
        .portal-mono    { font-family: var(--font-portal-mono), ui-monospace, monospace; }

        @keyframes portalSlideIn {
          from { transform: translateX(24px); opacity: 0 }
          to   { transform: none; opacity: 1 }
        }
        @keyframes portalFadeIn { from { opacity: 0 } to { opacity: 1 } }

        .portal-slide-in { animation: portalSlideIn 180ms cubic-bezier(0.2,0.8,0.2,1); }
        .portal-fade-in  { animation: portalFadeIn 140ms ease-out; }

        /* The drawer arrives from the edge, which is motion that carries
           meaning — it says the detail came from the row you clicked and the
           list is still behind it. For anyone who has asked the system to stop
           moving, the same information arrives without the travel. */
        @media (prefers-reduced-motion: reduce) {
          .portal-slide-in, .portal-fade-in { animation: none; }
        }
      `}</style>
      {children}
    </div>
  );
}
