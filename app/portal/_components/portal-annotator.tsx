'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  ArrowUpRight,
  EyeOff,
  Loader2,
  Pencil,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  ANNOTATION_COLORS,
  ANNOTATION_TOOL_HINTS,
  ANNOTATION_TOOL_LABELS,
  createAnnotator,
  type AnnotationTool,
  type Annotator,
  type Point,
} from '@boobalan_jkkn/shared';

const TOOL_ICONS: Record<AnnotationTool, typeof Pencil> = {
  pencil: Pencil,
  rect: Square,
  arrow: ArrowUpRight,
  text: Type,
  redact: EyeOff,
};

/** Authored against a 1000px-wide image; the engine scales them to the real one. */
const STROKE_WIDTHS = [2, 4, 8];

interface PortalAnnotatorProps {
  appSlug: string;
  bugId: string;
  screenshotUrl: string;
  reporterEmail: string;
  signature?: string;
  tools: AnnotationTool[];
  onClose: () => void;
}

/**
 * Where the overlay is parented.
 *
 * The same reasoning as PortalStatusControl's popover: the portal's entire
 * palette and all three of its typefaces are declared on `.portal-root`, so an
 * overlay hung off the body renders as transparent boxes in the wrong font.
 */
function overlayHost(): HTMLElement {
  return document.querySelector<HTMLElement>('.portal-root') ?? document.body;
}

/**
 * Mark up the screenshot, then send it.
 *
 * The engine underneath is framework-free and lives in the shared package,
 * because the capture widget — a separate, published package — needs the same
 * drawing surface at capture time. This component is only the chrome around it:
 * the toolbar, the text input a canvas cannot provide, and the request.
 *
 * Hand-rolled rather than assembled from `components/ui`, deliberately. Every
 * other file under app/portal is: the portal runs its own palette, its own three
 * typefaces, and light-only, and a shadcn dialog dropped in here would arrive
 * with none of them.
 */
