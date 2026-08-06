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

          /*
            The one accent. Deep teal, and deliberately not indigo, violet,
            amber or green — those four are already status hues, and an accent
            wearing a status colour reads as a status. It appears only on
            interaction: the active filter, links, the resolved share of the
            rail. Everything else stays on the neutral ramp above.
          */
          --p-accent:      #0e6b66;
          --p-accent-soft: #e6f2f1;

          /*
            The status hues again, at bar strength.

            The chips are tinted for text on white and are far too pale to read
            as a 10px bar, so the rail gets its own set — same hues, enough
            chroma to survive at that size. Keeping them here rather than in the
            component means the rail and the chips cannot drift apart.
          */
          --p-rail-new:  #8b93dd;
          --p-rail-seen: #a08fdc;
          --p-rail-prog: #e0a83f;
          --p-rail-done: #4ea36f;
          --p-rail-wont: #c7c7c2;

          background: var(--p-page);
          color: var(--p-ink);
          font-family: var(--font-portal-body), system-ui, sans-serif;
          min-height: 100vh;
          -webkit-font-smoothing: antialiased;
        }
        .portal-root ::selection { background: #e4e7ff; }
        .portal-display { font-family: var(--font-portal-display), system-ui, sans-serif; }
        .portal-mono    { font-family: var(--font-portal-mono), ui-monospace, monospace; }

        /*
          The report panel, and the two shapes it takes.

          From 1280px up it is a real column: an in-flow flex item that the list
          has to make room for, so no row ever ends up hidden underneath it and
          the list stays scrollable and clickable while a report is open. Below
          that there is no room for two columns, so the same element goes back to
          being fixed — out of flow, floating over a list that is dimmed and
          locked, which is the only thing that works on a phone.

          Declared here rather than as classes on the panel because the loading
          skeleton has to paint the identical frame before the panel arrives.
          Two copies of the same geometry drift, and the drift shows up as the
          skeleton jumping when the real content replaces it.
        */
        .portal-dock      { display: flex; align-items: flex-start; min-height: 100vh; }
        .portal-dock-main { flex: 1; min-width: 0; }

        .portal-panel {
          position: fixed;
          inset-block: 0;
          right: 0;
          z-index: 50;
          display: flex;
          flex-direction: column;
          width: 600px;
          max-width: 94vw;
          background: var(--p-card);
          border-left: 1px solid var(--p-line);
          box-shadow: -24px 0 60px rgba(20,22,25,0.10);
          outline: none;
        }

        .portal-panel-scrim {
          position: fixed;
          inset: 0;
          z-index: 40;
          background: rgba(20,22,25,0.28);
        }

        @media (min-width: 1280px) {
          .portal-panel {
            position: sticky;
            top: 0;
            z-index: 30;
            /* The floor keeps the panel readable, the ceiling stops it sprawling
               across a wide monitor. At 1280px this leaves the list about 794px,
               still clear of the breakpoint the table needs for its desktop
               grid — the dock must not cost the list its columns. */
            width: clamp(26rem, 38vw, 37.5rem);
            max-width: none;
            flex-shrink: 0;
            height: 100vh;
          }

          /* Nothing to dim: the list beside it is meant to be used. */
          .portal-panel-scrim { display: none; }
        }

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
