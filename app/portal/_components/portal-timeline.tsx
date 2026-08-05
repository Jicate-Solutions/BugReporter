import { formatDistanceToNow } from 'date-fns';
import { bugStatusLabel } from '@boobalan_jkkn/shared';
import type {
  PortalMessage,
  PortalStatusEvent,
} from '@/lib/services/bug-portal/server';

interface PortalTimelineProps {
  events: PortalStatusEvent[];
  messages: PortalMessage[];
  reporterEmail: string;
  createdAt: string;
}

interface Entry {
  key: string;
  at: string;
  who: string;
  initials: string;
  body: React.ReactNode;
  mine: boolean;
}

/**
 * One timeline, not two lists.
 *
 * Status changes and notes were previously rendered as separate sections —
 * "History" and "Notes" — which meant a reporter had to read both and
 * interleave them mentally to work out what actually happened, in what order.
 * They are the same story. A note explaining a fix is only meaningful next to
 * the status change it explains.
 *
 * Merged strictly by time. Where a status change carried a note, the note was
 * already written to the thread as a message by applyStatusChange, so the entry
 * here shows the transition and lets the message carry the words — printing both
 * would say everything twice.
 */
export function PortalTimeline({
  events,
  messages,
  reporterEmail,
  createdAt,
}: PortalTimelineProps) {
  const entries: Entry[] = [
    {
      key: 'reported',
      at: createdAt,
      who: 'You',
      initials: initialsFor(reporterEmail),
      mine: true,
      body: <span className="text-[var(--p-second)]">Reported this.</span>,
    },
  ];

  for (const event of events) {
    entries.push({
      key: `event-${event.id}`,
      at: event.created_at,
      who: 'The team',
      initials: '··',
      mine: false,
      body: (
        <span>
          {event.from_status ? (
            <>
              Moved from{' '}
              <span className="font-medium">
                {bugStatusLabel(event.from_status)}
              </span>{' '}
              to{' '}
              <span className="font-medium">
                {bugStatusLabel(event.to_status)}
              </span>
              .
            </>
          ) : (
            <>
              Set to{' '}
              <span className="font-medium">
                {bugStatusLabel(event.to_status)}
              </span>
              .
            </>
          )}
        </span>
      ),
    });
  }

  for (const message of messages) {
    const mine = message.author_kind === 'reporter';
    entries.push({
      key: `message-${message.id}`,
      at: message.created_at,
      who: mine ? 'You' : 'The team',
      initials: mine ? initialsFor(reporterEmail) : '··',
      mine,
      body: (
        <span className="whitespace-pre-wrap">{message.message_text}</span>
      ),
    });
  }

  entries.sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
  );

  return (
    <div>
      <SectionLabel>Activity</SectionLabel>
      <ol className="mt-[14px]">
        {entries.map((entry, index) => (
          <li
            key={entry.key}
            className="grid grid-cols-[26px_1fr] gap-3 pb-[18px] last:pb-0"
          >
            <div className="flex flex-col items-center gap-[5px]">
              <div
                className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ${
                  entry.mine
                    ? 'border-[#dfe2f5] bg-[#eef2ff] text-[#3b46a8]'
                    : 'border-[var(--p-line)] bg-[#f2f2f0] text-[var(--p-second)]'
                }`}
              >
                {entry.initials}
              </div>
              {/* The connector stops at the last entry rather than trailing off
                  into nothing. */}
              {index < entries.length - 1 && (
                <div className="w-px flex-1 bg-[var(--p-line-soft)]" />
              )}
            </div>

            <div className="flex flex-col gap-[5px] pt-[3px]">
              <div className="flex items-baseline gap-2">
                <span className="text-[13.5px] font-semibold">{entry.who}</span>
                <span className="text-[12px] text-[var(--p-faint)]">
                  {formatDistanceToNow(new Date(entry.at), { addSuffix: true })}
                </span>
              </div>
              <div className="text-[13.5px] leading-[1.55] text-[var(--p-body)]">
                {entry.body}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--p-faint)]">
      {children}
    </div>
  );
}

/** Initials from an email local part: "sroja@jkkn.ac.in" -> "SR". */
function initialsFor(email: string): string {
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase() || '?';
}
