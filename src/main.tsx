import { createRoot } from "react-dom/client";
import "./index.css";

// Auth hotfix: some browsers can keep Supabase Auth's Navigator Web Lock
// orphaned, which makes signInWithPassword/getSession hang indefinitely.
// This must run before App imports the Supabase client, so App is loaded
// dynamically at the bottom of this file.
if (typeof navigator !== "undefined" && "locks" in navigator) {
  try {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      get: () => undefined,
    });
  } catch {
    // If the browser refuses the override, continue with the native behavior.
  }
}

// Patch DOM methods to prevent crashes from browser extensions
// that modify React-managed DOM nodes (e.g. translation, Grammarly, ad blockers)
if (typeof Node !== 'undefined') {
  const originalRemoveChild = Node.prototype.removeChild;
  // @ts-ignore
  Node.prototype.removeChild = function <T extends Node>(child: T): T {
    if (child.parentNode !== this) {
      console.warn('removeChild: node is not a child of this node – suppressed');
      return child;
    }
    return originalRemoveChild.call(this, child) as T;
  };

  const originalInsertBefore = Node.prototype.insertBefore;
  // @ts-ignore
  Node.prototype.insertBefore = function <T extends Node>(newNode: T, refNode: Node | null): T {
    if (refNode && refNode.parentNode !== this) {
      console.warn('insertBefore: refNode is not a child of this node – suppressed');
      return newNode;
    }
    return originalInsertBefore.call(this, newNode, refNode) as T;
  };
}

// PWA: remove legacy app-cache service workers that can serve stale published
// bundles. Keep push notification workers intact on production.
const isInIframe = (() => {
  try { return window.self !== window.top; } catch { return true; }
})();
const isPreviewHost =
  window.location.hostname.includes("id-preview--") ||
  window.location.hostname.includes("lovableproject.com");
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) =>
    regs.forEach((registration) => {
      const scriptURL =
        registration.active?.scriptURL ||
        registration.waiting?.scriptURL ||
        registration.installing?.scriptURL ||
        "";
      const isLegacyAppWorker = scriptURL.endsWith("/sw.js");

      if (isPreviewHost || isInIframe || isLegacyAppWorker) {
        registration.unregister();
      }
    })
  );
}

if ((isPreviewHost || isInIframe) && "caches" in window) {
  caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)));
}

const root = createRoot(document.getElementById("root")!);

import("./App.tsx").then(({ default: App }) => {
  root.render(<App />);
});
