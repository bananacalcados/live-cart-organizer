/**
 * Meta Pixel (Facebook Pixel) utility
 * Shared across Live, Checkout, and Landing pages.
 */

const META_PIXEL_ID = import.meta.env.VITE_META_PIXEL_ID || "722468550447865";

/** Inject the fbevents.js SDK and initialise the pixel (idempotent). */
export function initMetaPixel() {
  if (!META_PIXEL_ID || (window as any).fbq) return;

  const f = window as any;
  const n: any = function (...args: any[]) {
    n.callMethod ? n.callMethod(...args) : n.queue.push(args);
  };
  f.fbq = n;
  if (!f._fbq) f._fbq = n;
  n.push = n;
  n.loaded = true;
  n.version = "2.0";
  n.queue = [];

  const s = document.createElement("script");
  s.async = true;
  s.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(s);

  f.fbq("init", META_PIXEL_ID);
}

/** Read ?test_event_code= from the URL (for Meta Events Manager testing). */
function getTestEventCode(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("test_event_code");
  } catch {
    return null;
  }
}

/** Fire a standard or custom pixel event. */
export function trackPixelEvent(event: string, data?: Record<string, any>) {
  if (!(window as any).fbq) return;
  const testCode = getTestEventCode();
  const eventData = testCode ? { ...data, test_event_code: testCode } : data;
  (window as any).fbq("track", event, eventData);
}

/** Convenience: fire PageView (call once per page load). */
export function trackPageView() {
  trackPixelEvent("PageView");
}
