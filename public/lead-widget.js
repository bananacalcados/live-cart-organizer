/**
 * Banana Calçados – Lead Capture Widget (Exit Intent Popup)
 *
 * Cole este script no tema da Shopify (theme.liquid antes do </body>):
 *
 * <script src="https://live-cart-organizer.lovable.app/lead-widget.js" defer></script>
 */
(function () {
  "use strict";

  var SUPABASE_URL = "https://tqxhcyuxgqbzqwoidpie.supabase.co";
  var SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxeGhjeXV4Z3FienF3b2lkcGllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1MTM2OTYsImV4cCI6MjA4NjA4OTY5Nn0.TaAi_9LF5UKbfFCc2lMI7rX5s_AOkiSNcZSAvhXgbXk";

  var DISMISS_KEY = "banana_lead_dismissed";
  var SUBMITTED_KEY = "banana_lead_submitted";

  // Don't show if already submitted or dismissed recently (24h)
  if (localStorage.getItem(SUBMITTED_KEY)) return;
  var dismissed = localStorage.getItem(DISMISS_KEY);
  if (dismissed && Date.now() - parseInt(dismissed, 10) < 86400000) return;

  var style = document.createElement("style");
  style.textContent = [
    ".banana-lead-overlay{position:fixed;inset:0;z-index:999998;background:rgba(0,0,0,.6);opacity:0;transition:opacity .3s;pointer-events:none;display:flex;align-items:center;justify-content:center}",
    ".banana-lead-overlay.open{opacity:1;pointer-events:auto}",
    ".banana-lead-popup{background:#fff;border-radius:16px;max-width:400px;width:calc(100% - 32px);padding:32px 24px;box-shadow:0 20px 60px rgba(0,0,0,.3);transform:translateY(30px) scale(.95);transition:transform .3s;position:relative;text-align:center;font-family:system-ui,-apple-system,sans-serif}",
    ".banana-lead-overlay.open .banana-lead-popup{transform:translateY(0) scale(1)}",
    ".banana-lead-close{position:absolute;top:12px;right:12px;width:28px;height:28px;border-radius:50%;background:#f3f4f6;border:none;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#666}",
    ".banana-lead-close:hover{background:#e5e7eb}",
    ".banana-lead-logo{width:56px;height:56px;border-radius:50%;object-fit:cover;margin:0 auto 12px}",
    ".banana-lead-title{font-size:20px;font-weight:700;color:#111;margin:0 0 6px}",
    ".banana-lead-desc{font-size:14px;color:#666;margin:0 0 20px;line-height:1.4}",
    ".banana-lead-form{display:flex;flex-direction:column;gap:10px}",
    ".banana-lead-input{width:100%;padding:12px 14px;border:1px solid #d1d5db;border-radius:10px;font-size:15px;outline:none;box-sizing:border-box;transition:border-color .2s}",
    ".banana-lead-input:focus{border-color:#f59e0b}",
    ".banana-lead-btn{width:100%;padding:13px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#000;font-weight:700;font-size:15px;border:none;border-radius:10px;cursor:pointer;transition:opacity .2s}",
    ".banana-lead-btn:hover{opacity:.9}",
    ".banana-lead-btn:disabled{opacity:.5;cursor:not-allowed}",
    ".banana-lead-privacy{font-size:10px;color:#aaa;margin-top:8px}",
    ".banana-lead-success{padding:20px 0}",
    ".banana-lead-success svg{width:48px;height:48px;margin:0 auto 12px;color:#22c55e}",
    ".banana-lead-success h3{font-size:18px;font-weight:700;color:#111;margin:0 0 8px}",
    ".banana-lead-success p{font-size:13px;color:#666;margin:0}"
  ].join("\n");
  document.head.appendChild(style);

  var landingPage = null;
  var overlayEl = null;
  var triggered = false;

  function fetchLandingPage() {
    fetch(SUPABASE_URL + "/rest/v1/campaign_landing_pages?is_active=eq.true&select=id,campaign_id,title,description,hero_image_url,form_fields,thank_you_message,whatsapp_redirect&order=created_at.desc&limit=1", {
      headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY }
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.length > 0) {
          landingPage = data[0];
          setupExitIntent();
        }
      })
      .catch(function () { });
  }

  function setupExitIntent() {
    // Desktop: mouseleave on top of page
    document.addEventListener("mouseout", function (e) {
      if (e.clientY <= 0 && !triggered) {
        triggered = true;
        showPopup();
      }
    });

    // Mobile fallback: scroll up rapidly or after 30s on page
    var mobileTimer = setTimeout(function () {
      if (!triggered) { triggered = true; showPopup(); }
    }, 30000);

    // Also track back button intent on mobile
    var lastScroll = window.scrollY;
    window.addEventListener("scroll", function () {
      var current = window.scrollY;
      if (lastScroll - current > 200 && current < 100 && !triggered) {
        triggered = true;
        showPopup();
        clearTimeout(mobileTimer);
      }
      lastScroll = current;
    }, { passive: true });
  }

  function formatPhone(value) {
    var digits = value.replace(/\D/g, "").slice(0, 11);
    if (digits.length <= 2) return digits;
    if (digits.length <= 7) return "(" + digits.slice(0, 2) + ") " + digits.slice(2);
    return "(" + digits.slice(0, 2) + ") " + digits.slice(2, 7) + "-" + digits.slice(7);
  }

  function showPopup() {
    if (!landingPage || overlayEl) return;

    var lp = landingPage;
    var fields = Array.isArray(lp.form_fields) ? lp.form_fields : [
      { name: "nome", label: "Seu nome", type: "text", required: true },
      { name: "whatsapp", label: "WhatsApp", type: "tel", required: true }
    ];

    overlayEl = document.createElement("div");
    overlayEl.className = "banana-lead-overlay";

    var logoSrc = (document.currentScript && document.currentScript.src)
      ? new URL(document.currentScript.src).origin + "/images/banana-logo.png"
      : "https://live-cart-organizer.lovable.app/images/banana-logo.png";

    var fieldsHtml = fields.map(function (f) {
      return '<input class="banana-lead-input" name="' + f.name + '" type="' + (f.type || 'text') + '" placeholder="' + f.label + '"' + (f.required ? ' required' : '') + (f.type === 'tel' ? ' inputmode="tel"' : '') + ' />';
    }).join("");

    overlayEl.innerHTML = [
      '<div class="banana-lead-popup">',
      '  <button class="banana-lead-close">&times;</button>',
      '  <img src="' + logoSrc + '" alt="Logo" class="banana-lead-logo" />',
      '  <h2 class="banana-lead-title">' + (lp.title || 'Não vá embora!') + '</h2>',
      '  <p class="banana-lead-desc">' + (lp.description || 'Cadastre-se e receba ofertas exclusivas!') + '</p>',
      '  <form class="banana-lead-form" id="banana-lead-form">',
      '    ' + fieldsHtml,
      '    <button type="submit" class="banana-lead-btn">Participar</button>',
      '  </form>',
      '  <p class="banana-lead-privacy">Seus dados são protegidos e usados apenas para contato comercial.</p>',
      '</div>'
    ].join("");

    document.body.appendChild(overlayEl);

    // Phone formatting
    var telInputs = overlayEl.querySelectorAll('input[type="tel"]');
    telInputs.forEach(function (input) {
      input.addEventListener("input", function () {
        input.value = formatPhone(input.value);
      });
    });

    // Animate in
    requestAnimationFrame(function () { overlayEl.classList.add("open"); });

    // Close button
    overlayEl.querySelector(".banana-lead-close").addEventListener("click", dismissPopup);

    // Click outside
    overlayEl.addEventListener("click", function (e) {
      if (e.target === overlayEl) dismissPopup();
    });

    // Form submit
    overlayEl.querySelector("#banana-lead-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var formData = {};
      fields.forEach(function (f) {
        var input = overlayEl.querySelector('input[name="' + f.name + '"]');
        if (input) formData[f.name] = input.value;
      });

      var btn = overlayEl.querySelector(".banana-lead-btn");
      btn.disabled = true;
      btn.textContent = "Enviando...";

      fetch(SUPABASE_URL + "/rest/v1/campaign_leads", {
        method: "POST",
        headers: {
          "apikey": SUPABASE_KEY,
          "Authorization": "Bearer " + SUPABASE_KEY,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          campaign_id: lp.campaign_id,
          name: formData.nome || formData.name || null,
          phone: formData.whatsapp || formData.phone || formData.telefone || null,
          email: formData.email || null,
          instagram: formData.instagram || null,
          source: "exit_intent_popup",
          metadata: formData
        })
      }).then(function () {
        localStorage.setItem(SUBMITTED_KEY, "1");

        // Increment submissions
        fetch(SUPABASE_URL + "/rest/v1/campaign_landing_pages?id=eq." + lp.id, {
          method: "PATCH",
          headers: {
            "apikey": SUPABASE_KEY,
            "Authorization": "Bearer " + SUPABASE_KEY,
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
          },
          body: JSON.stringify({ submissions: (lp.submissions || 0) + 1 })
        }).catch(function () { });

        // Show success
        var popup = overlayEl.querySelector(".banana-lead-popup");
        popup.innerHTML = [
          '<button class="banana-lead-close">&times;</button>',
          '<div class="banana-lead-success">',
          '  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
          '  <h3>' + (lp.thank_you_message || 'Obrigado pelo cadastro!') + '</h3>',
          '  <p>Você receberá nossas ofertas exclusivas em breve.</p>',
          '</div>'
        ].join("");
        popup.querySelector(".banana-lead-close").addEventListener("click", dismissPopup);

        if (lp.whatsapp_redirect) {
          setTimeout(function () { window.open(lp.whatsapp_redirect, "_blank"); }, 2000);
        }

        setTimeout(dismissPopup, 4000);
      }).catch(function () {
        btn.disabled = false;
        btn.textContent = "Participar";
      });
    });
  }

  function dismissPopup() {
    if (!overlayEl) return;
    overlayEl.classList.remove("open");
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setTimeout(function () {
      if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
      overlayEl = null;
    }, 300);
  }

  // Init
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fetchLandingPage);
  } else {
    fetchLandingPage();
  }
})();