export function PortalAnnotator({
  appSlug,
  bugId,
  screenshotUrl,
  reporterEmail,
  signature,
  tools,
  onClose,
}: PortalAnnotatorProps) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const annotatorRef = useRef<Annotator | null>(null);
  const textInputRef = useRef<HTMLInputElement>(null);

  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [tool, setTool] = useState<AnnotationTool>(tools[0] ?? 'pencil');
  const [color, setColor] = useState(ANNOTATION_COLORS[0]);
  const [width, setWidth] = useState(4);
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [pendingText, setPendingText] = useState<{
    at: Point;
    screen: Point;
    size: number;
  } | null>(null);

  // ---------------------------------------------------------------- lifecycle

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const image = new Image();
    // Required, and the whole feature rests on it: without it the canvas is
    // tainted the moment the screenshot is drawn and toDataURL throws. Supabase
    // Storage serves public objects with a permissive CORS header, which is what
    // makes this work against the bucket the screenshot already lives in.
    image.crossOrigin = 'anonymous';

    let annotator: Annotator | null = null;

    image.onload = () => {
      try {
        annotator = createAnnotator({
          canvas,
          image,
          color,
          strokeWidth: width,
          onChange: (state) => setDirty(state.dirty),
          onRequestText: (at, screen) =>
            setPendingText({
              at,
              screen,
              size: annotator?.textInputSize() ?? 16,
            }),
        });
        annotatorRef.current = annotator;
        annotator.setTool(tools[0] ?? 'pencil');
        setReady(true);
      } catch {
        setFailed('This screenshot could not be opened for marking up.');
      }
    };

    image.onerror = () =>
      setFailed('This screenshot could not be loaded. Try opening it full size.');

    image.src = screenshotUrl;

    return () => {
      annotator?.destroy();
      annotatorRef.current = null;
    };
    // Colour and width are pushed through setters below; re-creating the
    // annotator when either changes would throw away everything drawn so far.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenshotUrl]);

  useEffect(() => {
    if (pendingText) textInputRef.current?.focus();
  }, [pendingText]);

  const close = useCallback(() => {
    setConfirmDiscard(false);
    onClose();
  }, [onClose]);

  // Escape, in the CAPTURE phase on purpose.
  //
  // PortalDrawer listens for Escape on document and calls router.back(), which
  // would tear down the whole drawer and every mark in it. Both listeners sit on
  // the same node, so stopPropagation from a bubble handler would never reach
  // it — capturing on document runs strictly earlier.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (sending) return;
      if (pendingText) {
        setPendingText(null);
      } else if (dirty && !confirmDiscard) {
        setConfirmDiscard(true);
      } else {
        close();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [sending, pendingText, dirty, confirmDiscard, close]);

  // The page behind must not scroll while a full-screen canvas is open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // ------------------------------------------------------------------ actions

  const pick = (next: AnnotationTool) => {
    setTool(next);
    annotatorRef.current?.setTool(next);
    setPendingText(null);
  };

  const pickColor = (next: string) => {
    setColor(next);
    annotatorRef.current?.setColor(next);
  };

  const pickWidth = (next: number) => {
    setWidth(next);
    annotatorRef.current?.setStrokeWidth(next);
  };

  const commitText = (value: string) => {
    if (pendingText) annotatorRef.current?.addText(pendingText.at, value);
    setPendingText(null);
  };

  const send = async () => {
    const annotator = annotatorRef.current;
    if (!annotator || sending) return;

    if (!annotator.isDirty()) {
      toast.error('Mark something on the screenshot first.');
      return;
    }

    setSending(true);
    try {
      const response = await fetch(
        `/api/portal/${appSlug}/${bugId}/annotation`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_data_url: annotator.exportDataUrl(),
            note: note.trim() || undefined,
            reporter_email: reporterEmail,
            signature,
          }),
        }
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'That did not go through.');
      }

      toast.success('Sent to the team');
      close();
      router.refresh();
    } catch (error) {
      // The message comes from the API, which knows what actually failed.
      toast.error(
        error instanceof Error ? error.message : 'That did not go through.'
      );
    } finally {
      setSending(false);
    }
  };

  // ----------------------------------------------------------------- rendering

  const overlay = (
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-[rgba(20,22,25,0.62)]"
      role="dialog"
      aria-modal="true"
      aria-label="Mark up the screenshot"
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-[rgba(255,255,255,0.12)] px-4 py-3">
        <span className="portal-display text-[15px] font-bold text-white">
          Mark up the screenshot
        </span>
        <span className="hidden text-[12.5px] text-[rgba(255,255,255,0.62)] sm:inline">
          {ANNOTATION_TOOL_HINTS[tool]}
        </span>
        <button
          type="button"
          onClick={() => (dirty ? setConfirmDiscard(true) : close())}
          disabled={sending}
          aria-label="Close"
          className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {/* Toolbar above the image, not floating over it — a full-page capture is
          tall enough that a floating bar is always covering something. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[rgba(255,255,255,0.12)] px-4 py-2.5">
        <div className="flex items-center gap-1">
          {tools.map((option) => {
            const Icon = TOOL_ICONS[option];
            const active = option === tool;
            return (
              <button
                key={option}
                type="button"
                onClick={() => pick(option)}
                title={ANNOTATION_TOOL_HINTS[option]}
                aria-pressed={active}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium transition-colors ${
                  active
                    ? 'bg-white text-[#17181b]'
                    : 'text-white/75 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {ANNOTATION_TOOL_LABELS[option]}
              </button>
            );
          })}
        </div>

        {/* A redaction is always opaque near-black, so a colour would be a lie
            about what the tool is going to do. */}
        {tool !== 'redact' && (
          <div className="flex items-center gap-1.5">
            {ANNOTATION_COLORS.map((swatch) => (
              <button
                key={swatch}
                type="button"
                onClick={() => pickColor(swatch)}
                aria-label={`Colour ${swatch}`}
                aria-pressed={swatch === color}
                style={{ background: swatch }}
                className={`h-5 w-5 rounded-full transition-transform ${
                  swatch === color
                    ? 'scale-110 ring-2 ring-white ring-offset-2 ring-offset-[#3a3d42]'
                    : 'hover:scale-110'
                }`}
              />
            ))}
          </div>
        )}

        {tool !== 'redact' && (
          <div className="flex items-center gap-1">
            {STROKE_WIDTHS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => pickWidth(option)}
                aria-label={`Stroke ${option}`}
                aria-pressed={option === width}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                  option === width ? 'bg-white/20' : 'hover:bg-white/10'
                }`}
              >
                <span
                  className="block rounded-full bg-white"
                  style={{ width: option * 2, height: option * 2 }}
                />
              </button>
            ))}
          </div>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => annotatorRef.current?.undo()}
            disabled={!dirty}
            title="Undo the last mark"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium text-white/75 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Undo2 className="h-3.5 w-3.5" />
            Undo
          </button>
          <button
            type="button"
            onClick={() => annotatorRef.current?.clear()}
            disabled={!dirty}
            title="Remove every mark"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium text-white/75 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Start over
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {failed ? (
          <p className="mx-auto max-w-[420px] rounded-[10px] bg-[var(--p-card)] p-4 text-center text-[13.5px] text-[var(--p-second)]">
            {failed}
          </p>
        ) : (
          <div className="mx-auto w-full max-w-[1100px]">
            {!ready && (
              <p className="flex items-center justify-center gap-2 py-10 text-[13px] text-white/70">
                <Loader2 className="h-4 w-4 animate-spin" />
                Opening the screenshot…
              </p>
            )}
            <canvas
              ref={canvasRef}
              // touch-none, or a drag on a phone scrolls the page instead of
              // drawing on the image.
              className={`w-full touch-none rounded-[10px] bg-white ${
                ready ? 'block' : 'hidden'
              } ${tool === 'text' ? 'cursor-text' : 'cursor-crosshair'}`}
            />
          </div>
        )}
      </div>

      {pendingText && (
        <input
          ref={textInputRef}
          type="text"
          defaultValue=""
          placeholder="Type, then Enter"
          onBlur={(event) => commitText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitText(event.currentTarget.value);
            }
          }}
          style={{
            left: pendingText.screen.x,
            top: pendingText.screen.y,
            fontSize: Math.min(28, Math.max(13, pendingText.size)),
            color,
          }}
          className="fixed z-[81] w-[240px] rounded-lg border-2 border-white bg-white px-2 py-1 font-semibold shadow-[0_8px_24px_rgba(0,0,0,0.3)] outline-none"
        />
      )}

      <footer className="flex flex-wrap items-center gap-2.5 border-t border-[rgba(255,255,255,0.12)] px-4 py-3">
        <label htmlFor="annotation-note" className="sr-only">
          Add a note with your markup
        </label>
        <input
          id="annotation-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          disabled={sending}
          placeholder="Say what should change — optional"
          className="h-9 min-w-[200px] flex-1 rounded-lg border border-[rgba(255,255,255,0.18)] bg-[rgba(255,255,255,0.08)] px-3 text-[13.5px] text-white outline-none transition-colors placeholder:text-white/45 focus:border-white/40 disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => (dirty ? setConfirmDiscard(true) : close())}
          disabled={sending}
          className="inline-flex h-9 items-center rounded-lg border border-[rgba(255,255,255,0.18)] px-3.5 text-[13px] font-medium text-white/80 transition-colors hover:bg-white/10 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || !dirty || !!failed}
          title={dirty ? undefined : 'Mark something on the screenshot first'}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-4 text-[13px] font-semibold text-[#17181b] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Send to the team
        </button>
      </footer>

      {confirmDiscard && (
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-2.5 bg-[#17181b] px-4 py-3">
          <span className="text-[13.5px] text-white">
            Discard what you have drawn?
          </span>
          <button
            type="button"
            onClick={() => setConfirmDiscard(false)}
            className="inline-flex h-8 items-center rounded-lg border border-[rgba(255,255,255,0.2)] px-3 text-[13px] font-medium text-white/85 transition-colors hover:bg-white/10"
          >
            Keep editing
          </button>
          <button
            type="button"
            onClick={close}
            className="inline-flex h-8 items-center rounded-lg bg-white px-3 text-[13px] font-semibold text-[#17181b] transition-opacity hover:opacity-90"
          >
            Discard
          </button>
        </div>
      )}
    </div>
  );

  return createPortal(overlay, overlayHost());
}

interface PortalAnnotateButtonProps {
  appSlug: string;
  bugId: string;
  screenshotUrl: string;
  reporterEmail: string;
  signature?: string;
  tools: AnnotationTool[];
}

/**
 * The one client island inside PortalEvidence, which is otherwise a server
 * component — it exists to own `open` and nothing else.
 */
export function PortalAnnotateButton(props: PortalAnnotateButtonProps) {
  // No mounted guard is needed around the portal below: this only opens on a
  // click, so the overlay never renders on the server pass in the first place.
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--p-line-ctrl)] bg-[var(--p-card)] px-3 text-[13px] font-medium text-[var(--p-second)] transition-colors hover:bg-[#f4f4f2]"
      >
        <Pencil className="h-3.5 w-3.5" />
        Mark up
      </button>

      {open && <PortalAnnotator {...props} onClose={() => setOpen(false)} />}
    </>
  );
}
