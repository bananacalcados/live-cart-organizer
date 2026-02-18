/**
 * Banana Calçados – Live Widget Embed
 * 
 * Cole este script no tema da Shopify (theme.liquid antes do </body>):
 * 
 * <script src="https://live-cart-organizer.lovable.app/live-widget.js" defer></script>
 * 
 * Ou, se estiver usando a URL de preview:
 * <script src="SEU_DOMINIO/live-widget.js" defer></script>
 */
(function () {
  "use strict";

  var LIVE_URL = window.__BANANA_LIVE_URL || (document.currentScript && document.currentScript.src
    ? new URL(document.currentScript.src).origin + "/live"
    : "https://live-cart-organizer.lovable.app/live");

  var API_URL = window.__BANANA_API_URL || (document.currentScript && document.currentScript.src
    ? new URL(document.currentScript.src).origin
    : "https://live-cart-organizer.lovable.app");

  // Styles
  var style = document.createElement("style");
  style.textContent = [
    ".banana-live-bubble{position:fixed;bottom:20px;right:20px;z-index:99999;cursor:pointer;transition:transform .2s;animation:banana-bounce 2s infinite}",
    ".banana-live-bubble:hover{transform:scale(1.1)}",
    ".banana-live-bubble-inner{width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#f59e0b,#d97706);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(245,158,11,.4);position:relative}",
    ".banana-live-bubble-inner svg{width:28px;height:28px;fill:none;stroke:#000;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}",
    ".banana-live-badge{position:absolute;top:-2px;right:-2px;background:#ef4444;color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:10px;font-family:system-ui;animation:banana-pulse 1.5s infinite;line-height:1.2}",
    ".banana-live-popup{position:fixed;bottom:96px;right:20px;z-index:99999;width:380px;height:680px;max-width:calc(100vw - 40px);max-height:calc(100vh - 120px);border-radius:16px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.3);background:#000;opacity:0;transform:translateY(20px) scale(.95);transition:all .25s ease;pointer-events:none}",
    ".banana-live-popup.open{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}",
    ".banana-live-popup iframe{width:100%;height:100%;border:none}",
    ".banana-live-close{position:absolute;top:8px;right:8px;z-index:100000;width:28px;height:28px;border-radius:50%;background:rgba(0,0,0,.6);border:none;color:#fff;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1}",
    "@keyframes banana-bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}",
    "@keyframes banana-pulse{0%,100%{opacity:1}50%{opacity:.6}}",
    "@media(max-width:480px){.banana-live-popup{bottom:0;right:0;width:100%;height:100%;max-width:100%;max-height:100%;border-radius:0}.banana-live-bubble-inner{width:56px;height:56px}.banana-live-bubble{bottom:16px;right:16px}}"
  ].join("\n");
  document.head.appendChild(style);

  // Check if live is active
  var SUPABASE_URL = API_URL.indexOf("lovable.app") > -1
    ? "https://tqxhcyuxgqbzqwoidpie.supabase.co"
    : "https://tqxhcyuxgqbzqwoidpie.supabase.co";

  var SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxeGhjeXV4Z3FienF3b2lkcGllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1MTM2OTYsImV4cCI6MjA4NjA4OTY5Nn0.TaAi_9LF5UKbfFCc2lMI7rX5s_AOkiSNcZSAvhXgbXk";

  function checkLive() {
    fetch(SUPABASE_URL + "/rest/v1/live_sessions?is_active=eq.true&select=id,title&limit=1", {
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": "Bearer " + SUPABASE_KEY
      }
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.length > 0) {
          showBubble(data[0]);
        }
      })
      .catch(function () { /* silently fail */ });
  }

  var bubbleEl = null;
  var popupEl = null;
  var isOpen = false;

  function showBubble(session) {
    if (bubbleEl) return;

    // Create bubble
    bubbleEl = document.createElement("div");
    bubbleEl.className = "banana-live-bubble";
    bubbleEl.innerHTML = [
      '<div class="banana-live-bubble-inner">',
      '  <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
      '  <span class="banana-live-badge">LIVE</span>',
      '</div>'
    ].join("");
    bubbleEl.addEventListener("click", togglePopup);
    document.body.appendChild(bubbleEl);

    // Create popup
    popupEl = document.createElement("div");
    popupEl.className = "banana-live-popup";
    popupEl.innerHTML = [
      '<button class="banana-live-close">&times;</button>',
      '<iframe src="' + LIVE_URL + '?embed=1" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>'
    ].join("");
    popupEl.querySelector(".banana-live-close").addEventListener("click", function (e) {
      e.stopPropagation();
      togglePopup();
    });
    document.body.appendChild(popupEl);
  }

  function togglePopup() {
    isOpen = !isOpen;
    if (popupEl) {
      if (isOpen) {
        popupEl.classList.add("open");
      } else {
        popupEl.classList.remove("open");
      }
    }
  }

  // Init
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", checkLive);
  } else {
    checkLive();
  }

  // Re-check every 60 seconds
  setInterval(checkLive, 60000);
})();
