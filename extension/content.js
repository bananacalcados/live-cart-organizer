/**
 * Livete Anotador — Content Script (v1.1)
 * Estratégia robusta: localiza o container da lista de comentários da Live
 * ancorando pelo input "Adicione um comentário" e faz polling a cada 1.5s.
 */

const SUPABASE_URL = "https://tqxhcyuxgqbzqwoidpie.supabase.co";
const BATCH_INTERVAL_MS = 3000;
const SCAN_INTERVAL_MS = 1500;
const MAX_BATCH_SIZE = 20;

let eventId = null;
let sourcePC = null;
let pendingComments = [];
let batchTimer = null;
let scanTimer = null;
let seenHashes = new Set();
let stats = { total: 0, sent: 0, orders: 0, dupes: 0 };
let commentListEl = null;
let scanCount = 0;

// ─── Listener do popup ───
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "START_CAPTURE") {
    eventId = msg.eventId;
    sourcePC = msg.sourcePC;
    stats = { total: 0, sent: 0, orders: 0, dupes: 0 };
    seenHashes.clear();
    startCapture();
  }
  if (msg.action === "STOP_CAPTURE") stopCapture();
});

// Auto-start em refresh
chrome.storage.local.get(["isRunning", "eventId", "pcName", "pcNumber"], (data) => {
  if (data.isRunning && data.eventId) {
    eventId = data.eventId;
    sourcePC = `${data.pcNumber || "PC1"}-${data.pcName || "PC"}`;
    stats = { total: 0, sent: 0, orders: 0, dupes: 0 };
    setTimeout(() => startCapture(), 2500);
  }
});

function startCapture() {
  stopCapture();
  console.log("[Livete] 🟢 Captura iniciada — evento:", eventId);
  injectBanner("🟢 Livete capturando...");

  batchTimer = setInterval(flushBatch, BATCH_INTERVAL_MS);
  scanTimer = setInterval(scanComments, SCAN_INTERVAL_MS);
  scanComments(); // primeira varredura imediata
}

function stopCapture() {
  if (batchTimer) { clearInterval(batchTimer); batchTimer = null; }
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  flushBatch();
  commentListEl = null;
  console.log("[Livete] ⏹ Captura parada.");
  removeBanner();
}

// ─── Localiza o container da lista de comentários ───
function findCommentList() {
  if (commentListEl && document.body.contains(commentListEl)) return commentListEl;

  // Estratégia 1: ancora pelo textarea/input "Adicione um comentário"
  const input = document.querySelector(
    'textarea[placeholder*="omentário" i], textarea[placeholder*="omment" i], input[placeholder*="omentário" i]'
  );
  if (input) {
    // Sobe na árvore procurando um ancestral que tenha vários links de perfil (a[href^="/"])
    let el = input.parentElement;
    for (let i = 0; i < 12 && el; i++) {
      const userLinks = el.querySelectorAll('a[role="link"][href^="/"], a[href^="/"]');
      if (userLinks.length >= 2) {
        commentListEl = el;
        console.log("[Livete] ✅ Lista de comentários localizada via input. Links:", userLinks.length);
        return el;
      }
      el = el.parentElement;
    }
  }

  // Estratégia 2: fallback — procura ul/div com vários a[href^="/"] curtinhos (usernames)
  const candidates = document.querySelectorAll('ul, div[class]');
  for (const c of candidates) {
    const links = c.querySelectorAll(':scope > * a[href^="/"]');
    if (links.length >= 3 && links.length < 80) {
      const allShort = Array.from(links).every(a => {
        const h = a.getAttribute("href") || "";
        return /^\/[A-Za-z0-9._]+\/?$/.test(h);
      });
      if (allShort) {
        commentListEl = c;
        console.log("[Livete] ✅ Lista localizada via heurística. Links:", links.length);
        return c;
      }
    }
  }

  return null;
}

// ─── Varre os comentários ───
function scanComments() {
  scanCount++;
  const list = findCommentList();

  if (!list) {
    if (scanCount % 5 === 0) {
      console.log("[Livete] ⏳ Procurando lista de comentários... (scan #" + scanCount + ")");
    }
    return;
  }

  // Pega todos os links de perfil dentro da lista
  const links = list.querySelectorAll('a[href^="/"]');
  let foundThisScan = 0;

  for (const link of links) {
    const href = link.getAttribute("href") || "";
    const match = href.match(/^\/([A-Za-z0-9._]+)\/?$/);
    if (!match) continue;
    const username = match[1];
    if (username.length < 2 || ["explore", "reels", "direct", "stories", "p"].includes(username)) continue;

    // O comentário fica no MESMO container do link. Sobe pra achar o "row"
    let row = link.closest("li") || link.parentElement?.parentElement || link.parentElement;
    if (!row) continue;

    const fullText = (row.innerText || row.textContent || "").trim();
    if (!fullText) continue;

    // Remove o username do começo para isolar o comentário
    let commentText = fullText;
    if (commentText.toLowerCase().startsWith(username.toLowerCase())) {
      commentText = commentText.slice(username.length).trim();
    }
    // Limpa "Verificado", "·", quebras
    commentText = commentText
      .replace(/^(Verificado|Verified)\s*/i, "")
      .replace(/^[·•\-:\s]+/, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!commentText || commentText.length < 1 || commentText.length > 500) continue;
    if (commentText.toLowerCase() === username.toLowerCase()) continue;

    const profilePic = row.querySelector("img")?.src || null;
    addComment(username, commentText, profilePic);
    foundThisScan++;
  }

  if (scanCount % 10 === 0) {
    console.log(`[Livete] 📊 Scan #${scanCount} — ${foundThisScan} novos | total: ${stats.total} | enviados: ${stats.sent}`);
  }
}

function addComment(username, text, profilePic) {
  const hash = simpleHash(`${username}|${text}`);
  if (seenHashes.has(hash)) return;
  seenHashes.add(hash);

  stats.total++;
  updateStats();
  console.log(`[Livete] 💬 ${username}: ${text}`);

  pendingComments.push({
    event_id: eventId,
    username,
    comment_text: text,
    profile_pic_url: profilePic,
    timestamp: new Date().toISOString(),
    source_pc: sourcePC,
  });

  if (pendingComments.length >= MAX_BATCH_SIZE) flushBatch();
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
      console.error("[Livete] ❌ HTTP", res.status, await res.text());
      pendingComments.unshift(...batch);
      return;
    }
    const data = await res.json();
    console.log("[Livete] ✅ Lote enviado:", batch.length, "→", data);
    if (data.results) {
      for (const r of data.results) {
        if (r.status === "inserted") { stats.sent++; if (r.is_order) stats.orders++; }
        if (r.status === "duplicate") stats.dupes++;
      }
      updateStats();
    }
  } catch (err) {
    console.error("[Livete] ❌ Rede:", err.message);
    pendingComments.unshift(...batch);
  }
}

function updateStats() { chrome.storage.local.set({ stats }); }

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; }
  return h.toString(36);
}

function injectBanner(text) {
  removeBanner();
  const b = document.createElement("div");
  b.id = "livete-banner";
  b.style.cssText = `position:fixed;top:8px;right:8px;z-index:999999;background:rgba(0,0,0,.85);color:#4ade80;padding:6px 14px;border-radius:20px;font:600 12px -apple-system,sans-serif;pointer-events:none;backdrop-filter:blur(8px);border:1px solid rgba(74,222,128,.3);`;
  b.textContent = text;
  document.body.appendChild(b);
}
function removeBanner() { document.getElementById("livete-banner")?.remove(); }
