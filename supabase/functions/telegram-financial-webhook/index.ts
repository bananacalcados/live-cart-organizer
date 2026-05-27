// Telegram Financial Agent — webhook receiver
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-telegram-bot-api-secret-token",
};

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const AI_MODEL = "google/gemini-3-flash-preview";

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

async function sendMessage(chatId: number | string, text: string, extra: Record<string, unknown> = {}) {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, parse_mode: "HTML", ...extra, text }),
  });
  if (!res.ok) console.error("[telegram] sendMessage failed", res.status, await res.text());
}

function brDateRange(period: string, customFrom?: string, customTo?: string): { from: string; to: string; fromISO: string; toISO: string; label: string } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
  const todayBR = fmt.format(now);
  const d = new Date(todayBR + "T00:00:00-03:00");
  const addDays = (base: Date, n: number) => new Date(base.getTime() + n * 86400000).toISOString().slice(0, 10);
  // Cobertura UTC do dia BR (UTC-3): from = dayT03:00:00Z, to = (day+1)T02:59:59.999Z
  const toBounds = (fromDay: string, toDay: string, label: string) => {
    const fromISO = `${fromDay}T03:00:00.000Z`;
    const next = addDays(new Date(toDay + "T00:00:00-03:00"), 1);
    const toISO = `${next}T02:59:59.999Z`;
    return { from: fromDay, to: toDay, fromISO, toISO, label };
  };
  if (customFrom && customTo) return toBounds(customFrom, customTo, `${customFrom} a ${customTo}`);
  switch (period) {
    case "yesterday": { const y = addDays(d, -1); return toBounds(y, y, "ontem"); }
    case "7d": return toBounds(addDays(d, -6), todayBR, "últimos 7 dias");
    case "week": return toBounds(addDays(d, -6), todayBR, "últimos 7 dias");
    case "30d": return toBounds(addDays(d, -29), todayBR, "últimos 30 dias");
    case "month": { const first = todayBR.slice(0, 8) + "01"; return toBounds(first, todayBR, "mês atual"); }
    case "today":
    default: return toBounds(todayBR, todayBR, "hoje");
  }
}

const POS_REVENUE_STATUSES = ["completed", "paid", "pending_sync", "pending_pickup"];
const CENTRO_ID = "4ade7b44-5043-4ab1-a124-7a6ab5468e29";
const PEROLA_ID = "1c08a9d8-fc12-4657-8ecf-d442f0c0e9f2";
const TINY_SHOPIFY_ID_FALLBACK = ""; // resolved dynamically when needed
const PHYSICAL_STORE_IDS = [CENTRO_ID, PEROLA_ID];

