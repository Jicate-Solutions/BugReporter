import {
  ANNOTATION_COLORS,
  ANNOTATION_TOOLS,
  ANNOTATION_TOOL_HINTS,
  ANNOTATION_TOOL_LABELS,
  type AnnotationTool,
  type Annotator,
  type Point,
} from './types.js';
import { createAnnotator } from './engine.js';

/** Authored against a 1000px-wide image; the engine scales them to the real one. */
const STROKE_WIDTHS = [2, 4, 8];

/**
 * Above everything. The widget mounts into a customer's own application, and it
 * has no way of knowing what that application already stacks — a sticky header,
 * a chat bubble, another modal. This is the top of the 32-bit signed range,
 * which is what the rest of the industry's overlays use for the same reason.
 */
const Z_INDEX = 2147483647;

export interface AnnotatorWidgetOptions {
  /**
   * The capture to mark up — normally the data URL `captureScreenshot()`
   * resolved with, but any image URL works.
   *
   * A cross-origin URL must be served with a permissive CORS header or the
   * canvas is tainted and the export throws; a `data:` URL never is, which is
   * why the capture path is the easy one.
   */
  image: string;
  /**
   * Which tools to offer, in the order given. Defaults to all of them.
   *
   * Pass what `GET /api/v1/public/config` returned. An application that has
   * turned `text` off should not see a text button.
   */
  tools?: readonly AnnotationTool[];
  /**
   * The reporter kept their marks. Receives the flattened image, ready to send
   * as `screenshot_data_url`.
   *
   * If nothing was drawn this is the `image` you passed in, byte for byte —
   * re-encoding an untouched capture only costs quality and size.
   */
  onDone: (dataUrl: string) => void;
  /** The reporter backed out. Never fires after `onDone`. */
  onCancel?: () => void;
  /** Where to mount. Defaults to `document.body`. */
  container?: HTMLElement;
  /** The confirm button's label. Defaults to "Use this screenshot". */
  confirmLabel?: string;
  /** Starting colour. Defaults to the first of `ANNOTATION_COLORS`. */
  color?: string;
  /** Starting stroke width. Defaults to 4. */
  strokeWidth?: number;
}

export interface AnnotatorWidget {
  /** Tear down and restore the page. Idempotent — calling it twice is fine. */
  destroy(): void;
}

const ICONS: Record<AnnotationTool | 'undo' | 'clear' | 'close', string> = {
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  rect: '<rect x="3" y="3" width="18" height="18" rx="2"/>',
  arrow: '<path d="M7 17 17 7"/><path d="M7 7h10v10"/>',
  text: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
  redact:
    '<path d="M9.9 4.2A9 9 0 0 1 21 12a17 17 0 0 1-2.2 3"/><path d="M6.6 6.6A17 17 0 0 0 3 12s3 7 9 7a9 9 0 0 0 4.5-1.2"/><path d="m2 2 20 20"/>',
  undo: '<path d="M3 7v6h6"/><path d="M3.5 13a9 9 0 1 0 2.1-9.4L3 7"/>',
  clear: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};

function icon(name: keyof typeof ICONS): string {
  return (
    `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" ` +
    `stroke="currentColor" stroke-width="2" stroke-linecap="round" ` +
    `stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`
  );
}

/**
 * The style sheet.
 *
 * Every rule is scoped inside the shadow root, and `:host` resets the
 * inheritable properties — font, colour, line-height — because those are the
 * ones that cross a shadow boundary and the host application's are arbitrary.
 * Without the reset a customer with `body { font-family: Papyrus }` gets a
 * toolbar in Papyrus.
 */
