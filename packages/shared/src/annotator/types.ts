/**
 * Screenshot annotation — the shapes a reporter can put on a capture.
 *
 * Deliberately free of any framework. This module is the one piece that both the
 * platform (the reporter portal) and the capture widget need, and the widget is a
 * separate package that consumes `@boobalan_jkkn/shared` — a React component here
 * would be unreachable from there, and a copy in each repo would drift the moment
 * either side gained a tool.
 */

export type AnnotationTool = 'pencil' | 'text' | 'rect' | 'arrow' | 'redact';

/** Every tool, in the order a toolbar should show them. */
export const ANNOTATION_TOOLS: readonly AnnotationTool[] = [
  'pencil',
  'rect',
  'arrow',
  'text',
  'redact',
] as const;

export function isAnnotationTool(value: unknown): value is AnnotationTool {
  return (
    typeof value === 'string' &&
    (ANNOTATION_TOOLS as readonly string[]).includes(value)
  );
}

/** What each tool is for, in the reporter's words. Used for labels and titles. */
export const ANNOTATION_TOOL_LABELS: Record<AnnotationTool, string> = {
  pencil: 'Draw',
  rect: 'Box',
  arrow: 'Arrow',
  text: 'Label',
  redact: 'Hide',
};

export const ANNOTATION_TOOL_HINTS: Record<AnnotationTool, string> = {
  pencil: 'Circle or scribble on what is wrong',
  rect: 'Draw a box around the element',
  arrow: 'Point at something',
  text: 'Type a note where it belongs',
  redact: 'Cover anything private before you send it',
};

/**
 * A point in IMAGE space, not screen space.
 *
 * The canvas is displayed scaled to fit whatever dialog is holding it, but a mark
 * placed over a button has to land on that button in the exported file. Storing
 * screen coordinates would put every mark in the wrong place the moment the
 * window was a different width.
 */
export interface Point {
  x: number;
  y: number;
}

interface Stroked {
  color: string;
  strokeWidth: number;
}

export interface PencilMark extends Stroked {
  kind: 'pencil';
  points: Point[];
}

export interface RectMark extends Stroked {
  kind: 'rect';
  from: Point;
  to: Point;
}

export interface ArrowMark extends Stroked {
  kind: 'arrow';
  from: Point;
  to: Point;
}

export interface TextMark extends Stroked {
  kind: 'text';
  at: Point;
  value: string;
  fontSize: number;
}

/**
 * No stroke colour, on purpose — a redaction is always opaque near-black.
 *
 * The flattened image is written to a PUBLIC storage bucket. The whole point of
 * this tool is that what was underneath is gone, so it is a fill rather than a
 * blur (a blur is partially reversible) and it is not tinted by whatever colour
 * the reporter happened to be drawing with.
 */
export interface RedactMark {
  kind: 'redact';
  from: Point;
  to: Point;
}

export type Annotation =
  | PencilMark
  | RectMark
  | ArrowMark
  | TextMark
  | RedactMark;

export interface AnnotatorState {
  dirty: boolean;
  canUndo: boolean;
}

export interface AnnotatorOptions {
  /** Drawn to directly. Its backing store is resized to image space on init. */
  canvas: HTMLCanvasElement;
  /** Must already be loaded — `naturalWidth` is read synchronously. */
  image: HTMLImageElement;
  /** Fired after every change, so a toolbar can enable/disable undo. */
  onChange?: (state: AnnotatorState) => void;
  /**
   * Where the reporter clicked with the text tool.
   *
   * Text cannot be typed into a canvas, so the engine hands the point back and
   * the wrapper puts a real input there. Committing calls `addText`.
   */
  onRequestText?: (point: Point, screen: Point) => void;
  /** Starting colour. Defaults to the first of `ANNOTATION_COLORS`. */
  color?: string;
  /** Starting stroke width, in image pixels at a nominal 1000px-wide image. */
  strokeWidth?: number;
}

export interface Annotator {
  setTool(tool: AnnotationTool): void;
  getTool(): AnnotationTool;
  setColor(color: string): void;
  setStrokeWidth(width: number): void;
  /** Place a label. `at` is in image space, as handed to `onRequestText`. */
  addText(at: Point, value: string): void;
  undo(): void;
  clear(): void;
  isDirty(): boolean;
  canUndo(): boolean;
  /** Convert a client (viewport) coordinate to image space. */
  toImageSpace(clientX: number, clientY: number): Point;
  /** The suggested on-screen font size for the text input, in CSS pixels. */
  textInputSize(): number;
  /**
   * The flattened image, marks burned in.
   *
   * PNG when it fits the budget, JPEG when it does not — see MAX_DATA_URL_CHARS.
   */
  exportDataUrl(): string;
  destroy(): void;
}

/**
 * The palette.
 *
 * Six, not a colour wheel. A reporter marking up a screenshot is choosing "this
 * one" versus "that one", not matching a brand — and every one of these has to
 * stay visible over both a white form and a dark chart.
 */
export const ANNOTATION_COLORS: readonly string[] = [
  '#e5484d',
  '#f76b15',
  '#f5d90a',
  '#30a46c',
  '#0090ff',
  '#8e4ec6',
] as const;
