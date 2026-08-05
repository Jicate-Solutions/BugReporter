import { Paperclip } from 'lucide-react';
import { SectionLabel } from './portal-timeline';
import type { PortalAttachment } from '@/lib/services/bug-portal/server';

interface PortalEvidenceProps {
  screenshotUrl: string | null;
  attachments: PortalAttachment[];
}

function formatSize(bytes?: number): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * What the reporter actually sent.
 *
 * Every bug filed through the widget carries a screenshot, and until recently
 * none of it was visible to the person who captured it — they could see a status
 * and a title, but not the picture they took to explain the problem. Showing it
 * back is both the most useful thing here and the clearest proof their report
 * arrived intact.
 *
 * Images open in a new tab at full size rather than in a lightbox: a bug
 * screenshot is usually a full-page capture that only becomes readable at 1:1,
 * and the browser's own viewer already zooms and pans better than anything worth
 * building here.
 */
export function PortalEvidence({
  screenshotUrl,
  attachments,
}: PortalEvidenceProps) {
  if (!screenshotUrl && attachments.length === 0) return null;

  const images = attachments.filter(
    (a) => a.filetype?.startsWith('image/') ?? /\.(png|jpe?g|gif|webp)$/i.test(a.url)
  );
  const files = attachments.filter((a) => !images.includes(a));

  return (
    <section>
      <SectionLabel>What you sent</SectionLabel>

      {screenshotUrl && (
        <a
          href={screenshotUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-[9px] block overflow-hidden rounded-[10px] border border-[var(--p-line)] transition-colors hover:border-[#c9c9c5]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={screenshotUrl}
            alt="Screenshot captured when this bug was reported"
            className="max-h-[420px] w-full bg-white object-contain object-top"
          />
          <span className="block border-t border-[var(--p-line-soft)] bg-[var(--p-sunken)] px-3 py-2 text-[11.5px] text-[var(--p-muted)]">
            Screenshot · open full size
          </span>
        </a>
      )}

      {images.length > 0 && (
        <div className="mt-2.5 grid grid-cols-3 gap-2.5">
          {images.map((a) => (
            <a
              key={a.url}
              href={a.url}
              target="_blank"
              rel="noreferrer"
              title={a.filename}
              className="overflow-hidden rounded-[9px] border border-[var(--p-line)] transition-colors hover:border-[#c9c9c5]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.url}
                alt={a.filename}
                loading="lazy"
                className="aspect-[4/3] w-full bg-white object-cover object-top"
              />
              <span className="portal-mono block truncate border-t border-[var(--p-line-soft)] px-2 py-1.5 text-[10.5px] text-[var(--p-faint)]">
                {a.filename}
              </span>
            </a>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <ul className="mt-2.5 space-y-1.5">
          {files.map((a) => {
            const size = formatSize(a.filesize);
            return (
              <li key={a.url}>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-lg border border-[var(--p-line-ctrl)] px-3 py-2 text-[13px] transition-colors hover:bg-[var(--p-hover)]"
                >
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-[var(--p-faint)]" />
                  <span className="truncate">{a.filename}</span>
                  {size && (
                    <span className="portal-mono ml-auto shrink-0 text-[11.5px] tabular-nums text-[var(--p-faint)]">
                      {size}
                    </span>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