const STYLE = `
:host {
  all: initial;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.5;
  color: #fff;
}
* { box-sizing: border-box; }
.root {
  position: fixed; inset: 0; display: flex; flex-direction: column;
  background: rgba(20,22,25,0.72);
  -webkit-font-smoothing: antialiased;
}
/*
  Opaque, while the stage behind stays a translucent scrim.

  The portal's version of this can be translucent throughout because it sits on
  a background the portal chose. This one opens on top of whoever installed the
  widget, and white-on-scrim over an unknown page is a coin toss: against a dark
  chart the controls read fine, against a white form card the stroke-width dots
  disappear completely. Solid chrome, translucent middle.
*/
.bar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.12);
  background: #17181b;
}
.title { font-size: 14.5px; font-weight: 700; letter-spacing: -0.01em; }
.hint { font-size: 12.5px; color: rgba(255,255,255,0.62); }
.spacer { margin-left: auto; }
.group { display: flex; align-items: center; gap: 4px; }
button { font: inherit; cursor: pointer; border: 0; background: none; color: inherit; }
button:disabled { cursor: not-allowed; opacity: 0.4; }
.tool, .action {
  display: inline-flex; align-items: center; gap: 6px; height: 32px;
  padding: 0 10px; border-radius: 8px; font-size: 12.5px; font-weight: 500;
  color: rgba(255,255,255,0.78); transition: background-color 120ms, color 120ms;
}
.tool:hover:not(:disabled), .action:hover:not(:disabled) {
  background: rgba(255,255,255,0.1); color: #fff;
}
.tool[aria-pressed="true"] { background: #fff; color: #17181b; }
.icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  height: 32px; width: 32px; border-radius: 8px; color: rgba(255,255,255,0.7);
}
.icon-btn:hover { background: rgba(255,255,255,0.1); color: #fff; }
.swatch {
  height: 20px; width: 20px; border-radius: 999px; padding: 0;
  transition: transform 120ms; outline: none;
}
.swatch:hover { transform: scale(1.1); }
.swatch[aria-pressed="true"] {
  transform: scale(1.1); box-shadow: 0 0 0 2px #3a3d42, 0 0 0 4px #fff;
}
.width {
  display: inline-flex; align-items: center; justify-content: center;
  height: 32px; width: 32px; border-radius: 8px;
}
.width:hover { background: rgba(255,255,255,0.1); }
.width[aria-pressed="true"] { background: rgba(255,255,255,0.2); }
.width span { display: block; border-radius: 999px; background: #fff; }
.stage { flex: 1; overflow: auto; padding: 16px; }
.frame { margin: 0 auto; width: 100%; max-width: 1100px; }
canvas {
  display: block; width: 100%; border-radius: 10px; background: #fff;
  /* or a drag on a phone scrolls the page instead of drawing on the image */
  touch-action: none; cursor: crosshair;
}
canvas.text-tool { cursor: text; }
canvas.pending { display: none; }
.status {
  margin: 0 auto; max-width: 420px; padding: 40px 16px; text-align: center;
  font-size: 13.5px; color: rgba(255,255,255,0.75);
}
.foot {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end;
  gap: 10px; padding: 12px 14px; border-top: 1px solid rgba(255,255,255,0.12);
  background: #17181b;
}
.ghost {
  display: inline-flex; align-items: center; height: 36px; padding: 0 14px;
  border-radius: 8px; border: 1px solid rgba(255,255,255,0.18);
  font-size: 13px; font-weight: 500; color: rgba(255,255,255,0.85);
}
.ghost:hover { background: rgba(255,255,255,0.1); }
.primary {
  display: inline-flex; align-items: center; height: 36px; padding: 0 16px;
  border-radius: 8px; background: #fff; color: #17181b;
  font-size: 13px; font-weight: 600; transition: opacity 120ms;
}
.primary:hover { opacity: 0.9; }
.text-input {
  position: fixed; width: 240px; padding: 5px 8px; border-radius: 8px;
  border: 2px solid #fff; background: #fff; font-weight: 600; outline: none;
  box-shadow: 0 8px 24px rgba(0,0,0,0.3);
}
.discard {
  position: absolute; inset-inline: 0; bottom: 0; display: flex; flex-wrap: wrap;
  align-items: center; justify-content: center; gap: 10px;
  padding: 12px 14px; background: #17181b; font-size: 13.5px;
}
[hidden] { display: none !important; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`;

/**
 * The capture-time screenshot editor, as a mountable widget.
 *
 * The drawing engine beside this file is framework-free so that both surfaces
 * can share it; this is the other half of that promise — the chrome around it,
 * also framework-free, so the capture widget does not have to rebuild a toolbar,
 * a colour picker and a text input that the reporter portal already has. The
 * portal's own wrapper is React because everything around it is; this one
 * assumes nothing.
 *
 * Two things it deliberately does not do. It sends nothing: the flattened image
 * comes back through `onDone` and the SDK submits it with the rest of the form,
 * as `screenshot_data_url`, on the endpoint that already accepts one. And it
 * does not require a mark before confirming — at capture time the reporter may
 * open this simply to check what was caught, and "I looked, it's fine" has to be
 * one click, not a forced scribble.
 *
 * It renders into a shadow root because it mounts inside somebody else's
 * application. Their reset, their `* { box-sizing }`, their z-index war — none
 * of it reaches in, and nothing here leaks out.
 */
