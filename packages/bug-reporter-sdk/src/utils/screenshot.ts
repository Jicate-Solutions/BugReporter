import html2canvas from 'html2canvas';

function isMobileDevice(): boolean {
  return (
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    ) ||
    (window.innerWidth <= 768 && 'ontouchstart' in window)
  );
}

/** Resolve after the browser has painted once, so the capture sees settled layout. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/**
 * Capture the current viewport as a PNG data URL.
 *
 * The shot is the viewport the reporter is actually looking at, with the page's
 * own UI — open dropdowns, toasts, dialogs — left in place. That UI is usually
 * the whole point of the report.
 */
export async function captureScreenshot(): Promise<string> {
  console.log('[BugReporter SDK] Starting screenshot capture...');

  const isMobile = isMobileDevice();
  const originalScrollX = window.scrollX;
  const originalScrollY = window.scrollY;

  try {
    // Reading offsetHeight forces a reflow, so the capture sees a settled layout.
    void document.body.offsetHeight;

    const options: Parameters<typeof html2canvas>[1] = {
      // Cap at 2. Going above the device's own ratio buys nothing visible and
      // costs quadratically in rasterising time and upload size.
      scale: Math.min(window.devicePixelRatio || 1, 2),
      backgroundColor: '#ffffff',
      useCORS: true,
      allowTaint: false,
      removeContainer: true,
      logging: false,
      imageTimeout: isMobile ? 15_000 : 30_000,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      width: window.innerWidth,
      height: window.innerHeight,

      // scrollX/scrollY only tell html2canvas where the viewport sits, which is
      // how it places position:fixed nodes. They do NOT move the crop — that is
      // what x/y do, and without them every shot is the top-left of the
      // document rather than the part of the page the reporter had scrolled to.
      scrollX: originalScrollX,
      scrollY: originalScrollY,
      x: originalScrollX,
      y: originalScrollY,

      // Keep the SDK's own chrome out of the shot, and nothing else. Anything
      // the host application wants excluded can opt out with the attribute.
      //
      // Resist adding a `display: none` shortcut here. html2canvas walks the
      // whole document, <head> included, and <head> computes to display:none —
      // skipping it drops every <style> from the clone and the capture renders
      // as a blank unstyled page. html2canvas already ignores non-rendered
      // elements when it parses, so there is nothing to win.
      ignoreElements: (element: Element) =>
        element.closest('.bug-reporter-sdk, .bug-reporter-widget') !== null ||
        element.hasAttribute('data-html2canvas-ignore'),
    };

    // One settled paint is enough. A longer wait only gives the page more time
    // to close the dropdown the reporter is trying to show us.
    await nextPaint();

    const targetElement = document.querySelector('body');
    if (!targetElement) {
      throw new Error('Could not find body element');
    }

    const canvas = await html2canvas(targetElement, options);
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      throw new Error('Canvas creation failed');
    }

    const dataUrl = canvas.toDataURL('image/png', 1);
    console.log('[BugReporter SDK] Screenshot captured successfully');
    return dataUrl;
  } catch (error) {
    console.error('[BugReporter SDK] Screenshot capture failed:', error);
    throw error;
  }
}
