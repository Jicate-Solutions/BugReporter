import { Paperclip } from 'lucide-react';
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
 * Every bug filed through the widget carries a screenshot, and until now none
 * of it was visible to the person who captured it — they could see a status and
 * a title, but not the picture they took to explain the problem. Showing it back
 * is both the most useful thing on the page and the clearest proof their report
 * arrived intact.
 *
 * Images open in a new tab at full size rather than in a lightbox: a bug
 * screenshot is usually a full-page capture that only becomes readable at 1:1,
 * and the browser's own image viewer already zooms and pans better than
 * anything worth building here.
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
      <h2 className="mb-3 text-sm font-medium">What you sent</h2>

      {screenshotUrl && (
        <a
          href={screenshotUrl}
          target="_blank"
          rel="noreferrer"
          className="hover:border-foreground/25 block overflow-hidden rounded-lg border transition-colors"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={screenshotUrl}
            alt="Screenshot captured when this bug was reported"
            className="max-h-[420px] w-full bg-white object-contain object-top"
          />
          <span className="text-muted-foreground block border-t px-3 py-2 text-xs">
            Screenshot · open full size
          </span>
        </a>
      )}

      {images.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((a) => (
            <a
              key={a.url}
              href={a.url}
              target="_blank"
              rel="noreferrer"
              className="hover:border-foreground/25 overflow-hidden rounded-lg border transition-colors"
              title={a.filename}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.url}
                alt={a.filename}
                loading="lazy"
                className="h-28 w-full bg-white object-cover object-top"
              />
              <span className="text-muted-foreground block truncate border-t px-2 py-1.5 text-xs">
                {a.filename}
              </span>
            </a>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {files.map((a) => {
            const size = formatSize(a.filesize);
            return (
              <li key={a.url}>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:bg-muted/50 flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors"
                >
                  <Paperclip className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{a.filename}</span>
                  {size && (
                    <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
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
