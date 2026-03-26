/**
 * Livete Anotador — Content Script
 * Observes Instagram Live comments via MutationObserver and sends them to the backend.
 */

const SUPABASE_URL = "https://tqxhcyuxgqbzqwoidpie.supabase.co";
const BATCH_INTERVAL_MS = 3000; // Send batch every 3 seconds
const MAX_BATCH_SIZE = 20;

let observer = null;
let eventId = null;
let sourcePC = null;
let pendingComments = [];
let batchTimer = null;
let seenHashes = new Set();
let stats = { total: 0, sent: 0, orders: 0, dupes: 0 };

// ─── Message listener from popup ───
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "START_CAPTURE") {
    eventId = msg.eventId;
    sourcePC = msg.sourcePC;
    stats = { total: 0, sent: 0, orders: 0, dupes: 0 };
    seenHashes.clear();
    startCapture();
  }
  if (msg.action === "STOP_CAPTURE") {
    stopCapture();
  }
});

// Also auto-start if was running (e.g. page refresh)
chrome.storage.local.get(["isRunning", "eventId", "pcName", "pcNumber"], (data) => {
  if (data.isRunning && data.eventId) {
    eventId = data.eventId;
    sourcePC = `${data.pcNumber || "PC1"}-${data.pcName || "PC"}`;
    stats = { total: 0, sent: 0, orders: 0, dupes: 0 };
    setTimeout(() => startCapture(), 2000); // Wait for IG to load
  }
});

function startCapture() {
  stopCapture(); // Clean any previous observer

  console.log("[Livete] 🟢 Iniciando captura para evento:", eventId);
  injectBanner("🟢 Livete capturando...");

  // Start batch sender
  batchTimer = setInterval(flushBatch, BATCH_INTERVAL_MS);

  // Strategy: observe the whole page and filter comment-like elements
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        processNode(node);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Also scan existing comments on the page
  scanExistingComments();
}

function stopCapture() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (batchTimer) {
    clearInterval(batchTimer);
    batchTimer = null;
  }
  flushBatch(); // Send remaining
  console.log("[Livete] ⏹ Captura parada.");
  removeBanner();
}

function processNode(el) {
  // Instagram Live comments are typically in elements with specific patterns
  // We look for comment containers with username + text
  const commentElements = findCommentElements(el);
  for (const comment of commentElements) {
    addComment(comment.username, comment.text, comment.profilePic);
  }
}

function findCommentElements(el) {
  const results = [];

  // Strategy 1: Look for typical IG live comment structure
  // Comments usually have a username (bold/link) followed by text
  const spans = el.querySelectorAll ? el.querySelectorAll("span") : [];

  // Strategy 2: Check if the element itself is a comment container
  // IG Live uses various selectors, we try multiple approaches
  
  // Approach A: Find elements that look like "username  comment text"
  const allTexts = el.querySelectorAll ? el.querySelectorAll('[dir="auto"]') : [];
  
  // Approach B: Look for the comment list container patterns
  // Instagram live comments typically appear in a scrollable list
  // Each comment has: profile pic (optional), username (bold), message text
  
  try {
    // Try to find comment items by their structure
    const commentContainers = el.querySelectorAll 
      ? el.querySelectorAll('div[role="button"], li, div[class*="comment"], div[class*="Comment"]')
      : [];
    
    for (const container of commentContainers) {
      const extracted = extractCommentFromContainer(container);
      if (extracted) results.push(extracted);
    }

    // Also check the element itself
    const selfExtracted = extractCommentFromContainer(el);
    if (selfExtracted) results.push(selfExtracted);
  } catch (e) {
    // Silently ignore extraction errors
  }

  return results;
}

function extractCommentFromContainer(container) {
  if (!container || !container.textContent) return null;
  
  const text = container.textContent.trim();
  if (!text || text.length < 2 || text.length > 500) return null;
  
  // Skip navigation elements, buttons, etc.
  const tag = container.tagName?.toLowerCase();
  if (["nav", "header", "button", "svg", "img"].includes(tag)) return null;
  
  // Look for username pattern: first bold/link element, rest is comment
  const userEl = container.querySelector("a span, h2, h3, span[style*='font-weight'], strong, b");
  if (!userEl) return null;
  
  const username = userEl.textContent.trim();
  if (!username || username.length < 2 || username.length > 50) return null;
  
  // Comment text = full text minus username
  let commentText = text.replace(username, "").trim();
  
  // Remove common IG artifacts
  commentText = commentText.replace(/^[·•\-:\s]+/, "").trim();
  
  if (!commentText || commentText.length < 1) return null;
  
  // Skip if it looks like UI text, not a comment
  const uiTexts = ["seguir", "follow", "curtir", "like", "enviar", "send", "comentar"];
  if (uiTexts.some(ui => commentText.toLowerCase() === ui)) return null;
  
  // Profile pic
  const imgEl = container.querySelector("img");
  const profilePic = imgEl?.src || null;
  
  return { username, text: commentText, profilePic };
}

function scanExistingComments() {
  console.log("[Livete] Scanning existing comments...");
  // Scan the page for existing comment elements
  const containers = document.querySelectorAll('div[role="button"], li, [dir="auto"]');
  let found = 0;
  for (const el of containers) {
    const extracted = extractCommentFromContainer(el);
    if (extracted) {
      addComment(extracted.username, extracted.text, extracted.profilePic);
      found++;
    }
  }
  console.log(`[Livete] Found ${found} existing comments`);
}

function addComment(username, text, profilePic) {
  // Local dedup using hash
  const hash = simpleHash(`${username}|${text}`);
  if (seenHashes.has(hash)) return;
  seenHashes.add(hash);

  stats.total++;
  updateStats();

  pendingComments.push({
    event_id: eventId,
    username: username,
    comment_text: text,
    profile_pic_url: profilePic,
    timestamp: new Date().toISOString(),
    source_pc: sourcePC,
  });

  // Auto-flush if batch is full
  if (pendingComments.length >= MAX_BATCH_SIZE) {
    flushBatch();
  }
}

async function flushBatch() {
  if (!pendingComments.length) return;

  const batch = pendingComments.splice(0, MAX_BATCH_SIZE);

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/live-process-comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch),
    });

    if (!res.ok) {
      console.error("[Livete] ❌ Erro ao enviar:", res.status);
      return;
    }

    const data = await res.json();
    if (data.results) {
      for (const r of data.results) {
        if (r.status === "inserted") {
          stats.sent++;
          if (r.is_order) stats.orders++;
        }
        if (r.status === "duplicate") stats.dupes++;
      }
      updateStats();
    }
  } catch (err) {
    console.error("[Livete] ❌ Erro de rede:", err.message);
    // Put back in queue
    pendingComments.unshift(...batch);
  }
}

function updateStats() {
  chrome.storage.local.set({ stats });
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(36);
}

// ─── Visual banner overlay ───
function injectBanner(text) {
  removeBanner();
  const banner = document.createElement("div");
  banner.id = "livete-banner";
  banner.style.cssText = `
    position: fixed; top: 8px; right: 8px; z-index: 999999;
    background: rgba(0,0,0,0.85); color: #4ade80;
    padding: 6px 14px; border-radius: 20px;
    font: 600 12px -apple-system, sans-serif;
    pointer-events: none; backdrop-filter: blur(8px);
    border: 1px solid rgba(74,222,128,0.3);
  `;
  banner.textContent = text;
  document.body.appendChild(banner);
}

function removeBanner() {
  document.getElementById("livete-banner")?.remove();
}
