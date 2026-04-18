const $ = (id) => document.getElementById(id);

// Load saved config
chrome.storage.local.get(["eventId", "pcName", "pcNumber", "isRunning", "stats"], (data) => {
  if (data.eventId) $("event-id").value = data.eventId;
  if (data.pcName) $("pc-name").value = data.pcName;
  if (data.pcNumber) $("pc-number").value = data.pcNumber;
  updateUI(data.isRunning || false, data.stats);
});

// Listen for stats updates
chrome.storage.onChanged.addListener((changes) => {
  if (changes.stats) updateStats(changes.stats.newValue);
  if (changes.isRunning) {
    const running = changes.isRunning.newValue;
    $("btn-start").style.display = running ? "none" : "block";
    $("btn-stop").style.display = running ? "block" : "none";
    setStatus(running ? "active" : "inactive", running ? "🟢 Capturando comentários..." : "⏸ Captura pausada");
  }
});

$("btn-start").addEventListener("click", async () => {
  const eventId = $("event-id").value.trim();
  const pcName = $("pc-name").value.trim() || "PC";
  const pcNumber = $("pc-number").value;

  if (!eventId) {
    setStatus("error", "❌ Cole o código do evento!");
    return;
  }

  // Save config
  await chrome.storage.local.set({
    eventId,
    pcName,
    pcNumber,
    isRunning: true,
    stats: { total: 0, sent: 0, orders: 0, dupes: 0 }
  });

  // Send message to content script on active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes("instagram.com")) {
    setStatus("error", "❌ Abra a live do Instagram primeiro!");
    await chrome.storage.local.set({ isRunning: false });
    return;
  }

  chrome.tabs.sendMessage(tab.id, {
    action: "START_CAPTURE",
    eventId,
    sourcePC: `${pcNumber}-${pcName}`
  });

  updateUI(true, { total: 0, sent: 0, orders: 0, dupes: 0 });
});

$("btn-stop").addEventListener("click", async () => {
  await chrome.storage.local.set({ isRunning: false });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.sendMessage(tab.id, { action: "STOP_CAPTURE" });
  updateUI(false);
});

$("btn-test").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes("instagram.com")) {
    setStatus("error", "❌ Abra a live do Instagram primeiro!");
    return;
  }
  setStatus("inactive", "🔍 Testando... abra o Console (F12) na aba do IG.");
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { action: "DIAGNOSE" });
    if (response?.ok) {
      setStatus("active", `✅ ${response.found} comentários detectados! Ex: "${response.sample || "—"}"`);
    } else {
      setStatus("error", `❌ ${response?.reason || "Não localizou a lista. Veja o Console (F12)."}`);
    }
  } catch (e) {
    setStatus("error", "❌ Content script não carregou. Recarregue a página da live (F5) e tente de novo.");
  }
});

function updateUI(running, stats) {
  $("btn-start").style.display = running ? "none" : "block";
  $("btn-stop").style.display = running ? "block" : "none";
  $("stats").style.display = running ? "flex" : "none";
  setStatus(
    running ? "active" : "inactive",
    running ? "🟢 Capturando comentários..." : "⏸ Parado"
  );
  if (stats) updateStats(stats);
}

function updateStats(s) {
  if (!s) return;
  $("stat-total").textContent = s.total || 0;
  $("stat-sent").textContent = s.sent || 0;
  $("stat-orders").textContent = s.orders || 0;
  $("stat-dupes").textContent = s.dupes || 0;
  $("stats").style.display = "flex";
}

function setStatus(type, msg) {
  const el = $("status");
  el.className = `status ${type}`;
  el.textContent = msg;
}