export function mountAnnotator(
  options: AnnotatorWidgetOptions
): AnnotatorWidget {
  const tools =
    options.tools && options.tools.length > 0
      ? options.tools.filter((t) => ANNOTATION_TOOLS.includes(t))
      : ANNOTATION_TOOLS;

  const parent = options.container ?? document.body;
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;inset:0;z-index:${Z_INDEX};`;
  const root = host.attachShadow({ mode: 'open' });

  let tool: AnnotationTool = tools[0] ?? 'pencil';
  let color = options.color ?? ANNOTATION_COLORS[0];
  let width = options.strokeWidth ?? 4;
  let annotator: Annotator | null = null;
  let pendingAt: Point | null = null;
  let destroyed = false;
  let finished = false;

  // ------------------------------------------------------------------- markup

  const style = document.createElement('style');
  style.textContent = STYLE;

  const el = document.createElement('div');
  el.className = 'root';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Mark up the screenshot');
  el.innerHTML = `
    <div class="bar">
      <span class="title">Mark up the screenshot</span>
      <span class="hint" data-hint></span>
      <button type="button" class="icon-btn spacer" data-close aria-label="Close">
        ${icon('close')}
      </button>
    </div>

    <div class="bar">
      <div class="group" data-tools></div>
      <div class="group" data-colors></div>
      <div class="group" data-widths></div>
      <div class="group spacer">
        <button type="button" class="action" data-undo disabled>
          ${icon('undo')}Undo
        </button>
        <button type="button" class="action" data-clear disabled>
          ${icon('clear')}Start over
        </button>
      </div>
    </div>

    <div class="stage">
      <p class="status" data-status>Opening the screenshot…</p>
      <div class="frame"><canvas data-canvas class="pending"></canvas></div>
    </div>

    <input class="text-input" data-text hidden placeholder="Type, then Enter" />

    <div class="foot">
      <button type="button" class="ghost" data-cancel>Cancel</button>
      <button type="button" class="primary" data-confirm>${
        options.confirmLabel ?? 'Use this screenshot'
      }</button>
    </div>

    <div class="discard" data-discard hidden>
      <span>Discard what you have drawn?</span>
      <button type="button" class="ghost" data-keep>Keep editing</button>
      <button type="button" class="primary" data-drop>Discard</button>
    </div>
  `;

  root.append(style, el);
  parent.appendChild(host);

  const q = <T extends HTMLElement>(name: string) =>
    el.querySelector(`[data-${name}]`) as T;

  const canvas = q<HTMLCanvasElement>('canvas');
  const statusEl = q<HTMLParagraphElement>('status');
  const hintEl = q<HTMLSpanElement>('hint');
  const textInput = q<HTMLInputElement>('text');
  const undoBtn = q<HTMLButtonElement>('undo');
  const clearBtn = q<HTMLButtonElement>('clear');
  const discardBar = q<HTMLDivElement>('discard');

  // ------------------------------------------------------------------ toolbar

  const toolBtns = new Map<AnnotationTool, HTMLButtonElement>();
  for (const t of tools) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tool';
    b.title = ANNOTATION_TOOL_HINTS[t];
    b.innerHTML = `${icon(t)}${ANNOTATION_TOOL_LABELS[t]}`;
    b.addEventListener('click', () => pickTool(t));
    toolBtns.set(t, b);
    q('tools').appendChild(b);
  }

  const colorBtns = new Map<string, HTMLButtonElement>();
  for (const c of ANNOTATION_COLORS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.style.background = c;
    b.setAttribute('aria-label', `Colour ${c}`);
    b.addEventListener('click', () => {
      color = c;
      annotator?.setColor(c);
      syncToolbar();
    });
    colorBtns.set(c, b);
    q('colors').appendChild(b);
  }

  const widthBtns = new Map<number, HTMLButtonElement>();
  for (const w of STROKE_WIDTHS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'width';
    b.setAttribute('aria-label', `Stroke ${w}`);
    b.innerHTML = `<span style="width:${w * 2}px;height:${w * 2}px"></span>`;
    b.addEventListener('click', () => {
      width = w;
      annotator?.setStrokeWidth(w);
      syncToolbar();
    });
    widthBtns.set(w, b);
    q('widths').appendChild(b);
  }

  function syncToolbar(): void {
    hintEl.textContent = ANNOTATION_TOOL_HINTS[tool];
    for (const [t, b] of toolBtns) {
      b.setAttribute('aria-pressed', String(t === tool));
    }
    for (const [c, b] of colorBtns) {
      b.setAttribute('aria-pressed', String(c === color));
    }
    for (const [w, b] of widthBtns) {
      b.setAttribute('aria-pressed', String(w === width));
    }
    // A redaction is always opaque near-black, so offering a colour would be a
    // lie about what the tool is going to do.
    const styling = tool !== 'redact';
    q('colors').hidden = !styling;
    q('widths').hidden = !styling;
    canvas.classList.toggle('text-tool', tool === 'text');
  }

  function pickTool(next: AnnotationTool): void {
    tool = next;
    annotator?.setTool(next);
    hideTextInput();
    syncToolbar();
  }

  // --------------------------------------------------------------- text input

  function hideTextInput(): void {
    pendingAt = null;
    textInput.hidden = true;
    textInput.value = '';
  }

  function commitText(): void {
    const at = pendingAt;
    const value = textInput.value.trim();
    hideTextInput();
    if (at && value) annotator?.addText(at, value);
  }

  textInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitText();
    }
  });
  textInput.addEventListener('blur', () => {
    if (!textInput.hidden) commitText();
  });

  // ----------------------------------------------------------------- lifecycle

  const image = new Image();
  // Required for any http(s) source: without it the canvas is tainted the moment
  // the screenshot is drawn and the export throws. Harmless on a data: URL.
  image.crossOrigin = 'anonymous';

  image.onload = () => {
    if (destroyed) return;
    try {
      annotator = createAnnotator({
        canvas,
        image,
        color,
        strokeWidth: width,
        onChange: (state) => {
          undoBtn.disabled = !state.canUndo;
          clearBtn.disabled = !state.dirty;
        },
        onRequestText: (at, screen) => {
          pendingAt = at;
          textInput.hidden = false;
          textInput.style.left = `${screen.x}px`;
          textInput.style.top = `${screen.y}px`;
          textInput.style.color = color;
          textInput.style.fontSize = `${Math.min(
            28,
            Math.max(13, annotator?.textInputSize() ?? 16)
          )}px`;
          textInput.focus();
        },
      });
      annotator.setTool(tool);
      statusEl.hidden = true;
      canvas.classList.remove('pending');
      syncToolbar();
    } catch {
      statusEl.textContent =
        'This screenshot could not be opened for marking up. You can still send it as it is.';
    }
  };

  image.onerror = () => {
    if (destroyed) return;
    statusEl.textContent =
      'This screenshot could not be loaded. You can still send it as it is.';
  };

  image.src = options.image;

  // Escape, in the CAPTURE phase on purpose: the widget opens inside somebody
  // else's application, which may well close its own modal on Escape. Capturing
  // on document runs before any of their bubble handlers and stops the event
  // before the bubble phase exists at all.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    if (!textInput.hidden) hideTextInput();
    else requestCancel();
  };
  document.addEventListener('keydown', onKeyDown, true);

  // The page behind must not scroll while a full-screen canvas is open.
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  // ------------------------------------------------------------------- actions

  function requestCancel(): void {
    if (annotator?.isDirty()) discardBar.hidden = false;
    else finish(null);
  }

  function finish(dataUrl: string | null): void {
    if (finished) return;
    finished = true;
    // Read before destroy(): the callbacks may mount something else, and the
    // widget should be gone by the time they do.
    destroy();
    if (dataUrl === null) options.onCancel?.();
    else options.onDone(dataUrl);
  }

  q('close').addEventListener('click', requestCancel);
  q('cancel').addEventListener('click', requestCancel);
  q('keep').addEventListener('click', () => {
    discardBar.hidden = true;
  });
  q('drop').addEventListener('click', () => finish(null));
  undoBtn.addEventListener('click', () => annotator?.undo());
  clearBtn.addEventListener('click', () => annotator?.clear());

  q('confirm').addEventListener('click', () => {
    // Nothing drawn means nothing to flatten. Handing back the original avoids
    // a pointless re-encode, which on a PNG capture is pure size for no change.
    if (!annotator || !annotator.isDirty()) {
      finish(options.image);
      return;
    }
    try {
      finish(annotator.exportDataUrl());
    } catch {
      statusEl.hidden = false;
      statusEl.textContent =
        'The marked-up image could not be produced. Send the screenshot as it is, or try fewer marks.';
      finished = false;
    }
  });

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    document.removeEventListener('keydown', onKeyDown, true);
    document.body.style.overflow = previousOverflow;
    annotator?.destroy();
    annotator = null;
    image.onload = null;
    image.onerror = null;
    host.remove();
  }

  syncToolbar();

  return { destroy };
}
