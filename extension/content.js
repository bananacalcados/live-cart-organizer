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
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "START_CAPTURE") {
    eventId = msg.eventId;
    sourcePC = msg.sourcePC;
    stats = { total: 0, sent: 0, orders: 0, dupes: 0 };
    seenHashes.clear();
    startCapture();
  }
  if (msg.action === "STOP_CAPTURE") stopCapture();
  if (msg.action === "DIAGNOSE") {
    const result = runDiagnose();
    sendResponse(result);
    return true;
  }
});

function runDiagnose() {
  console.log("[Livete] 🔍 === DIAGNÓSTICO ===");
  console.log("[Livete] URL:", location.href);

  const input = findCommentInput();
  console.log("[Livete] Input encontrado?", !!input, input?.placeholder || input?.getAttribute("aria-label"));

  const list = findCommentList();
  if (!list) {
    console.warn("[Livete] ❌ Lista de comentários NÃO localizada.");
    return { ok: false, reason: "Lista de comentários não localizada. Você está na página da live?" };
  }
  console.log("[Livete] ✅ Container:", list);

  const links = list.querySelectorAll('a[href^="/"]');
  console.log("[Livete] Links no container:", links.length);

  const samples = [];
  for (const link of links) {
    const href = link.getAttribute("href") || "";
    const m = href.match(/^\/([A-Za-z0-9._]+)\/?$/);
    if (!m) continue;
    const username = m[1];
    if (["explore", "reels", "direct", "stories", "p"].includes(username)) continue;
    const row = link.closest("li") || link.parentElement?.parentElement || link.parentElement;
    const txt = (row?.innerText || "").replace(/\s+/g, " ").trim();
    if (txt) samples.push(`${username}: ${txt.slice(0, 80)}`);
  }
  console.log("[Livete] Amostras:", samples.slice(0, 10));

  return {
    ok: samples.length > 0,
    found: samples.length,
    sample: samples[0] || null,
    reason: samples.length === 0 ? "Container achado mas sem comentários extraíveis. Veja Console." : null,
  };
}

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

// ─── Localiza o input de comentário (mais tolerante) ───
function findCommentInput() {
  // Tenta vários atributos: placeholder, aria-label, contenteditable
  const selectors = [
    'textarea[placeholder*="dicione" i]',
    'textarea[placeholder*="omentário" i]',
    'textarea[placeholder*="omment" i]',
    'input[placeholder*="dicione" i]',
    'input[placeholder*="omentário" i]',
    'textarea[aria-label*="omentário" i]',
    'textarea[aria-label*="omment" i]',
    'div[contenteditable="true"][aria-label*="omentário" i]',
    'div[contenteditable="true"][aria-label*="omment" i]',
    'div[role="textbox"][aria-label*="omentário" i]',
    'div[role="textbox"]',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  // Última tentativa: qualquer textarea visível na página
  const tas = document.querySelectorAll("textarea");
  for (const ta of tas) {
    if (ta.offsetParent !== null) return ta;
  }
  return null;
}

// ─── Localiza o container da lista de comentários ───
function findCommentList() {
  if (commentListEl && document.body.contains(commentListEl)) return commentListEl;

  // Estratégia 1: ancora pelo input de comentário
  const input = findCommentInput();
  if (input) {
    let el = input.parentElement;
    for (let i = 0; i < 15 && el; i++) {
      const userLinks = el.querySelectorAll('a[role="link"][href^="/"], a[href^="/"]');
      if (userLinks.length >= 2) {
        commentListEl = el;
        console.log("[Livete] ✅ Lista localizada via input. Links:", userLinks.length);
        return el;
      }
      el = el.parentElement;
    }
  }

  // Estratégia 2: heurística — procura container com vários links curtos de username
  const candidates = document.querySelectorAll('ul, div');
  let best = null;
  let bestScore = 0;
  for (const c of candidates) {
    const links = c.querySelectorAll('a[href^="/"]');
    if (links.length < 3 || links.length > 60) continue;
    let score = 0;
    for (const a of links) {
      const h = a.getAttribute("href") || "";
      if (/^\/[A-Za-z0-9._]{2,30}\/?$/.test(h)) score++;
    }
    // Container precisa ter texto também (não só links)
    const txtLen = (c.innerText || "").length;
    if (score >= 3 && txtLen > 50 && txtLen < 5000 && score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  if (best) {
    commentListEl = best;
    console.log("[Livete] ✅ Lista localizada via heurística. Score:", bestScore);
    return best;
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
