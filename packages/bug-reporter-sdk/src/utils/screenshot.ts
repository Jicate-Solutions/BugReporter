import html2canvas from 'html2canvas';

function isMobileDevice(): boolean {
  return (
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    ) ||
    (window.innerWidth <= 768 && 'ontouchstart' in window)
  );
}

/**
 * Capture the current viewport as a PNG data URL.
 *
 * Reconstructed from the published 1.3.2 bundle.
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
      scale: Math.max(window.devicePixelRatio || 1, 2),
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
      scrollX: originalScrollX,
      scrollY: originalScrollY,
      foreignObjectRendering: true,

      // Keep the widget, and anything floating over the page, out of the shot —
      // a reporter is pointing at the application, not at the tool or at the
      // toast that happened to be up when they clicked.
      ignoreElements: (element: Element) => {
        if (element.classList.contains('bug-reporter-widget')) return true;
        if (element.classList.contains('bug-reporter-sdk')) return true;

        const className = element.className || '';
        if (typeof className === 'string') {
          const overlayClasses = [
            'radix-portal',
            'toast',
            'modal',
            'overlay',
            'popup',
            'dropdown',
            'tooltip',
            'popover',
            'dialog',
            'notification',
          ];
          if (overlayClasses.some((cls) => className.includes(cls))) {
            return true;
          }
        }

        const role = element.getAttribute('role');
        if (
          role &&
          ['dialog', 'alertdialog', 'tooltip', 'menu'].includes(role)
        ) {
          return true;
        }

        if (
          element.hasAttribute('data-radix-portal') ||
          element.hasAttribute('data-sonner-toaster') ||
          element.hasAttribute('data-html2canvas-ignore')
        ) {
          return true;
        }

        const computedStyle = window.getComputedStyle(element);
        if (
          computedStyle.display === 'none' ||
          computedStyle.visibility === 'hidden' ||
          computedStyle.opacity === '0'
        ) {
          return true;
        }

        return false;
      },
    };

    // Let the page finish whatever it was doing — animations, lazy images —
    // before the snapshot is taken.
    await new Promise((resolve) => setTimeout(resolve, 800));

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
