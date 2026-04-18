/**
 * Livete Anotador — Content Script (v1.4)
 * Estratégia: detecta diretamente as LINHAS de comentário em todo o DOM
 * (sem depender de um container único). Cada linha = link de username + texto.
 */

const SUPABASE_URL = "https://tqxhcyuxgqbzqwoidpie.supabase.co";
const BATCH_INTERVAL_MS = 3000;
const SCAN_INTERVAL_MS = 1500;
const MAX_BATCH_SIZE = 20;

const IG_RESERVED = new Set([
  "explore", "reels", "direct", "stories", "p", "accounts", "about",
  "developer", "legal", "privacy", "press", "api", "ads", "shop",
  "your_activity", "tv", "fragment", "challenge", "session"
]);

let eventId = null;
let sourcePC = null;
let pendingComments = [];
let batchTimer = null;
let scanTimer = null;
let seenHashes = new Set();
let stats = { total: 0, sent: 0, orders: 0, dupes: 0 };
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
  console.log("[Livete] 🔍 === DIAGNÓSTICO v1.4 ===");
  console.log("[Livete] URL:", location.href);

  const rows = findCommentRows();
  console.log("[Livete] Linhas de comentário encontradas:", rows.length);

  const samples = rows.slice(0, 10).map(r => `${r.username}: ${r.text.slice(0, 80)}`);
  samples.forEach(s => console.log("  •", s));

  if (rows.length === 0) {
    return { ok: false, reason: "Nenhum comentário detectado. Confirme que está na página da Live com comentários visíveis." };
  }
  return { ok: true, found: rows.length, sample: samples[0] };
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
  scanComments();
}

function stopCapture() {
  if (batchTimer) { clearInterval(batchTimer); batchTimer = null; }
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  flushBatch();
  console.log("[Livete] ⏹ Captura parada.");
  removeBanner();
}

// ─── Detecta TODAS as linhas de comentário no DOM ───
// Cada linha tem: link <a href="/username/"> + texto adjacente (o comentário)
function findCommentRows() {
  const rows = [];
  const seenInScan = new Set();

  // Pega todos os links de perfil do IG
  const allLinks = document.querySelectorAll('a[href^="/"]');

  for (const link of allLinks) {
    const href = link.getAttribute("href") || "";
    // Match /username/ ou /username (sem subpaths)
    const m = href.match(/^\/([A-Za-z0-9._]{2,30})\/?$/);
    if (!m) continue;

    const username = m[1];
    if (IG_RESERVED.has(username.toLowerCase())) continue;

    // Pula se o link não estiver visível (offsetParent = null)
    if (link.offsetParent === null) continue;

    // O texto do link costuma ser o próprio username
    const linkText = (link.innerText || link.textContent || "").trim();
    if (!linkText) continue;

    // Sobe até achar um ancestral que contenha texto ALÉM do username
    // (esse texto é o comentário). Limita a 6 níveis pra não pegar demais.
    let row = link.parentElement;
    let commentText = "";
    for (let depth = 0; depth < 6 && row; depth++) {
      const fullText = (row.innerText || row.textContent || "").replace(/\s+/g, " ").trim();
      if (!fullText) { row = row.parentElement; continue; }

      // Remove o username do início (case insensitive)
      let candidate = fullText;
      const lowerFull = candidate.toLowerCase();
      const lowerUser = username.toLowerCase();
      if (lowerFull.startsWith(lowerUser)) {
        candidate = candidate.slice(username.length).trim();
      }
      // Remove "Verificado", separadores, espaços
      candidate = candidate
        .replace(/^(Verificado|Verified)\s*/i, "")
        .replace(/^[·•\-:\s]+/, "")
        .replace(/\s+/g, " ")
        .trim();

      // Heurística: comentário válido tem 1+ chars, < 500, e não é só o username repetido
      if (candidate && candidate.length >= 1 && candidate.length <= 500
          && candidate.toLowerCase() !== lowerUser) {
        commentText = candidate;
        break;
      }
      row = row.parentElement;
    }

    if (!commentText) continue;

    // Dedup por scan (mesmo username pode aparecer várias vezes em diferentes nós)
    const key = `${username}|${commentText}`;
    if (seenInScan.has(key)) continue;
    seenInScan.add(key);

    const profilePic = row?.querySelector("img")?.src || null;
    rows.push({ username, text: commentText, profilePic, row });
  }

  return rows;
}

function scanComments() {
  scanCount++;
  const rows = findCommentRows();

  if (rows.length === 0) {
    if (scanCount % 5 === 0) {
      console.log(`[Livete] ⏳ Nenhum comentário detectado ainda... (scan #${scanCount})`);
    }
    return;
  }

  let foundThisScan = 0;
  for (const r of rows) {
    if (addComment(r.username, r.text, r.profilePic)) foundThisScan++;
  }

  if (foundThisScan > 0 || scanCount % 10 === 0) {
    console.log(`[Livete] 📊 Scan #${scanCount} — ${rows.length} visíveis, ${foundThisScan} novos | total: ${stats.total} | enviados: ${stats.sent}`);
  }
}

function addComment(username, text, profilePic) {
  const hash = simpleHash(`${username}|${text}`);
  if (seenHashes.has(hash)) return false;
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
  return true;
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
