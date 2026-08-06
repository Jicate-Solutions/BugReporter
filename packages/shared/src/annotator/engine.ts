import {
  ANNOTATION_COLORS,
  type Annotation,
  type AnnotationTool,
  type Annotator,
  type AnnotatorOptions,
  type Point,
} from './types';

/**
 * Ceiling on the canvas backing store, in pixels.
 *
 * Bug screenshots are full-page captures taken at `devicePixelRatio: 2`, so a
 * long settings page can arrive at 2880x12000 — 34 megapixels, 138 MB of RGBA
 * that a phone will not allocate. Capping by AREA rather than by longest edge
 * matters here: these images are tall and narrow, and an edge cap would crush a
 * 1440x6000 capture to a quarter of its width and make the very text the
 * reporter is pointing at unreadable.
 */
const MAX_CANVAS_PIXELS = 8_000_000;

/**
 * Ceiling on the exported data URL, in characters.
 *
 * Two limits sit downstream and this has to clear both: `uploadAttachment`
 * rejects over 10 MB, and hosted request bodies are commonly capped around
 * 4.5 MB. Base64 inflates binary by a third, so ~3.5M characters is a little
 * over 2.5 MB on the wire — comfortably inside both.
 */
const MAX_DATA_URL_CHARS = 3_500_000;

/** Stroke widths are authored against this width and scaled to the real image. */
const NOMINAL_WIDTH = 1000;

/** Opaque, never tinted. See RedactMark. */
const REDACT_FILL = '#111214';

interface Draft {
  tool: AnnotationTool;
  from: Point;
  to: Point;
  points: Point[];
}

/**
 * The drawing surface behind every annotation toolbar.
 *
 * Retained mode, not immediate mode: every mark is kept in an array and the whole
 * stack is redrawn on each change. That costs a full repaint per pointer move,
 * which at these sizes is nothing, and buys the two things an immediate-mode
 * canvas cannot have without a snapshot stack — undo, and an export regenerated
 * from the model rather than scraped off the screen.
 *
 * The canvas backing store IS image space. Setting `canvas.width` to the image's
 * own dimensions (capped, above) means the 2D context's coordinates need no
 * transform at draw time, and export is a straight `toDataURL` rather than a
 * second replay against an offscreen canvas. Only pointer input is converted,
 * once, on the way in.
 */
