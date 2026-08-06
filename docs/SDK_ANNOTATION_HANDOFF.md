# Screenshot annotation — what the SDK still has to do

Screenshot annotation ships in two halves. This repo (the platform) owns the
per-application switch, the drawing engine, the reporter-portal editor, and the
endpoint the widget asks for its configuration. All of that is done and live.

The remaining half is capture-time: showing the same editor over the preview
after `captureScreenshot()` resolves, inside
`@boobalan_jkkn/bug-reporter-sdk`, whose source is not in this repository.

This document is the contract between the two.

---

## What already exists for you

### 1. The drawing engine

`@boobalan_jkkn/shared` now exports `createAnnotator`. It is deliberately
framework-free — no React import, DOM types only — so the SDK can wrap it in
whatever it likes.

```ts
import { createAnnotator, ANNOTATION_COLORS } from '@boobalan_jkkn/shared';
// or the subpath, if you want to avoid pulling the type barrel:
// import { createAnnotator } from '@boobalan_jkkn/shared/annotator';

const annotator = createAnnotator({
  canvas,                  // an <canvas> element, resized for you
  image,                   // an HTMLImageElement, ALREADY loaded
  onChange: ({ dirty, canUndo }) => setState({ dirty, canUndo }),
  onRequestText: (at, screen) => showTextInputAt(screen, at),
});

annotator.setTool('rect');        // 'pencil' | 'rect' | 'arrow' | 'text' | 'redact'
annotator.setColor(ANNOTATION_COLORS[0]);
annotator.setStrokeWidth(4);      // authored against a 1000px-wide image
annotator.addText(at, 'remove this');
annotator.undo();
annotator.clear();
annotator.isDirty();
const dataUrl = annotator.exportDataUrl();   // flattened PNG, or JPEG if large
annotator.destroy();
```

Three things about it that will save you a debugging session:

- **The canvas backing store is image space.** `createAnnotator` sets
  `canvas.width/height` itself, capped at 8 megapixels by AREA (not by longest
  edge — these captures are tall, and an edge cap would crush a 1440x6000 page
  to unreadable width). Style the element with `width: 100%`; do not set its
  `width`/`height` attributes.
- **Text is yours.** A canvas cannot be typed into, so the engine hands back the
  click point via `onRequestText(at, screen)` — `at` in image space for
  `addText`, `screen` in viewport coordinates for positioning your `<input>`.
  `annotator.textInputSize()` gives a matching on-screen font size.
- **`exportDataUrl()` is already size-guarded.** PNG first, then a ladder down
  through JPEG quality and scale until the data URL is under 3.5M characters —
  clear of both the 10 MB attachment cap and typical 4.5 MB request-body limits.
  Do not add your own resizing on top.

`redact` draws an opaque near-black block, not a blur, and ignores the current
colour. That is intentional and should not be "fixed": the flattened image is
written to a public storage bucket, and a blur is partially reversible.

### 2. The configuration endpoint

```
GET /api/v1/public/config
Header: X-API-Key: <the application's key>
```

```json
{
  "success": true,
  "data": {
    "annotation": {
      "enabled": true,
      "tools": ["pencil", "rect", "arrow", "text", "redact"]
    }
  }
}
```

CORS is open, same as the submit endpoint. `enabled` is opt-in per application
and defaults to **false**.

### 3. A reference implementation

`app/portal/_components/portal-annotator.tsx` in this repo is a complete wrapper
around the engine — toolbar, colour swatches, stroke widths, the text input,
undo/clear, and a discard guard. It is about 200 lines over the engine and the
capture-time version is the same component with a different footer.

---

## What the SDK needs to do

1. **Bump `@boobalan_jkkn/shared`** to a version that includes
   `src/annotator/`. Note that the package is currently marked `"private": true`
   with `"main": "./src/index.ts"` (raw TypeScript, consumed by this repo through
   `file:packages/shared`). Publishing it for the SDK means dropping `private`
   and bumping the version — the SDK's bundler will transpile the raw TS, but if
   you would rather ship built output, add a `tsup`/`tsc` build step first.

2. **Fetch the config at widget mount**, once, and cache it for the session.
   Treat any failure — network, 401, malformed — as `enabled: false`. A slow or
   broken config call must never be what stops a bug from being filed.

3. **Show the editor after capture, before the form.** Today
   `handleOpenWidget()` captures and drops the result into an 80px-tall cropped
   thumbnail with no zoom, no retake, and no edit. Replace that thumbnail with
   the editor (or with the thumbnail plus a "Mark up" button opening it — the
   portal uses the second shape, and it keeps the fast path fast).

4. **Submit `annotator.exportDataUrl()` as `screenshot_data_url`.** The request
   shape does not change at all: `POST /api/v1/public/bug-reports` already takes
   a base64 data URL there and decodes, uploads, and stores it. **No platform
   change is required for step 4** — that is the point of flattening the marks
   into the image rather than storing an annotation layer.

5. **Only offer the tools the config returned**, in the order given. An app that
   has turned off `text` should not see a text button.

---

## What deliberately is NOT in scope for you

- **Storing annotations as an editable layer.** Marks are burned into the PNG.
  There is no schema for a layer, and the dashboard shows exactly what the
  reporter drew on.
- **Re-annotating an already-submitted report.** That is the platform's job and
  it already works: the reporter opens their report in the Bug Status Portal,
  marks up the stored screenshot, and it arrives as a note on the thread with the
  image attached. Nothing in the SDK is involved.
- **A second feature flag.** One switch governs both surfaces, which is the
  entire reason `/api/v1/public/config` exists.