const tools = [
  {
    type: "function",
    function: {
      name: "list_stores",
      description: "Lista lojas (id + nome). Use sempre que o usuário citar uma loja por nome para resolver o id.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_sales_summary",
      description: "Faturamento, qtd vendas e ticket médio por período. Filtra por loja (store_id/store_name), por vendedora (seller_id/seller_name) ou agrupa (group_by_store / group_by_seller).",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: ["today", "yesterday", "week", "7d", "30d", "month"] },
          from: { type: "string", description: "(opcional) YYYY-MM-DD - sobrescreve period" },
          to: { type: "string", description: "(opcional) YYYY-MM-DD - sobrescreve period" },
          store_id: { type: "string" },
          store_name: { type: "string" },
          seller_id: { type: "string" },
          seller_name: { type: "string" },
          group_by_store: { type: "boolean" },
          group_by_seller: { type: "boolean" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_sales_by_seller",
      description: "Ranking de vendas por vendedora em um período. Retorna nome, qtd vendas, faturamento e ticket médio.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: ["today", "yesterday", "week", "7d", "30d", "month"] },
          from: { type: "string" },
          to: { type: "string" },
          store_id: { type: "string" },
          store_name: { type: "string" },
          limit: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_sales_by_payment_method",
      description: "Vendas agrupadas por método de pagamento (PIX, dinheiro, cartão, crediário, etc) em um período.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: ["today", "yesterday", "week", "7d", "30d", "month"] },
          from: { type: "string" },
          to: { type: "string" },
          store_id: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_physical_cash_by_store",
      description: "Dinheiro físico em espécie nos caixas abertos por loja (pos_cash_registers status='open').",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_accounts_payable",
      description: "Contas a pagar (tiny_accounts_payable). Filtra por período de vencimento e situação.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: ["today", "yesterday", "7d", "30d", "month"], description: "Período de vencimento" },
          from: { type: "string", description: "(opcional) data início YYYY-MM-DD" },
          to: { type: "string", description: "(opcional) data fim YYYY-MM-DD" },
          status: { type: "string", enum: ["pendente", "pago", "vencido", "all"], description: "Default 'pendente'" },
          limit: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_inventory_summary",
      description: "Resumo de estoque oficial (pos_products): pares (soma estoque), valor total (estoque*preço), ticket médio (preço médio). Pode filtrar por loja.",
      parameters: {
        type: "object",
        properties: {
          store_id: { type: "string", description: "(opcional) UUID da loja" },
          group_by_store: { type: "boolean", description: "Se true, retorna breakdown por loja" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_top_products",
      description: "Top produtos por receita em um período (pos_sales físicas).",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: ["today", "yesterday", "week", "7d", "30d", "month"] },
          from: { type: "string" },
          to: { type: "string" },
          store_id: { type: "string" },
          limit: { type: "number" },
        },
      },
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
  {
    type: "function",
    function: {
      name: "list_recent_expenses",
      description: "Lista lançamentos de saída do fluxo de caixa mais recentes.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: ["today", "yesterday", "7d", "30d", "month"] },
          limit: { type: "number" },
        },
        required: ["period"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_cash_flow_summary",
      description: "Fluxo de caixa categorizado: entradas e saídas agrupadas por categoria ou por loja em um período.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: ["today", "yesterday", "7d", "30d", "month"] },
          by: { type: "string", enum: ["category", "store"], description: "Default 'category'" },
        },
        required: ["period"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_categories",
      description: "Lista categorias financeiras (plano de contas) ativas. Use para resolver nome de categoria → id.",
      parameters: {
        type: "object",
        properties: { type: { type: "string", enum: ["income", "expense", "all"] } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "register_expense",
      description: "Registra uma saída no fluxo de caixa. Use quando o usuário descrever uma despesa manualmente (sem comprovante).",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "number" },
          description: { type: "string", description: "Descrição livre (ex: 'Pago ao Victor')" },
          category_name: { type: "string", description: "Nome da categoria (será resolvido)" },
          category_id: { type: "string" },
          payment_method: { type: "string" },
          store_id: { type: "string" },
          date: { type: "string", description: "YYYY-MM-DD; default hoje" },
        },
        required: ["amount", "description"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "register_income",
      description: "Registra uma entrada no fluxo de caixa manualmente.",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "number" },
          description: { type: "string" },
          category_name: { type: "string" },
          category_id: { type: "string" },
          payment_method: { type: "string" },
          store_id: { type: "string" },
          date: { type: "string" },
        },
        required: ["amount", "description"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_entry_description",
      description: "Adiciona/atualiza a descrição livre de um lançamento existente no fluxo de caixa.",
      parameters: {
        type: "object",
        properties: {
          entry_id: { type: "string" },
          description: { type: "string" },
        },
        required: ["entry_id", "description"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_bank_accounts",
      description: "Lista contas bancárias ativas (inclui CAIXAs das lojas físicas). Use para resolver nome → id antes de transferências.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_bank_balance",
      description: "Saldo atual de uma conta específica ou de todas. Saldo = saldo_inicial + entradas - saídas (transferências internas contam no saldo).",
      parameters: {
        type: "object",
        properties: {
          account_id: { type: "string", description: "(opcional) UUID da conta" },
          account_name: { type: "string", description: "(opcional) Nome aproximado (ex: 'CAIXA Pérola', 'Itaú')" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "register_transfer",
      description: "Registra transferência entre 2 contas (ex: 'tirei R$ 500 do CAIXA Pérola e depositei no Itaú'). Cria duas pernas atômicas (saída + entrada) marcadas como is_transfer=true — não impactam DRE, só movem saldo.",
      parameters: {
        type: "object",
        properties: {
          from_account_id: { type: "string" },
          from_account_name: { type: "string", description: "(alternativa) Nome aproximado da conta de origem" },
          to_account_id: { type: "string" },
          to_account_name: { type: "string", description: "(alternativa) Nome aproximado da conta de destino" },
          amount: { type: "number" },
          date: { type: "string", description: "YYYY-MM-DD; default hoje" },
          description: { type: "string", description: "Observação livre" },
        },
        required: ["amount"],
      },
    },
  },
];

async function resolveBankAccount(supabase: any, id?: string, name?: string): Promise<{ id: string; name: string } | null> {
  if (id) {
    const { data } = await supabase.from("bank_accounts").select("id, name").eq("id", id).maybeSingle();
    return data || null;
  }
  if (!name) return null;
  const { data } = await supabase.from("bank_accounts").select("id, name")
    .eq("is_active", true).ilike("name", `%${name}%`).limit(1);
  return data?.[0] || null;
}

async function fetchPosSales(supabase: any, fromISO: string, toISO: string, storeIds: string[]): Promise<any[]> {
  const select = "id, store_id, seller_id, total, paid_at, created_at, status, payment_method, revenue_attribution";
  const a = await supabase.from("pos_sales").select(select)
    .in("status", POS_REVENUE_STATUSES).in("store_id", storeIds)
    .not("paid_at", "is", null).gte("paid_at", fromISO).lte("paid_at", toISO).limit(10000);
  const b = await supabase.from("pos_sales").select(select)
    .in("status", POS_REVENUE_STATUSES).in("store_id", storeIds)
    .is("paid_at", null).gte("created_at", fromISO).lte("created_at", toISO).limit(10000);
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

async function resolveStoreId(supabase: any, storeName?: string, storeId?: string): Promise<string | undefined> {
  if (storeId) return storeId;
  if (!storeName) return undefined;
  const { data } = await supabase.from("pos_stores").select("id, name").ilike("name", `%${storeName}%`).limit(1);
  return data?.[0]?.id;
}

async function runTool(supabase: any, name: string, args: any): Promise<unknown> {
  if (name === "list_stores") {
    const { data } = await supabase.from("pos_stores").select("id, name, is_active").order("name");
    return { lojas: data };
  }

  if (name === "list_categories") {
    const type = args.type || "all";
    let q = supabase.from("financial_categories").select("id, name, parent_id, type, is_active").eq("is_active", true);
    if (type !== "all") q = q.eq("type", type);
    const { data } = await q.order("type").order("name");
    return { categorias: data };
  }

  if (name === "get_sales_summary") {
    const { label, fromISO, toISO } = brDateRange(args.period, args.from, args.to);
    const resolvedStoreId = await resolveStoreId(supabase, args.store_name, args.store_id);
    const storeIds = resolvedStoreId ? [resolvedStoreId] : PHYSICAL_STORE_IDS;
    let sellerId: string | undefined = args.seller_id;
    if (!sellerId && args.seller_name) {
      const { data } = await supabase.from("pos_sellers").select("id").ilike("name", `%${args.seller_name}%`).limit(1);
      sellerId = data?.[0]?.id;
    }
    let sales = await fetchPosSales(supabase, fromISO, toISO, storeIds);
    if (sellerId) sales = sales.filter((r) => r.seller_id === sellerId);

    if (args.group_by_store) {
      const { data: stores } = await supabase.from("pos_stores").select("id, name").in("id", storeIds);
      const byStore: Record<string, { nome: string; total: number; qtd: number; ticket_medio_brl: number }> = {};
      for (const s of stores || []) byStore[s.id] = { nome: s.name, total: 0, qtd: 0, ticket_medio_brl: 0 };
      for (const r of sales) {
        if (!byStore[r.store_id]) byStore[r.store_id] = { nome: "?", total: 0, qtd: 0, ticket_medio_brl: 0 };
        byStore[r.store_id].total += Number(r.total || 0);
        byStore[r.store_id].qtd += 1;
      }
      for (const k of Object.keys(byStore)) byStore[k].ticket_medio_brl = byStore[k].qtd ? byStore[k].total / byStore[k].qtd : 0;
      return { periodo: label, por_loja: byStore };
    }

    if (args.group_by_seller) {
      const sellerIds = [...new Set(sales.map((s) => s.seller_id).filter(Boolean))];
      const { data: sellers } = await supabase.from("pos_sellers").select("id, name, store_id").in("id", sellerIds.length ? sellerIds : ["00000000-0000-0000-0000-000000000000"]);
      const sellerMap: Record<string, { nome: string; store_id: string | null }> = {};
      for (const s of sellers || []) sellerMap[s.id] = { nome: s.name, store_id: s.store_id };
      const agg: Record<string, { nome: string; qtd: number; total: number; ticket_medio_brl: number }> = {};
      for (const r of sales) {
        const key = r.seller_id || "sem_vendedora";
        const nome = sellerMap[r.seller_id]?.nome || (r.seller_id ? "?" : "Sem vendedora");
        const cur = agg[key] || { nome, qtd: 0, total: 0, ticket_medio_brl: 0 };
        cur.qtd += 1; cur.total += Number(r.total || 0);
        agg[key] = cur;
      }
      const linhas = Object.values(agg).map((v) => ({ ...v, ticket_medio_brl: v.qtd ? v.total / v.qtd : 0 })).sort((a, b) => b.total - a.total);
      return { periodo: label, por_vendedora: linhas };
    }

    const total = sales.reduce((s, r) => s + Number(r.total || 0), 0);
    const count = sales.length;
    return {
      periodo: label,
      loja_filtrada: resolvedStoreId || "todas físicas",
      vendedora_filtrada: sellerId || null,
      faturamento_brl: total,
      qtd_vendas: count,
      ticket_medio_brl: count ? total / count : 0,
    };
  }

  if (name === "get_sales_by_seller") {
    const { label, fromISO, toISO } = brDateRange(args.period, args.from, args.to);
    const resolvedStoreId = await resolveStoreId(supabase, args.store_name, args.store_id);
    const storeIds = resolvedStoreId ? [resolvedStoreId] : PHYSICAL_STORE_IDS;
    const sales = await fetchPosSales(supabase, fromISO, toISO, storeIds);
    const sellerIds = [...new Set(sales.map((s) => s.seller_id).filter(Boolean))];
    const { data: sellers } = await supabase.from("pos_sellers").select("id, name, store_id").in("id", sellerIds.length ? sellerIds : ["00000000-0000-0000-0000-000000000000"]);
    const sellerMap: Record<string, { nome: string }> = {};
    for (const s of sellers || []) sellerMap[s.id] = { nome: s.name };
    const agg: Record<string, { nome: string; qtd: number; total: number }> = {};
    for (const r of sales) {
      const key = r.seller_id || "sem_vendedora";
      const nome = sellerMap[r.seller_id]?.nome || (r.seller_id ? "?" : "Sem vendedora");
      const cur = agg[key] || { nome, qtd: 0, total: 0 };
      cur.qtd += 1; cur.total += Number(r.total || 0);
      agg[key] = cur;
    }
    const ranking = Object.values(agg).map((v) => ({ ...v, ticket_medio_brl: v.qtd ? v.total / v.qtd : 0 })).sort((a, b) => b.total - a.total).slice(0, args.limit ?? 20);
    return { periodo: label, ranking };
  }

  if (name === "get_sales_by_payment_method") {
    const { label, fromISO, toISO } = brDateRange(args.period, args.from, args.to);
    const resolvedStoreId = await resolveStoreId(supabase, undefined, args.store_id);
    const storeIds = resolvedStoreId ? [resolvedStoreId] : PHYSICAL_STORE_IDS;
    const sales = await fetchPosSales(supabase, fromISO, toISO, storeIds);
    const agg: Record<string, { qtd: number; total: number }> = {};
    for (const r of sales) {
      const m = (r.payment_method || "desconhecido").toLowerCase();
      const cur = agg[m] || { qtd: 0, total: 0 };
      cur.qtd += 1;
      cur.total += Number(r.total || 0);
      agg[m] = cur;
    }
    const result = Object.entries(agg).map(([metodo, v]) => ({ metodo, ...v })).sort((a, b) => b.total - a.total);
    return { periodo: label, por_metodo: result };
  }

  if (name === "get_physical_cash_by_store") {
    const { data: regs } = await supabase.from("pos_cash_registers")
      .select("store_id, opening_balance, cash_sales, withdrawals, deposits, status, opened_at")
      .eq("status", "open");
    const { data: stores } = await supabase.from("pos_stores").select("id, name");
    const storeName: Record<string, string> = Object.fromEntries((stores || []).map((s: any) => [s.id, s.name]));
    const byStore: Record<string, { loja: string; dinheiro_brl: number; caixas: number; aberto_em: string | null }> = {};
    for (const r of regs || []) {
      const expected = Number(r.opening_balance || 0) + Number(r.cash_sales || 0) + Number(r.deposits || 0) - Number(r.withdrawals || 0);
      const cur = byStore[r.store_id] || { loja: storeName[r.store_id] || "?", dinheiro_brl: 0, caixas: 0, aberto_em: r.opened_at };
      cur.dinheiro_brl += expected;
      cur.caixas += 1;
      byStore[r.store_id] = cur;
    }
    const total = Object.values(byStore).reduce((s, v) => s + v.dinheiro_brl, 0);
    return { total_dinheiro_brl: total, por_loja: byStore, regra: "Soma de (opening_balance + cash_sales + deposits - withdrawals) dos caixas abertos." };
  }

  if (name === "get_accounts_payable") {
    let from: string | undefined, to: string | undefined, label = "";
    if (args.from && args.to) { from = args.from; to = args.to; label = `${from} a ${to}`; }
    else if (args.period) { const r = brDateRange(args.period); from = r.from; to = r.to; label = r.label; }
    const status = args.status || "pendente";
    const limit = args.limit ?? 50;
    let q = supabase.from("tiny_accounts_payable")
      .select("id, nome_fornecedor, numero_doc, data_vencimento, valor, saldo, situacao, store_id")
      .order("data_vencimento", { ascending: true }).limit(limit);
    if (from) q = q.gte("data_vencimento", from);
    if (to) q = q.lte("data_vencimento", to);
    if (status !== "all") {
      if (status === "vencido") {
        const today = brDateRange("today").from;
        q = q.lt("data_vencimento", today).neq("situacao", "pago");
      } else {
        q = q.ilike("situacao", `%${status}%`);
      }
    }
    const { data, error } = await q;
    if (error) return { error: error.message };
    const total = (data || []).reduce((s: number, r: any) => s + Number(r.saldo || r.valor || 0), 0);
    return { periodo: label, status, qtd: data?.length || 0, valor_total_brl: total, contas: data };
  }

  if (name === "get_inventory_summary") {
    const resolvedStoreId = await resolveStoreId(supabase, undefined, args.store_id);
    let q = supabase.from("pos_products").select("store_id, stock, price").eq("is_active", true);
    if (resolvedStoreId) q = q.eq("store_id", resolvedStoreId);
    // chunked fetch (Supabase 1000 limit)
    let all: any[] = [];
    let offset = 0;
    while (true) {
      const { data } = await q.range(offset, offset + 999);
      if (!data || data.length === 0) break;
      all = all.concat(data);
      if (data.length < 1000) break;
      offset += 1000;
    }
    const { data: stores } = await supabase.from("pos_stores").select("id, name");
    const storeName: Record<string, string> = Object.fromEntries((stores || []).map((s: any) => [s.id, s.name]));
    const aggAll = { pares: 0, valor_total: 0, soma_preco: 0, n: 0 };
    const byStore: Record<string, { loja: string; pares: number; valor_total_brl: number; ticket_medio_brl: number; produtos_com_estoque: number }> = {};
    for (const p of all) {
      const stock = Number(p.stock || 0);
      const price = Number(p.price || 0);
      aggAll.pares += stock;
      aggAll.valor_total += stock * price;
      if (price > 0) { aggAll.soma_preco += price; aggAll.n += 1; }
      const cur = byStore[p.store_id] || { loja: storeName[p.store_id] || "?", pares: 0, valor_total_brl: 0, ticket_medio_brl: 0, produtos_com_estoque: 0 };
      cur.pares += stock;
      cur.valor_total_brl += stock * price;
      if (stock > 0) cur.produtos_com_estoque += 1;
      byStore[p.store_id] = cur;
    }
    // ticket médio por loja
    for (const k of Object.keys(byStore)) {
      const items = all.filter((p) => p.store_id === k && Number(p.price) > 0);
      const sum = items.reduce((s, p) => s + Number(p.price), 0);
      byStore[k].ticket_medio_brl = items.length ? sum / items.length : 0;
    }
    return {
      total: {
        pares: aggAll.pares,
        valor_total_brl: aggAll.valor_total,
        ticket_medio_brl: aggAll.n ? aggAll.soma_preco / aggAll.n : 0,
        skus: all.length,
      },
      por_loja: args.group_by_store === false ? undefined : byStore,
      fonte: "pos_products (oficial)",
    };
  }

  if (name === "get_top_products") {
    const { label, fromISO, toISO } = brDateRange(args.period, args.from, args.to);
    const limit = args.limit ?? 10;
    const resolvedStoreId = await resolveStoreId(supabase, undefined, args.store_id);
    const storeIds = resolvedStoreId ? [resolvedStoreId] : PHYSICAL_STORE_IDS;
    const sales = await fetchPosSales(supabase, fromISO, toISO, storeIds);
    const saleIds = sales.map((s) => s.id);
    if (saleIds.length === 0) return { period: label, top: [] };
    const all: any[] = [];
    for (let i = 0; i < saleIds.length; i += 500) {
      const chunk = saleIds.slice(i, i + 500);
      const { data } = await supabase.from("pos_sale_items").select("product_name, quantity, total_price").in("sale_id", chunk);
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

  if (name === "get_pending_crediario") {
    const { data, error } = await supabase.from("pos_sales").select("total")
      .eq("status", "completed").eq("crediario_status", "pending").not("crediario_due_date", "is", null);
    if (error) return { error: error.message };
    const total = (data || []).reduce((s: number, r: any) => s + Number(r.total || 0), 0);
    return { qtd: data?.length || 0, valor_total_brl: total };
  }

  if (name === "list_recent_expenses") {
    const { from, to, label } = brDateRange(args.period);
    const { data, error } = await supabase
      .from("cash_flow_entries")
      .select("id, entry_date, amount, description, payment_method, category:financial_categories(name)")
      .eq("direction", "out").gte("entry_date", from).lte("entry_date", to)
      .order("entry_datetime", { ascending: false }).limit(args.limit ?? 10);
    if (error) return { error: error.message };
    return { period: label, lancamentos: data };
  }

  if (name === "get_cash_flow_summary") {
    const { from, to, label } = brDateRange(args.period);
    const by = args.by || "category";
    const { data } = await supabase.from("cash_flow_entries")
      .select("direction, amount, category_id, store_id, category:financial_categories(name), store:pos_stores(name)")
      .gte("entry_date", from).lte("entry_date", to)
      .in("status", ["confirmed", "reconciled", "pending_category"]).limit(5000);
    const agg: Record<string, { rotulo: string; entradas: number; saidas: number }> = {};
    for (const e of data || []) {
      const key = by === "store" ? (e.store_id || "—") : (e.category_id || "—");
      const label2 = by === "store" ? ((e as any).store?.name || "Sem loja") : ((e as any).category?.name || "Sem categoria");
      const cur = agg[key] || { rotulo: label2, entradas: 0, saidas: 0 };
      if (e.direction === "in") cur.entradas += Number(e.amount); else cur.saidas += Number(e.amount);
      agg[key] = cur;
    }
    const linhas = Object.values(agg).sort((a, b) => (b.entradas + b.saidas) - (a.entradas + a.saidas));
    const totEnt = linhas.reduce((s, l) => s + l.entradas, 0);
    const totSai = linhas.reduce((s, l) => s + l.saidas, 0);
    return { periodo: label, by, total_entradas_brl: totEnt, total_saidas_brl: totSai, saldo_brl: totEnt - totSai, linhas };
  }

  if (name === "register_expense" || name === "register_income") {
    const direction = name === "register_income" ? "in" : "out";
    let categoryId = args.category_id || null;
    if (!categoryId && args.category_name) {
      const { data: cats } = await supabase.from("financial_categories")
        .select("id, name").eq("is_active", true).ilike("name", `%${args.category_name}%`).limit(1);
      categoryId = cats?.[0]?.id || null;
    }
    const { data, error } = await supabase.from("cash_flow_entries").insert({
      entry_date: args.date || brDateRange("today").from,
      direction,
      amount: Number(args.amount),
      description: args.description,
      payment_method: args.payment_method || null,
      store_id: args.store_id || null,
      category_id: categoryId,
      source: "telegram_manual",
      status: "confirmed",
      confidence: 1,
    }).select().single();
    if (error) return { error: error.message };
    return { ok: true, entry_id: data.id, mensagem: `${direction === "in" ? "Entrada" : "Saída"} de R$ ${args.amount} registrada${categoryId ? "" : " (sem categoria)"}.` };
  }

  if (name === "update_entry_description") {
    const { error } = await supabase.from("cash_flow_entries")
      .update({ description: args.description }).eq("id", args.entry_id);
    if (error) return { error: error.message };
    return { ok: true };
  }

  if (name === "list_bank_accounts") {
    const { data } = await supabase.from("bank_accounts")
      .select("id, name, bank_name, account_type, store_id, initial_balance, is_active")
      .eq("is_active", true).order("name");
    return { contas: data };
  }

  if (name === "get_bank_balance") {
    let ids: string[] = [];
    let accs: any[] = [];
    if (args.account_id || args.account_name) {
      const acc = await resolveBankAccount(supabase, args.account_id, args.account_name);
      if (!acc) return { error: "Conta não encontrada" };
      ids = [acc.id];
    }
    let q = supabase.from("bank_accounts").select("id, name, bank_name, account_type, initial_balance, store_id").eq("is_active", true);
    if (ids.length) q = q.in("id", ids);
    const { data: rows } = await q.order("name");
    accs = rows || [];
    if (!accs.length) return { contas: [], total_brl: 0 };
    const { data: entries } = await supabase.from("cash_flow_entries")
      .select("bank_account_id, direction, amount")
      .in("bank_account_id", accs.map((a) => a.id));
    const agg: Record<string, { in: number; out: number }> = {};
    for (const e of entries || []) {
      const id = e.bank_account_id; if (!id) continue;
      agg[id] = agg[id] || { in: 0, out: 0 };
      agg[id][e.direction as "in" | "out"] += Number(e.amount || 0);
    }
    const contas = accs.map((a) => {
      const saldo = Number(a.initial_balance || 0) + (agg[a.id]?.in || 0) - (agg[a.id]?.out || 0);
      return { id: a.id, nome: a.name, banco: a.bank_name, tipo: a.account_type, saldo_brl: saldo };
    });
    const total = contas.reduce((s, c) => s + c.saldo_brl, 0);
    return { contas, total_brl: total };
  }

  if (name === "register_transfer") {
    const from = await resolveBankAccount(supabase, args.from_account_id, args.from_account_name);
    const to = await resolveBankAccount(supabase, args.to_account_id, args.to_account_name);
    if (!from) return { error: "Conta de origem não identificada. Use list_bank_accounts." };
    if (!to) return { error: "Conta de destino não identificada. Use list_bank_accounts." };
    if (from.id === to.id) return { error: "Origem e destino devem ser diferentes." };
    const amt = Number(args.amount);
    if (!amt || amt <= 0) return { error: "Valor inválido" };
    const date = args.date || brDateRange("today").from;
    const pair = crypto.randomUUID();
    const desc = args.description || "Transferência entre contas";
    const { error } = await supabase.from("cash_flow_entries").insert([
      { entry_date: date, direction: "out", amount: amt, description: `${desc} → ${to.name}`,
        source: "transfer", is_transfer: true, transfer_pair_id: pair, bank_account_id: from.id, status: "confirmed", confidence: 1 },
      { entry_date: date, direction: "in", amount: amt, description: `${desc} ← ${from.name}`,
        source: "transfer", is_transfer: true, transfer_pair_id: pair, bank_account_id: to.id, status: "confirmed", confidence: 1 },
    ]);
    if (error) return { error: error.message };
    return { ok: true, mensagem: `Transferência R$ ${amt} de ${from.name} → ${to.name} registrada.` };
  }

  return { error: `tool desconhecida: ${name}` };
}

async function handleConversation(supabase: any, chatId: number, userText: string): Promise<string> {
  const { data: sess } = await supabase.from("financial_agent_sessions").select("state").eq("chat_id", chatId).maybeSingle();
  const history: any[] = (sess?.state?.messages as any[]) || [];

  const system = {
    role: "system",
    content: [
      "Você é o assistente financeiro da Banana Calçados no Telegram.",
      "Tom: direto ao ponto, no máximo 4 linhas, 1-2 emojis no máximo. Sem rodeios.",
      "Use as ferramentas para responder com dados reais — nunca invente números.",
      "Formate valores em BRL (R$ 1.234,56). Datas em pt-BR.",
      "Se o usuário citar nome de loja, vendedora ou categoria, use list_stores/list_categories (ou seller_name no get_sales_*) para resolver o id.",
      "Para perguntas de vendas, use get_sales_summary (faturamento/ticket/qtd, com group_by_store ou group_by_seller), get_sales_by_seller (ranking de vendedoras), get_sales_by_payment_method (canal de pagamento), get_top_products (produtos mais vendidos). Aceita period ('today','yesterday','week','7d','30d','month') OU from+to (YYYY-MM-DD) para qualquer intervalo.",
      "Para inventário sempre use pos_products (fonte oficial).",
      "Contas bancárias: 'CAIXA Centro' / 'CAIXA Pérola' = dinheiro físico nos caixas das lojas; demais = bancos. Vendas em dinheiro do PDV alimentam o CAIXA da loja automaticamente. Para transferências (ex: pegou dinheiro do caixa e depositou no Itaú), use register_transfer.",
      "Se faltar contexto, pergunte 1 coisa só.",
    ].join(" "),
  };

  const messages: any[] = [system, ...history.slice(-12), { role: "user", content: userText }];

  for (let step = 0; step < 6; step++) {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({ model: AI_MODEL, messages, tools, tool_choice: "auto" }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error("[ai] gateway error", res.status, t);
      if (res.status === 429) return "⚠️ Muitas requisições. Tenta em 1 min.";
      if (res.status === 402) return "⚠️ Créditos de IA esgotados.";
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

  await supabase.from("financial_agent_audit").insert({
    chat_id: String(chatId),
    direction: "in",
    action: msg.photo ? "photo" : msg.document ? "document" : msg.voice ? "voice" : "text",
    message: text || null,
    metadata: { from: fromName, message_id: msg.message_id },
  });

  const { data: authUser } = await supabase
    .from("financial_agent_authorized_users")
    .select("chat_id, display_name, active")
    .eq("chat_id", String(chatId)).eq("active", true).maybeSingle();

  if (text.startsWith("/start")) {
    const parts = text.split(/\s+/);
    const token = parts[1];
    if (authUser) {
      await sendMessage(chatId, `✅ Você já está autorizado, ${authUser.display_name}.`);
      return new Response(JSON.stringify({ ok: true }));
    }
    if (!token) {
      await sendMessage(chatId, "🔒 Acesso restrito. Use <code>/start &lt;token&gt;</code>.");
      return new Response(JSON.stringify({ ok: true }));
    }
    const { data: invite } = await supabase.from("financial_agent_invite_tokens")
      .select("token, expires_at, used_at").eq("token", token).maybeSingle();
    if (!invite || invite.used_at || new Date(invite.expires_at).getTime() < Date.now()) {
      await sendMessage(chatId, "❌ Token inválido ou expirado.");
      return new Response(JSON.stringify({ ok: true }));
    }
    await supabase.from("financial_agent_authorized_users").insert({
      chat_id: String(chatId), display_name: fromName, role: "admin", active: true,
    });
    await supabase.from("financial_agent_invite_tokens").update({
      used_at: new Date().toISOString(), used_by_chat_id: String(chatId),
    }).eq("token", invite.token);
    await sendMessage(chatId, `✅ Cadastrado, ${fromName}!`);
    return new Response(JSON.stringify({ ok: true }));
  }

  if (!authUser) {
    await sendMessage(chatId, "🔒 Acesso negado.");
    return new Response(JSON.stringify({ ok: true }));
  }

  if (text === "/help") {
    await sendMessage(chatId,
      "<b>Agente Financeiro</b>\n" +
      "• <i>quanto vendi hoje na loja Centro?</i>\n" +
      "• <i>vendas por método de pagamento essa semana</i>\n" +
      "• <i>quanto tenho em dinheiro físico nos caixas?</i>\n" +
      "• <i>contas a pagar nos próximos 7 dias</i>\n" +
      "• <i>quantos pares tenho em estoque?</i>\n" +
      "• <i>fluxo de caixa por categoria do mês</i>\n" +
      "• <i>saldo da conta Itaú</i> / <i>saldo de todas as contas</i>\n" +
      "• <i>transferi R$ 500 do CAIXA Pérola pro Itaú hoje</i>\n" +
      "• Envie foto de comprovante (com legenda opcional) → eu categorizo e lanço\n" +
      "• /reset — limpa o histórico");
    return new Response(JSON.stringify({ ok: true }));
  }

  if (text === "/reset") {
    await supabase.from("financial_agent_sessions").upsert({ chat_id: chatId, state: {}, expected_action: null });
    await sendMessage(chatId, "🧹 Histórico limpo.");
    return new Response(JSON.stringify({ ok: true }));
  }

  if (text === "/skip") {
    await supabase.from("financial_agent_sessions").upsert({ chat_id: chatId, expected_action: null });
    await sendMessage(chatId, "Ok, sem observação.");
    return new Response(JSON.stringify({ ok: true }));
  }

  // Check if awaiting description for a recent entry
  if (text && !text.startsWith("/")) {
    const { data: sessRow } = await supabase.from("financial_agent_sessions")
      .select("expected_action").eq("chat_id", chatId).maybeSingle();
    const expected = sessRow?.expected_action as string | null;
    if (expected && expected.startsWith("awaiting_description:")) {
      const entryId = expected.split(":")[1];
      await supabase.from("cash_flow_entries").update({ description: text }).eq("id", entryId);
      await supabase.from("financial_agent_sessions").upsert({ chat_id: chatId, expected_action: null });
      await sendMessage(chatId, `📝 Observação salva: "${text}"`);
      return new Response(JSON.stringify({ ok: true }));
    }
  }

  // Process attachments
  let fileId: string | null = null;
  let kind: string | null = null;
  if (msg.photo && Array.isArray(msg.photo) && msg.photo.length > 0) {
    fileId = msg.photo[msg.photo.length - 1].file_id;
    kind = "photo";
  } else if (msg.document) {
    fileId = msg.document.file_id;
    kind = "document";
  }

  if (fileId) {
    fetch(`${SUPABASE_URL}/functions/v1/telegram-financial-process-attachment`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ chat_id: chatId, message_id: msg.message_id, file_id: fileId, kind, caption: msg.caption || null }),
    }).catch((e) => console.error("[webhook] process-attachment dispatch failed", e));
    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (text) {
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
      await sendMessage(chatId, "⚠️ Falhei ao consultar agora.");
    }
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
