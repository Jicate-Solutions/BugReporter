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

### 3. The editor itself — you no longer have to build it

`@boobalan_jkkn/shared` also exports `mountAnnotator`, the whole capture-time
editor as one call. Toolbar, colour swatches, stroke widths, the text input,
undo/clear, the discard guard and the export are all inside it. It is
framework-free and renders into a shadow root, so the host application's CSS
cannot reach in and nothing it does leaks out.

```ts
import { mountAnnotator } from '@boobalan_jkkn/shared';

mountAnnotator({
  image: capturedDataUrl,        // what captureScreenshot() resolved with
  tools: config.annotation.tools, // from /api/v1/public/config, order respected
  onDone: (dataUrl) => {
    // send this as screenshot_data_url. If nothing was drawn it is the string
    // you passed in, byte for byte — no pointless re-encode of a clean capture.
    setScreenshot(dataUrl);
  },
  onCancel: () => {},            // optional; never fires after onDone
});
```

It unmounts itself before `onDone`/`onCancel` fire, so there is nothing to clean
up. The returned handle has a `destroy()` if you need to tear it down yourself
(the reporter navigated away mid-edit, say); it is idempotent.

`app/portal/_components/portal-annotator.tsx` is still there and is still the
React equivalent, but you should not need to read it — it exists because the
portal is React and wants its own palette, not because the widget needs a
reference to copy.

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
   thumbnail with no zoom, no retake, and no edit. Keep that thumbnail and put a
   "Mark up" button beside it that calls `mountAnnotator` — the portal uses that
   shape and it keeps the fast path fast, since most reports do not need a mark.
   This is now a handful of lines, not a component: see section 3 above.

4. **Submit `annotator.exportDataUrl()` as `screenshot_data_url`.** The request
   shape does not change at all: `POST /api/v1/public/bug-reports` already takes
   a base64 data URL there and decodes, uploads, and stores it. **No platform
   change is required for step 4** — that is the point of flattening the marks
   into the image rather than storing an annotation layer.

5. **Only offer the tools the config returned**, in the order given. An app that
   has turned off `text` should not see a text button.

---

## While you are in there: the border shorthand warning

Unrelated to annotation, but it lives in the same file you will be editing and it
fires on every category click in the widget today (seen on v1.3.2):

```
Removing a style property during rerender (borderColor) when a conflicting
property is set (border) can lead to styling bugs.
Removing a style property during rerender (borderWidth) ...
```

React manages inline styles by diffing the object it last applied. A base style
that sets the `border` **shorthand** and a modifier that sets the `borderColor` /
`borderWidth` **longhands** cannot be diffed coherently: when the modifier comes
off, React removes the longhands while the shorthand is still there, and which
border you end up with is down to property ordering.

Three pairs in the styles object do this. In each case the fix is to split the
shorthand in the **base** into longhands — not to change the modifier:

| Base | Currently | Modifier that conflicts |
|---|---|---|
| `categoryCard` | `border: '1.5px solid #e5e7eb'` | `categoryCardSelected` → `borderColor`, `borderWidth` |
| `filterButton` | `border: '1px solid #e5e7eb'` | `filterButtonActive` → `borderColor` |
| `bugCard` | `border: '1px solid #e5e7eb'` | `bugCardHover` → `borderColor` |

```diff
  categoryCard: {
-   border: '1.5px solid #e5e7eb',
+   borderWidth: '1.5px',
+   borderStyle: 'solid',
+   borderColor: '#e5e7eb',
    borderRadius: '0.5rem',
```

The same applies to the `onMouseEnter` / `onMouseLeave` handlers that write
`e.currentTarget.style.borderColor` directly. Those do not warn, because they
bypass React — but they are the same latent bug: React's next style diff owns
that element's `border` and will overwrite whatever the handler set. Prefer
driving hover from state, or at minimum split the base there too.

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
