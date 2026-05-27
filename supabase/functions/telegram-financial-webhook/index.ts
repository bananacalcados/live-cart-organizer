// Telegram Financial Agent — webhook receiver
// Stage 3a: whitelist + /start invite token + audit. Attachment processing comes next.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-telegram-bot-api-secret-token",
};

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function deriveWebhookSecret(token: string): Promise<string> {
  const data = new TextEncoder().encode(`telegram-financial:${token}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function safeEqual(a: string | null, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sendMessage(chatId: number, text: string, extra: Record<string, unknown> = {}) {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, parse_mode: "HTML", ...extra, text }),
  });
  if (!res.ok) console.error("[telegram] sendMessage failed", res.status, await res.text());
}

// ---------- Conversational AI ----------
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const AI_MODEL = "google/gemini-3-flash-preview";

function brDateRange(period: string): { from: string; to: string; label: string } {
  // Computa datas em America/Sao_Paulo
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
  const todayBR = fmt.format(now); // YYYY-MM-DD
  const d = new Date(todayBR + "T00:00:00-03:00");
  const addDays = (base: Date, n: number) => new Date(base.getTime() + n * 86400000).toISOString().slice(0, 10);
  switch (period) {
    case "yesterday": { const y = addDays(d, -1); return { from: y, to: y, label: "ontem" }; }
    case "7d": return { from: addDays(d, -6), to: todayBR, label: "últimos 7 dias" };
    case "30d": return { from: addDays(d, -29), to: todayBR, label: "últimos 30 dias" };
    case "month": { const first = todayBR.slice(0, 8) + "01"; return { from: first, to: todayBR, label: "mês atual" }; }
    case "today":
    default: return { from: todayBR, to: todayBR, label: "hoje" };
  }
}

// Mesmas regras do POS Dashboard / Management
const POS_REVENUE_STATUSES = ["completed", "paid", "pending_sync", "pending_pickup"];
const TINY_APPROVED_STATUSES = ["Faturado", "Aprovado", "Preparando envio", "Pronto para envio", "Enviado", "Entregue", "Não entregue"];
const CENTRO_ID = "4ade7b44-5043-4ab1-a124-7a6ab5468e29";
const PEROLA_ID = "1c08a9d8-fc12-4657-8ecf-d442f0c0e9f2";
const PHYSICAL_STORE_IDS = [CENTRO_ID, PEROLA_ID];

const tools = [
  {
    type: "function",
    function: {
      name: "get_sales_summary",
      description: "Faturamento, qtd vendas e ticket médio por período e canal. 'pos' = lojas físicas (pos_sales). 'online' = Shopify/Tiny (tiny_synced_orders). 'all' = soma os dois (padrão). Replica regra do dashboard.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: ["today", "yesterday", "7d", "30d", "month"] },
          channel: { type: "string", enum: ["all", "pos", "online"], description: "Default 'all'" },
          store_id: { type: "string", description: "(opcional) UUID da loja física para filtrar canal POS" },
        },
        required: ["period"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_cash_position",
      description: "Posição de caixa: saldo bancário total + entradas/saídas do fluxo confirmadas hoje.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_top_products",
      description: "Top produtos mais vendidos por receita em um período (apenas POS físico).",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: ["today", "yesterday", "7d", "30d", "month"] },
          limit: { type: "number", description: "Default 5" },
        },
        required: ["period"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_recent_expenses",
      description: "Lista lançamentos de saída do fluxo de caixa (mais recentes).",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: ["today", "yesterday", "7d", "30d", "month"] },
          limit: { type: "number", description: "Default 10" },
        },
        required: ["period"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_stores",
      description: "Lista lojas físicas (id + nome). Use quando o usuário citar uma loja por nome.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_pending_crediario",
      description: "Resumo de crediário pendente (a receber): qtd + valor total.",
      parameters: { type: "object", properties: {} },
    },
  },
];

async function fetchPosSales(supabase: any, fromISO: string, toISO: string, storeId?: string): Promise<any[]> {
  const stores = storeId ? [storeId] : PHYSICAL_STORE_IDS;
  const select = "id, store_id, total, paid_at, created_at, status, sale_type, revenue_attribution, event_id";
  // paid_at no range
  const a = await supabase.from("pos_sales").select(select)
    .in("status", POS_REVENUE_STATUSES).in("store_id", stores)
    .not("paid_at", "is", null).gte("paid_at", fromISO).lte("paid_at", toISO).limit(5000);
  // paid_at NULL + created_at no range
  const b = await supabase.from("pos_sales").select(select)
    .in("status", POS_REVENUE_STATUSES).in("store_id", stores)
    .is("paid_at", null).gte("created_at", fromISO).lte("created_at", toISO).limit(5000);
  const seen = new Set<string>();
  const merged: any[] = [];
  for (const r of [...(a.data || []), ...(b.data || [])]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    if (r.revenue_attribution === "site_pickup_only") continue;
    merged.push(r);
  }
  return merged;
}

async function fetchTinyOrders(supabase: any, fromDate: string, toDate: string): Promise<any[]> {
  const { data } = await supabase.from("tiny_synced_orders")
    .select("id, store_id, total, order_date, status, payment_method")
    .gte("order_date", fromDate).lte("order_date", toDate)
    .in("status", TINY_APPROVED_STATUSES).limit(5000);
  return data || [];
}

async function runTool(supabase: any, name: string, args: any): Promise<unknown> {
  if (name === "get_sales_summary") {
    const { from, to, label } = brDateRange(args.period);
    const fromISO = `${from}T03:00:00Z`;
    const toISO = `${to}T26:59:59Z`;
    const channel: "all" | "pos" | "online" = args.channel || "all";

    let posTotal = 0, posCount = 0, onlineTotal = 0, onlineCount = 0;
    if (channel === "all" || channel === "pos") {
      const pos = await fetchPosSales(supabase, fromISO, toISO, args.store_id);
      posTotal = pos.reduce((s, r) => s + Number(r.total || 0), 0);
      posCount = pos.length;
    }
    if ((channel === "all" || channel === "online") && !args.store_id) {
      const tiny = await fetchTinyOrders(supabase, from, to);
      onlineTotal = tiny.reduce((s: number, r: any) => s + Number(r.total || 0), 0);
      onlineCount = tiny.length;
    }
    const total = posTotal + onlineTotal;
    const count = posCount + onlineCount;
    return {
      periodo: label,
      canal: channel,
      faturamento_total_brl: total,
      qtd_vendas: count,
      ticket_medio_brl: count ? total / count : 0,
      detalhe: {
        pos_fisico: { faturamento_brl: posTotal, qtd: posCount },
        online_shopify_tiny: { faturamento_brl: onlineTotal, qtd: onlineCount },
      },
      regra: "POS: status in (completed,paid,pending_sync,pending_pickup), filtra por paid_at OU created_at quando paid_at é null, exclui revenue_attribution='site_pickup_only', apenas lojas físicas (Centro+Pérola). Online: tiny_synced_orders com status aprovado.",
    };
  }
  if (name === "get_cash_position") {
    const { data: banks } = await supabase.from("bank_accounts").select("name, balance").eq("is_active", true);
    const saldoBanco = (banks || []).reduce((s: number, b: any) => s + Number(b.balance || 0), 0);
    const today = brDateRange("today").from;
    const { data: flow } = await supabase.from("cash_flow_entries").select("direction, amount").eq("entry_date", today).in("status", ["confirmed", "reconciled"]);
    const entradas = (flow || []).filter((e: any) => e.direction === "in").reduce((s: number, e: any) => s + Number(e.amount), 0);
    const saidas = (flow || []).filter((e: any) => e.direction === "out").reduce((s: number, e: any) => s + Number(e.amount), 0);
    return { saldo_bancos_brl: saldoBanco, contas: banks, entradas_hoje_brl: entradas, saidas_hoje_brl: saidas, liquido_hoje_brl: entradas - saidas };
  }
  if (name === "get_top_products") {
    const { from, to, label } = brDateRange(args.period);
    const fromISO = `${from}T03:00:00Z`;
    const toISO = `${to}T26:59:59Z`;
    const limit = args.limit ?? 5;
    const sales = await fetchPosSales(supabase, fromISO, toISO);
    const saleIds = sales.map((s) => s.id);
    if (saleIds.length === 0) return { period: label, top: [] };
    // Chunk in 500s to avoid URL length issues
    const all: any[] = [];
    for (let i = 0; i < saleIds.length; i += 500) {
      const chunk = saleIds.slice(i, i + 500);
      const { data } = await supabase.from("pos_sale_items")
        .select("product_name, quantity, total_price").in("sale_id", chunk);
      all.push(...(data || []));
    }
    const agg = new Map<string, { qtd: number; receita: number }>();
    for (const it of all) {
      const k = it.product_name || "?";
      const cur = agg.get(k) || { qtd: 0, receita: 0 };
      cur.qtd += Number(it.quantity || 0);
      cur.receita += Number(it.total_price || 0);
      agg.set(k, cur);
    }
    const top = [...agg.entries()].map(([nome, v]) => ({ nome, ...v })).sort((a, b) => b.receita - a.receita).slice(0, limit);
    return { period: label, top };
  }
  if (name === "list_recent_expenses") {
    const { from, to, label } = brDateRange(args.period);
    const { data, error } = await supabase
      .from("cash_flow_entries")
      .select("entry_date, amount, description, payment_method, category:financial_categories(name)")
      .eq("direction", "out").gte("entry_date", from).lte("entry_date", to)
      .order("entry_datetime", { ascending: false }).limit(args.limit ?? 10);
    if (error) return { error: error.message };
    return { period: label, lancamentos: data };
  }
  if (name === "list_stores") {
    const { data } = await supabase.from("pos_stores").select("id, name").order("name");
    return { lojas: data };
  }
  if (name === "get_pending_crediario") {
    const { data, error } = await supabase
      .from("pos_sales").select("total")
      .eq("status", "completed").eq("crediario_status", "pending").not("crediario_due_date", "is", null);
    if (error) return { error: error.message };
    const total = (data || []).reduce((s: number, r: any) => s + Number(r.total || 0), 0);
    return { qtd: data?.length || 0, valor_total_brl: total };
  }
  return { error: `tool desconhecida: ${name}` };
}

async function handleConversation(supabase: any, chatId: number, userText: string): Promise<string> {
  // Carrega histórico
  const { data: sess } = await supabase.from("financial_agent_sessions").select("state").eq("chat_id", chatId).maybeSingle();
  const history: any[] = (sess?.state?.messages as any[]) || [];

  const system = {
    role: "system",
    content: [
      "Você é o assistente financeiro da Banana Calçados no Telegram.",
      "Tom: direto ao ponto, no máximo 4 linhas, 1-2 emojis no máximo. Sem rodeios.",
      "Use as ferramentas para responder com dados reais — nunca invente números.",
      "Formate valores em BRL (R$ 1.234,56). Datas em pt-BR.",
      "Se faltar contexto (ex: qual loja), pergunte 1 coisa só.",
    ].join(" "),
  };

  const messages: any[] = [system, ...history.slice(-12), { role: "user", content: userText }];

  for (let step = 0; step < 5; step++) {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({ model: AI_MODEL, messages, tools, tool_choice: "auto" }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error("[ai] gateway error", res.status, t);
      if (res.status === 429) return "⚠️ Muitas requisições ao agente. Tenta de novo em 1 min.";
      if (res.status === 402) return "⚠️ Créditos de IA esgotados. Adicione créditos no workspace.";
      throw new Error(`gateway ${res.status}`);
    }
    const json = await res.json();
    const choice = json.choices?.[0];
    const message = choice?.message;
    if (!message) throw new Error("sem mensagem da IA");
    messages.push(message);

    const toolCalls = message.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      const final = message.content || "(vazio)";
      const newHistory = [...history, { role: "user", content: userText }, { role: "assistant", content: final }].slice(-20);
      await supabase.from("financial_agent_sessions").upsert({ chat_id: chatId, state: { messages: newHistory }, updated_at: new Date().toISOString() });
      return final;
    }

    for (const tc of toolCalls) {
      let args: any = {};
      try { args = JSON.parse(tc.function?.arguments || "{}"); } catch {}
      console.log("[ai] tool", tc.function?.name, args);
      const result = await runTool(supabase, tc.function?.name, args);
      messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
    }
  }
  return "⚠️ Não consegui concluir após várias tentativas.";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const expected = await deriveWebhookSecret(TELEGRAM_BOT_TOKEN);
  const got = req.headers.get("x-telegram-bot-api-secret-token");
  if (!safeEqual(got, expected)) {
    console.warn("[telegram] invalid secret token");
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const update = await req.json();
  const msg = update.message ?? update.edited_message;
  const chatId: number | undefined = msg?.chat?.id;
  if (!chatId) return new Response(JSON.stringify({ ok: true, ignored: true }));

  const text: string = (msg.text ?? msg.caption ?? "").trim();
  const fromName = `${msg.from?.first_name ?? ""} ${msg.from?.last_name ?? ""}`.trim() || msg.from?.username || "?";

  // Audit incoming
  await supabase.from("financial_agent_audit").insert({
    chat_id: String(chatId),
    direction: "in",
    action: msg.photo ? "photo" : msg.document ? "document" : msg.voice ? "voice" : "text",
    message: text || null,
    metadata: { from: fromName, message_id: msg.message_id },
  });

  // Whitelist check
  const { data: authUser } = await supabase
    .from("financial_agent_authorized_users")
    .select("chat_id, display_name, active")
    .eq("chat_id", String(chatId))
    .eq("active", true)
    .maybeSingle();

  // /start <token> — onboarding
  if (text.startsWith("/start")) {
    const parts = text.split(/\s+/);
    const token = parts[1];
    if (authUser) {
      await sendMessage(chatId, `✅ Você já está autorizado, ${authUser.display_name}. Envie comprovantes, extratos (XLSX/OFX/CSV) ou /help.`);
      return new Response(JSON.stringify({ ok: true }));
    }
    if (!token) {
      await sendMessage(chatId, "🔒 Acesso restrito. Use <code>/start &lt;token&gt;</code> com um token de convite gerado no painel.");
      return new Response(JSON.stringify({ ok: true }));
    }
    const { data: invite, error: invErr } = await supabase
      .from("financial_agent_invite_tokens")
      .select("token, expires_at, used_at")
      .eq("token", token)
      .maybeSingle();
    console.log("[telegram] /start token lookup", JSON.stringify({ token, invite, invErr }));
    if (!invite || invite.used_at || new Date(invite.expires_at).getTime() < Date.now()) {
      await sendMessage(chatId, "❌ Token inválido ou expirado. Gere um novo no painel.");
      return new Response(JSON.stringify({ ok: true }));
    }
    await supabase.from("financial_agent_authorized_users").insert({
      chat_id: String(chatId),
      display_name: fromName,
      role: "admin",
      active: true,
    });
    await supabase.from("financial_agent_invite_tokens").update({
      used_at: new Date().toISOString(),
      used_by_chat_id: String(chatId),
    }).eq("token", invite.token);
    await sendMessage(chatId, `✅ Cadastrado, ${fromName}! Pode mandar comprovantes/extratos a qualquer momento.`);
    return new Response(JSON.stringify({ ok: true }));
  }

  if (!authUser) {
    await sendMessage(chatId, "🔒 Acesso negado. Solicite um token de convite ao administrador.");
    return new Response(JSON.stringify({ ok: true }));
  }

  // Help
  if (text === "/help") {
    await sendMessage(chatId,
      "<b>Agente Financeiro</b>\n" +
      "• Pergunte: <i>quanto vendi hoje?</i>, <i>quanto tenho em caixa?</i>, <i>top produtos da semana</i>\n" +
      "• Envie foto/PDF de comprovante → categorizo e lanço\n" +
      "• Envie XLSX/OFX/CSV → importo e concilio\n" +
      "• /pendentes — lançamentos aguardando revisão\n" +
      "• /resumo — fluxo de caixa do dia\n" +
      "• /reset — limpa o histórico da conversa",
    );
    return new Response(JSON.stringify({ ok: true }));
  }

  if (text === "/reset") {
    await supabase.from("financial_agent_sessions").upsert({ chat_id: chatId, state: {}, expected_action: null });
    await sendMessage(chatId, "🧹 Histórico limpo.");
    return new Response(JSON.stringify({ ok: true }));
  }

  // Processa anexos via função dedicada (fire-and-forget)
  let fileId: string | null = null;
  let kind: string | null = null;
  if (msg.photo && Array.isArray(msg.photo) && msg.photo.length > 0) {
    fileId = msg.photo[msg.photo.length - 1].file_id; // maior resolução
    kind = "photo";
  } else if (msg.document) {
    fileId = msg.document.file_id;
    kind = "document";
  }

  if (fileId) {
    fetch(`${SUPABASE_URL}/functions/v1/telegram-financial-process-attachment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ chat_id: chatId, message_id: msg.message_id, file_id: fileId, kind }),
    }).catch((e) => console.error("[webhook] process-attachment dispatch failed", e));
    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Conversa livre: deixa a IA responder com ferramentas financeiras
  if (text) {
    // typing indicator
    fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    }).catch(() => {});

    try {
      const reply = await handleConversation(supabase, chatId, text);
      await sendMessage(chatId, reply || "(sem resposta)");
    } catch (e) {
      console.error("[ai] conversation failed", e);
      await sendMessage(chatId, "⚠️ Falhei ao consultar agora. Tenta de novo em alguns segundos.");
    }
  }


  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