export function createAnnotator(options: AnnotatorOptions): Annotator {
  const { canvas, image, onChange, onRequestText } = options;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas 2D context is unavailable.');
  }
  const ctx = context;

  const natural = {
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
  };

  const fit = Math.min(
    1,
    Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, natural.width * natural.height))
  );
  canvas.width = Math.max(1, Math.round(natural.width * fit));
  canvas.height = Math.max(1, Math.round(natural.height * fit));

  /** Everything is authored at NOMINAL_WIDTH and scaled up to the real image. */
  const unit = canvas.width / NOMINAL_WIDTH;

  const marks: Annotation[] = [];
  let draft: Draft | null = null;

  let tool: AnnotationTool = 'pencil';
  let color = options.color ?? ANNOTATION_COLORS[0];
  let strokeWidth = options.strokeWidth ?? 4;

  const scaledStroke = () => Math.max(1, strokeWidth * unit);
  const fontSize = () => Math.max(12, 17 * unit) * (strokeWidth / 4);

  const notify = () =>
    onChange?.({ dirty: marks.length > 0, canUndo: marks.length > 0 });

  // ---------------------------------------------------------------- rendering

  function drawPath(target: CanvasRenderingContext2D, points: Point[]) {
    if (points.length === 0) return;
    target.beginPath();
    target.moveTo(points[0].x, points[0].y);
    // A single tap should still leave a dot rather than nothing at all.
    if (points.length === 1) {
      target.lineTo(points[0].x + 0.01, points[0].y);
    }
    for (let i = 1; i < points.length; i += 1) {
      target.lineTo(points[i].x, points[i].y);
    }
    target.stroke();
  }

  function drawArrow(
    target: CanvasRenderingContext2D,
    from: Point,
    to: Point,
    width: number
  ) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const head = Math.max(width * 3.2, 10 * unit);

    // Stop the shaft short of the tip, or the head sits on a blunt line end and
    // reads as a lollipop rather than an arrow.
    const shaftEnd = {
      x: to.x - Math.cos(angle) * head * 0.75,
      y: to.y - Math.sin(angle) * head * 0.75,
    };

    target.beginPath();
    target.moveTo(from.x, from.y);
    target.lineTo(shaftEnd.x, shaftEnd.y);
    target.stroke();

    target.beginPath();
    target.moveTo(to.x, to.y);
    target.lineTo(
      to.x - Math.cos(angle - Math.PI / 7) * head,
      to.y - Math.sin(angle - Math.PI / 7) * head
    );
    target.lineTo(
      to.x - Math.cos(angle + Math.PI / 7) * head,
      to.y - Math.sin(angle + Math.PI / 7) * head
    );
    target.closePath();
    target.fill();
  }

  function roundedRect(
    target: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
  ) {
    const r = Math.min(radius, width / 2, height / 2);
    target.beginPath();
    target.moveTo(x + r, y);
    target.arcTo(x + width, y, x + width, y + height, r);
    target.arcTo(x + width, y + height, x, y + height, r);
    target.arcTo(x, y + height, x, y, r);
    target.arcTo(x, y, x + width, y, r);
    target.closePath();
  }

  /**
   * Black text or white text, decided by the chip behind it.
   *
   * A label is drawn as a filled chip in the annotation colour so it stays
   * readable over a busy screenshot. That makes the text colour a contrast
   * problem, and the yellow in the palette is exactly the case a fixed white
   * would fail.
   */
  function readableInk(background: string): string {
    const hex = background.replace('#', '');
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((c) => c + c)
            .join('')
        : hex;
    const r = parseInt(full.slice(0, 2), 16) / 255;
    const g = parseInt(full.slice(2, 4), 16) / 255;
    const b = parseInt(full.slice(4, 6), 16) / 255;
    const channel = (c: number) =>
      c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    const luminance =
      0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    return luminance > 0.45 ? '#111214' : '#ffffff';
  }

  function drawText(
    target: CanvasRenderingContext2D,
    mark: { at: Point; value: string; color: string; fontSize: number }
  ) {
    const size = mark.fontSize;
    target.font =
      '600 ' +
      size +
      'px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
    target.textBaseline = 'top';

    const padX = size * 0.45;
    const padY = size * 0.28;
    const lines = mark.value.split('\n');
    const widest = Math.max(
      ...lines.map((line) => target.measureText(line).width)
    );
    const lineHeight = size * 1.3;
    const boxWidth = widest + padX * 2;
    const boxHeight = lineHeight * lines.length + padY * 2;

    // Nudge the chip back inside the frame rather than letting a label placed
    // near the right edge get cropped out of the file.
    const x = Math.max(2, Math.min(mark.at.x, canvas.width - boxWidth - 2));
    const y = Math.max(2, Math.min(mark.at.y, canvas.height - boxHeight - 2));

    target.fillStyle = mark.color;
    roundedRect(target, x, y, boxWidth, boxHeight, size * 0.35);
    target.fill();

    target.fillStyle = readableInk(mark.color);
    lines.forEach((line, index) => {
      target.fillText(line, x + padX, y + padY + index * lineHeight);
    });
  }

  function paint(target: CanvasRenderingContext2D, mark: Annotation) {
    target.lineCap = 'round';
    target.lineJoin = 'round';

    if (mark.kind === 'redact') {
      target.fillStyle = REDACT_FILL;
      target.fillRect(
        Math.min(mark.from.x, mark.to.x),
        Math.min(mark.from.y, mark.to.y),
        Math.abs(mark.to.x - mark.from.x),
        Math.abs(mark.to.y - mark.from.y)
      );
      return;
    }

    target.strokeStyle = mark.color;
    target.fillStyle = mark.color;
    target.lineWidth = mark.strokeWidth;

    if (mark.kind === 'pencil') {
      drawPath(target, mark.points);
    } else if (mark.kind === 'rect') {
      target.strokeRect(
        Math.min(mark.from.x, mark.to.x),
        Math.min(mark.from.y, mark.to.y),
        Math.abs(mark.to.x - mark.from.x),
        Math.abs(mark.to.y - mark.from.y)
      );
    } else if (mark.kind === 'arrow') {
      drawArrow(target, mark.from, mark.to, mark.strokeWidth);
    } else if (mark.kind === 'text') {
      drawText(target, mark);
    }
  }

  function draftToMark(current: Draft): Annotation {
    const width = scaledStroke();
    if (current.tool === 'pencil') {
      return {
        kind: 'pencil',
        points: current.points,
        color,
        strokeWidth: width,
      };
    }
    if (current.tool === 'redact') {
      return { kind: 'redact', from: current.from, to: current.to };
    }
    if (current.tool === 'arrow') {
      return {
        kind: 'arrow',
        from: current.from,
        to: current.to,
        color,
        strokeWidth: width,
      };
    }
    return {
      kind: 'rect',
      from: current.from,
      to: current.to,
      color,
      strokeWidth: width,
    };
  }

  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const mark of marks) paint(ctx, mark);
    if (draft) paint(ctx, draftToMark(draft));
  }

  // ------------------------------------------------------------------- input

  function toImageSpace(clientX: number, clientY: number): Point {
    const box = canvas.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return { x: 0, y: 0 };
    return {
      x: ((clientX - box.left) / box.width) * canvas.width,
      y: ((clientY - box.top) / box.height) * canvas.height,
    };
  }

  function onPointerDown(event: PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const at = toImageSpace(event.clientX, event.clientY);

    if (tool === 'text') {
      // The engine owns the mark, the wrapper owns the input — a canvas cannot
      // be typed into.
      onRequestText?.(at, { x: event.clientX, y: event.clientY });
      return;
    }

    event.preventDefault();
    // Capture, so a drag that leaves the canvas still finishes on this element
    // instead of leaving a half-drawn shape stuck to the cursor.
    canvas.setPointerCapture(event.pointerId);
    draft = { tool, from: at, to: at, points: [at] };
    redraw();
  }

  function onPointerMove(event: PointerEvent) {
    if (!draft) return;
    event.preventDefault();
    const at = toImageSpace(event.clientX, event.clientY);
    draft.to = at;
    if (draft.tool === 'pencil') draft.points.push(at);
    redraw();
  }

  function onPointerUp(event: PointerEvent) {
    if (!draft) return;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }

    const current = draft;
    draft = null;

    // A click that never moved is a mis-click for the drag tools, not a
    // zero-sized box the reporter now has to undo.
    const moved =
      Math.abs(current.to.x - current.from.x) > 2 * unit ||
      Math.abs(current.to.y - current.from.y) > 2 * unit;

    if (current.tool === 'pencil' || moved) {
      marks.push(draftToMark(current));
    }

    redraw();
    notify();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  redraw();

  // ------------------------------------------------------------------ export

  /**
   * Flatten, within budget.
   *
   * PNG first, because a screenshot is mostly flat colour and text and PNG is
   * both smaller and sharper for that. A photo-heavy or very tall capture can
   * still blow past the limit, so the ladder falls back to JPEG and then to a
   * smaller image — a slightly soft screenshot that arrives beats a pristine one
   * the server refuses.
   */
  function exportDataUrl(): string {
    const png = canvas.toDataURL('image/png');
    if (png.length <= MAX_DATA_URL_CHARS) return png;

    const ladder = [
      { scale: 1, quality: 0.9 },
      { scale: 1, quality: 0.75 },
      { scale: 0.7, quality: 0.8 },
      { scale: 0.5, quality: 0.7 },
    ];

    let last = png;
    for (const step of ladder) {
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(canvas.width * step.scale));
      out.height = Math.max(1, Math.round(canvas.height * step.scale));
      const outCtx = out.getContext('2d');
      if (!outCtx) break;
      outCtx.drawImage(canvas, 0, 0, out.width, out.height);
      last = out.toDataURL('image/jpeg', step.quality);
      if (last.length <= MAX_DATA_URL_CHARS) return last;
    }

    // Every rung exhausted. Hand back the smallest we made and let the route
    // answer with a real error rather than silently sending nothing.
    return last;
  }

  return {
    setTool(next) {
      tool = next;
    },
    getTool: () => tool,
    setColor(next) {
      color = next;
    },
    setStrokeWidth(next) {
      strokeWidth = next;
    },
    addText(at, value) {
      const trimmed = value.trim();
      if (!trimmed) return;
      marks.push({
        kind: 'text',
        at,
        value: trimmed,
        color,
        strokeWidth: scaledStroke(),
        fontSize: fontSize(),
      });
      redraw();
      notify();
    },
    undo() {
      marks.pop();
      redraw();
      notify();
    },
    clear() {
      marks.length = 0;
      draft = null;
      redraw();
      notify();
    },
    isDirty: () => marks.length > 0,
    canUndo: () => marks.length > 0,
    toImageSpace,
    textInputSize() {
      const box = canvas.getBoundingClientRect();
      const displayScale = box.width > 0 ? box.width / canvas.width : 1;
      return Math.max(11, fontSize() * displayScale);
    },
    exportDataUrl,
    destroy() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
    },
  };
}
