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

/** Read a cookie value by name. */
export function readCookie(name: string): string | null {
  try {
    const match = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]*)"));
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

/** Get the Meta `_fbp` browser cookie (1st-party). */
export function getFbp(): string | null {
  return readCookie("_fbp");
}

/**
 * Get the Meta `_fbc` cookie. If missing but the URL has `?fbclid=...`,
 * synthesize a valid `_fbc` value (`fb.1.<timestamp>.<fbclid>`).
 */
export function getFbc(): string | null {
  const cookie = readCookie("_fbc");
  if (cookie) return cookie;
  try {
    const fbclid = new URLSearchParams(window.location.search).get("fbclid");
    if (fbclid) return `fb.1.${Date.now()}.${fbclid}`;
  } catch {}
  return null;
}

/** Browser-side options for tracked events (incl. dedupe via eventID). */
export interface TrackOptions {
  eventID?: string;
}

/** Fire a standard or custom pixel event (browser). */
export function trackPixelEvent(event: string, data?: Record<string, any>, options?: TrackOptions) {
  if (!(window as any).fbq) return;
  const testCode = getTestEventCode();
  const eventData = testCode ? { ...data, test_event_code: testCode } : data;
  if (options?.eventID) {
    (window as any).fbq("track", event, eventData, { eventID: options.eventID });
  } else {
    (window as any).fbq("track", event, eventData);
  }
}

/** Convenience: fire PageView (call once per page load). */
export function trackPageView() {
  trackPixelEvent("PageView");
}
