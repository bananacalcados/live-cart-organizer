// Marketing Agent (Estrategista) — Anthropic (Claude) como motor principal,
// fallback automático para Lovable AI Gateway se ANTHROPIC_API_KEY ausente
// ou se a Anthropic responder erro de crédito/autenticação.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- TOOLS ----------
// Definição canônica em formato Anthropic (input_schema).
// Conversão on-the-fly para formato OpenAI/Gateway quando cair no fallback.
const TOOLS_ANTHROPIC = [
  { name: "get_agent_memory", description: "Carrega decisões ativas, vetos, regras aprendidas, calendário e metas. SEMPRE chame no início da conversa.", input_schema: { type: "object", properties: { mes_ref: { type: "string", description: "YYYY-MM (opcional)" } } } },
  { name: "get_classificacao_summary", description: "Distribuição de disparos por classificação (marketing/utility/authentication) nos últimos 30 dias.", input_schema: { type: "object", properties: {} } },
  { name: "get_shadow_report", description: "Relatório do ciclo shadow (bloqueios que teriam sido feitos, custo evitado).", input_schema: { type: "object", properties: { desde: { type: "string" }, ate: { type: "string" } }, required: ["desde", "ate"] } },
  { name: "get_live_events_summary", description: "Lives capturadas no mês (viewers, proxy convite_live 5k+, eventos).", input_schema: { type: "object", properties: { mes_ref: { type: "string" } }, required: ["mes_ref"] } },
  { name: "get_sales_vs_goals", description: "Vendas por loja vs metas oficiais do PDV no mês. Retorna por_loja com realizado_loja_pura (balcão, sem Live), live_embutida_na_loja (quanto de Live foi registrado dentro daquela loja física) e realizado_total_incluindo_live. Também retorna shopify_mais_live (Shopify+Live agregados contra a meta digital).", input_schema: { type: "object", properties: { mes_ref: { type: "string" } }, required: ["mes_ref"] } },
  { name: "get_events_performance", description: "Performance por evento do módulo Eventos no mês (id, nome, canal site/pos_perola/pos_centro, pedidos, pagos, receita paga/total, conversão). Use para entender qual live/evento performou melhor.", input_schema: { type: "object", properties: { mes_ref: { type: "string" } }, required: ["mes_ref"] } },
  { name: "get_rfm_summary", description: "Base RFM completa: total de clientes, ticket médio, gasto total, distribuição por segmento RFM (campeões, leais, em risco, hibernando etc) com ticket/pedidos/dias desde última compra por segmento, distribuição por tamanho de calçado (top 20) e por região.", input_schema: { type: "object", properties: {} } },
  { name: "get_customer_lookup", description: "Busca um cliente específico na base unificada por telefone, CPF, nome, Instagram, email ou customer_code. Retorna ficha completa: compras, ticket médio, tamanho, RFM (calor), dias desde última compra, cashback, tags.", input_schema: { type: "object", properties: { query: { type: "string", description: "Telefone, CPF, nome, @instagram, email ou BC-NNNNNN" } }, required: ["query"] } },
  { name: "get_top_customers", description: "Top N clientes por gasto total, opcionalmente filtrado por segmento RFM. Retorna nome, telefone, tamanho, cidade, ticket, última compra, RFM. Use para ativar/segmentar públicos ou entender quem são os melhores clientes de um segmento.", input_schema: { type: "object", properties: { segmento: { type: "string", description: "Segmento RFM exato (ex: 'campeoes', 'leais', 'em_risco'). Omita para geral." }, limite: { type: "integer", description: "Padrão 20, máx 100" } } } },
  { name: "get_stock_by_size", description: "Estoque agregado por numeração/marca/categoria.", input_schema: { type: "object", properties: { marca: { type: "string" }, categoria: { type: "string" }, min_estoque: { type: "integer" } } } },
  { name: "get_leads_by_channel", description: "Contagem de leads captados por canal no período.", input_schema: { type: "object", properties: { desde: { type: "string" }, ate: { type: "string" } }, required: ["desde", "ate"] } },
  { name: "get_leads_lookup", description: "Busca detalhada de leads em TODAS as bases (ad_leads, event_leads, lp_leads, link_page_leads). Sem query, retorna os mais recentes do período. Traz temperatura, tamanho, canal, estágio de conversa quando disponível.", input_schema: { type: "object", properties: { query: { type: "string", description: "Telefone, nome ou @instagram (opcional)" }, desde: { type: "string", description: "YYYY-MM-DD (padrão: -90 dias)" }, ate: { type: "string", description: "YYYY-MM-DD (padrão: hoje)" } } } },
  { name: "get_campaign_results", description: "Envios/custo por dia+categoria+provider nos 4 fluxos.", input_schema: { type: "object", properties: { desde: { type: "string" }, ate: { type: "string" } }, required: ["desde", "ate"] } },
  { name: "get_dispatch_pressure", description: "Pressão de toques por segmento RFM e exposição a grupos no período.", input_schema: { type: "object", properties: { desde: { type: "string" }, ate: { type: "string" } }, required: ["desde", "ate"] } },
  { name: "propor_decisao", description: "PROPÕE gravar uma decisão/veto/regra/pendência. Só grava após confirmação explícita do usuário no próximo turn.", input_schema: { type: "object", properties: { tipo: { type: "string", enum: ["decisao", "veto", "regra_aprendida", "pendencia"] }, descricao: { type: "string" }, motivo: { type: "string" }, contexto: { type: "object" } }, required: ["tipo", "descricao"] } },
  { name: "propor_acao_calendario", description: "PROPÕE adicionar ação no CALENDÁRIO INTERNO DO AGENTE (rascunho/memória). Para itens que devem aparecer na aba Calendário do Marketing use propor_entrada_calendario.", input_schema: { type: "object", properties: { mes_ref: { type: "string" }, data: { type: "string", description: "YYYY-MM-DD" }, tipo_acao: { type: "string", enum: ["live_grande", "live_loja", "disparo_semanal", "campanha_estoque", "acao_meta_ads", "outro"] }, titulo: { type: "string" }, descricao: { type: "string" }, publico_alvo_descricao: { type: "string" }, custo_estimado_brl: { type: "number" } }, required: ["mes_ref", "data", "tipo_acao", "titulo"] } },
  { name: "propor_entrada_calendario", description: "PROPÕE criar entrada REAL no Calendário do Marketing (aba Calendário). Só grava após confirmação. Use para lives, campanhas, lembretes, metas ou outros marcos que o usuário deve ver no calendário.", input_schema: { type: "object", properties: { entry_date: { type: "string", description: "YYYY-MM-DD" }, end_date: { type: "string", description: "YYYY-MM-DD (opcional, evento multi-dia)" }, title: { type: "string" }, content: { type: "string" }, entry_type: { type: "string", enum: ["live", "campanha", "lembrete", "meta", "outro"] }, color: { type: "string", description: "Cor HEX, ex #3b82f6" } }, required: ["entry_date", "title", "entry_type"] } },
  { name: "propor_meta_mensal_calendario", description: "PROPÕE gravar metas/anotações do mês na aba Calendário (marketing_calendar_goals). Upsert por (year, month). Só grava após confirmação.", input_schema: { type: "object", properties: { year: { type: "integer" }, month: { type: "integer", description: "1-12" }, goals: { type: "array", items: { type: "string" }, description: "Lista de objetivos do mês" }, actions: { type: "string" }, notes: { type: "string" } }, required: ["year", "month"] } },
  { name: "propor_meta", description: "PROPÕE definir/atualizar meta mensal de FATURAMENTO por loja/canal. Para loja/canal com store no PDV grava em public.pos_goals; total ou canal sem store cai em monthly_goals. Só grava após confirmação.", input_schema: { type: "object", properties: { mes_ref: { type: "string" }, loja: { type: "string", enum: ["perola", "centro", "shopify", "live", "total"] }, meta_faturamento_brl: { type: "number" }, observacao: { type: "string" } }, required: ["mes_ref", "loja", "meta_faturamento_brl"] } },
  { name: "propor_publico", description: "PROPÕE criar um PÚBLICO reutilizável (campanha_publicos) que fica disponível em PDV > Online > Automação, Marketing > Disparos e Matriz RFM. SEMPRE chame preview_audience antes com o MESMO filtro_json para mostrar total estimado e amostra ao usuário. Só grava após confirmação.", input_schema: { type: "object", properties: { nome: { type: "string" }, filtro_json: { type: "object", description: "Objeto com include e exclude (ambos opcionais). Chaves suportadas em cada bloco: sizes[], categories[], brands[], stores[], payment_methods[], cities[], ddds[], states[], rfm_segments[], tags[], in_vip_group (bool), min_avg_ticket, max_avg_ticket, min_total_orders, max_total_orders, last_purchase_op (gt_days|lt_days|after|before|between), last_purchase_days, last_purchase_from, last_purchase_to, first_purchase_op, first_purchase_days, first_purchase_from, first_purchase_to. Nunca invente segmento RFM — use somente segmentos existentes vistos em get_rfm_summary." }, descricao_curta: { type: "string", description: "Uma frase explicando o que o público representa" } }, required: ["nome", "filtro_json"] } },
  { name: "propor_atualizar_publico", description: "PROPÕE atualizar nome e/ou filtro_json de um público existente. Só grava após confirmação.", input_schema: { type: "object", properties: { id: { type: "string" }, nome: { type: "string" }, filtro_json: { type: "object" } }, required: ["id"] } },
  { name: "preview_audience", description: "READ. Calcula quantos clientes o filtro_json atinge (crm_customers_v via bc_match_audience) e devolve amostra de até 50. Use sempre ANTES de propor_publico para validar o filtro e mostrar volume ao usuário.", input_schema: { type: "object", properties: { filtro_json: { type: "object" } }, required: ["filtro_json"] } },
  { name: "list_audiences", description: "READ. Lista os públicos já salvos em campanha_publicos (id, nome, filtro_json, updated_at) para evitar duplicatas.", input_schema: { type: "object", properties: {} } },
  { name: "list_dispatches", description: "READ. Lista disparos em massa (dispatch_history) no período: id, campaign_name/template_name, started_at, audience_source, total/sent/failed, status, provider. Use para escolher IDs a analisar depois com get_dispatch_result.", input_schema: { type: "object", properties: { desde: { type: "string", description: "YYYY-MM-DD" }, ate: { type: "string", description: "YYYY-MM-DD" }, limite: { type: "integer", description: "Padrão 30, máx 100" } }, required: ["desde", "ate"] } },
  { name: "get_dispatch_result", description: "READ. Resultado detalhado de 1+ disparos com FATURAMENTO. Match DDD+8. Buckets consolidados (JÁ DEDUPLICADOS por telefone único; NUNCA some per-dispatch): engaged_unique, read_unique, read_not_converted_unique (quem LEU e não comprou), read_converted_unique, converted_unique, not_converted_unique (recebeu e não comprou), replied_unique, failed_unique. Use consolidated.source_refs.{bucket} em propor_publico_lista.", input_schema: { type: "object", properties: { dispatch_ids: { type: "array", items: { type: "string" }, description: "IDs de dispatch_history" }, sample_limit: { type: "integer", description: "Padrão 50, máx 500 telefones por bucket." }, desde: { type: "string", description: "YYYY-MM-DD opcional. Início da janela de conversão. Padrão: earliest started_at dos disparos." }, ate: { type: "string", description: "YYYY-MM-DD opcional. Fim da janela de conversão. Padrão: hoje." } }, required: ["dispatch_ids"] } },
  { name: "get_leads_pool", description: "READ. Pool bruto de leads em TODAS as bases (ad_leads, event_leads, lp_leads, link_page_leads) no período, deduplicado por sufixo de 8 dígitos. Retorna telefones, canal e opcionalmente exclui quem já é cliente com compra em customers_unified. Use para propor públicos como 'leads frescos que não compraram'.", input_schema: { type: "object", properties: { desde: { type: "string", description: "YYYY-MM-DD" }, ate: { type: "string", description: "YYYY-MM-DD" }, canais: { type: "array", items: { type: "string", enum: ["ad_leads", "event_leads", "lp_leads", "link_page_leads"] }, description: "Padrão: todas" }, excluir_compradores: { type: "boolean", description: "Se true, exclui leads que já têm total_orders>0 em customers_unified" }, limite: { type: "integer", description: "Máx 10000, padrão 5000" } }, required: ["desde", "ate"] } },
  { name: "propor_publico_lista", description: "PROPÕE criar um público em campanha_publicos a partir de lista fixa. Para listas pequenas pode enviar phones[]. Para listas grandes: use source_ref e o servidor recalcula. Para disparo: source='dispatch_result', source_ref={dispatch_ids:[...], bucket:'not_converted', desde, ate}. Para leads: source='leads_pool', source_ref={desde, ate, canais?:[...], excluir_compradores?:bool}. Só grava após confirmação.", input_schema: { type: "object", properties: { nome: { type: "string" }, phones: { type: "array", items: { type: "string" }, description: "Telefones opcionais. Use apenas para listas pequenas/manuais." }, source: { type: "string", description: "dispatch_result | leads_pool | manual" }, source_ref: { type: "object", description: "Referência rastreável para recomputar a lista." }, descricao_curta: { type: "string" } }, required: ["nome"] } },
];

const TOOLS_OPENAI = TOOLS_ANTHROPIC.map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.input_schema },
}));

const READ_TOOLS = new Set([
  "get_agent_memory", "get_classificacao_summary", "get_shadow_report",
  "get_live_events_summary", "get_sales_vs_goals", "get_events_performance", "get_rfm_summary",
  "get_customer_lookup", "get_top_customers",
  "get_stock_by_size", "get_leads_by_channel", "get_leads_lookup", "get_campaign_results",
  "get_dispatch_pressure",
  "preview_audience", "list_audiences",
  "list_dispatches", "get_dispatch_result", "get_leads_pool",
]);
const PROPOSAL_TOOLS = new Set([
  "propor_decisao", "propor_acao_calendario", "propor_meta",
  "propor_entrada_calendario", "propor_meta_mensal_calendario",
  "propor_publico", "propor_atualizar_publico", "propor_publico_lista",
]);


function normalizePhoneSuffix8(raw: any): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  return digits.slice(-8);
}

// DDD (2) + 8 últimos dígitos = chave forte de match entre bases (evita colisão entre DDDs).
// Aceita entradas com/sem 55 e com/sem o 9º dígito.
function normalizePhoneDDD8(raw: any): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  // agora esperamos 10 (fixo) ou 11 (com 9º dígito)
  if (d.length !== 10 && d.length !== 11) return null;
  const ddd = d.slice(0, 2);
  const last8 = d.slice(-8);
  return ddd + last8;
}

function normalizePhoneE164BR(raw: any): string | null {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  if (digits.length >= 12 && digits.startsWith("55")) digits = digits.slice(2);
  if (digits.length === 10) {
    // DDD + 8 dígitos → insere 9
    digits = digits.slice(0, 2) + "9" + digits.slice(2);
  }
  if (digits.length !== 11) return null;
  return "55" + digits;
}

const PAGE_SIZE = 1000;

async function fetchPaginated(
  supabase: any,
  table: string,
  select: string,
  apply: (query: any) => any,
  maxRows = 50000,
): Promise<any[]> {
  const rows: any[] = [];
  let page = 0;
  while (rows.length < maxRows) {
    let q = supabase.from(table).select(select);
    q = apply(q).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    page += 1;
  }
  return rows.slice(0, maxRows);
}

function sourceRef(dispatchIds: string[], bucket: string, desde?: string | null, ate?: string | null) {
  return { source: "dispatch_result", dispatch_ids: dispatchIds, bucket, desde: desde ?? null, ate: ate ?? null };
}

async function analyzeDispatchResult(supabase: any, input: any): Promise<{ result: any; phoneLists: any }> {
  const ids: string[] = Array.isArray(input?.dispatch_ids) ? input.dispatch_ids : [];
  if (!ids.length) return { result: { error: "dispatch_ids obrigatório" }, phoneLists: null };
  const sampleLimit = Math.min(Math.max(input?.sample_limit ?? 50, 1), 500);

  const { data: hist, error: eH } = await supabase
    .from("dispatch_history")
    .select("id, campaign_name, template_name, created_at, started_at, total_recipients, sent_count, failed_count, status, provider, audience_source, cost_per_message, template_category")
    .in("id", ids);
  if (eH) return { result: { error: eH.message }, phoneLists: null };

  const histRows = hist ?? [];
  if (!histRows.length) {
    return { result: { error: `Nenhum dispatch_history encontrado para os IDs informados: ${ids.join(", ")}. Chame list_dispatches ANTES para obter IDs reais — não invente UUIDs.`, dispatch_ids_recebidos: ids }, phoneLists: null };
  }
  if (histRows.length < ids.length) {
    const encontrados = new Set(histRows.map((r: any) => r.id));
    const faltantes = ids.filter((x) => !encontrados.has(x));
    return { result: { error: `IDs inexistentes em dispatch_history: ${faltantes.join(", ")}. Chame list_dispatches para obter IDs reais.`, ids_invalidos: faltantes }, phoneLists: null };
  }
  const earliestStart = histRows.reduce((min: string | null, r: any) => {
    const dt = r.created_at || r.started_at;
    if (!dt) return min;
    return !min || dt < min ? dt : min;
  }, null as string | null);
  // Sanity check: janela desde/ate MUITO anterior à data do disparo (ex.: LLM usou o ano errado)
  if (input?.ate && earliestStart) {
    const ateDt = new Date(`${input.ate}T23:59:59`);
    const earliestDt = new Date(earliestStart);
    if (ateDt.getTime() < earliestDt.getTime()) {
      return { result: { error: `Janela informada (ate=${input.ate}) é ANTERIOR à data do disparo (${earliestStart.slice(0,10)}). Verifique o ANO — hoje é ${new Date().getFullYear()}. Refaça a chamada com desde/ate no ano correto.` }, phoneLists: null };
    }
  }
  const convFrom = input?.desde ? `${input.desde}T00:00:00` : earliestStart;
  const convTo = input?.ate ? `${input.ate}T23:59:59` : null;


  let recips: any[] = [];
  try {
    recips = await fetchPaginated(
      supabase,
      "dispatch_recipients",
      "dispatch_id, phone, recipient_name, status, sent_at, last_error",
      (q) => q.in("dispatch_id", ids).order("created_at", { ascending: true }),
      100000,
    );
  } catch (error: any) {
    return { result: { error: error.message }, phoneLists: null };
  }

  type KeyBucket = { phones: Set<string>; ddd8: Set<string> };
  type PerDispatch = { buckets: Record<string, KeyBucket>; engaged_ddd8: Set<string>; read_ddd8: Set<string>; failed_ddd8: Set<string> };
  const perDispatch = new Map<string, PerDispatch>();
  const ddd8ToPhone = new Map<string, string>();

  for (const r of recips) {
    const did = r.dispatch_id;
    const pd = perDispatch.get(did) ?? { buckets: {}, engaged_ddd8: new Set<string>(), read_ddd8: new Set<string>(), failed_ddd8: new Set<string>() };
    const st = r.status || "pending";
    const b = (pd.buckets[st] ||= { phones: new Set<string>(), ddd8: new Set<string>() });
    b.phones.add(r.phone);
    const k = normalizePhoneDDD8(r.phone);
    if (k) {
      b.ddd8.add(k);
      if (!ddd8ToPhone.has(k)) ddd8ToPhone.set(k, r.phone);
      if (st === "sent" || st === "delivered" || st === "read") pd.engaged_ddd8.add(k);
      if (st === "read") pd.read_ddd8.add(k);
      if (st === "failed" || st === "blocked") pd.failed_ddd8.add(k);
    }
    perDispatch.set(did, pd);
  }

  const allEngaged = new Set<string>();
  for (const pd of perDispatch.values()) for (const k of pd.engaged_ddd8) allEngaged.add(k);

  const salesByKey = new Map<string, { orders: number; revenue: number; sources: Set<string> }>();
  const addSale = (k: string | null, total: any, source: string) => {
    if (!k || !allEngaged.has(k)) return;
    const cur = salesByKey.get(k) ?? { orders: 0, revenue: 0, sources: new Set<string>() };
    cur.orders += 1;
    cur.revenue += Number(total ?? 0);
    cur.sources.add(source);
    salesByKey.set(k, cur);
  };

  if (convFrom && allEngaged.size > 0) {
    try {
      const posCustomerById = new Map<string, { k: string; phone: string; name: string | null }>();
      const customers = await fetchPaginated(supabase, "pos_customers", "id, name, whatsapp", (q) => q.not("whatsapp", "is", null), 100000);
      for (const c of customers) {
        const k = normalizePhoneDDD8(c.whatsapp);
        if (k) posCustomerById.set(c.id, { k, phone: c.whatsapp, name: c.name ?? null });
      }

      const posSales = await fetchPaginated(
        supabase,
        "pos_sales",
        "id, total, created_at, customer_id, customer_phone, customer_name, status, status_cancelamento",
        (q) => {
          let qq = q.gte("created_at", convFrom).in("status", ["paid", "completed"]);
          if (convTo) qq = qq.lte("created_at", convTo);
          return qq;
        },
        100000,
      );
      for (const s of posSales) {
        if (String(s.status_cancelamento ?? "").toLowerCase() === "cancelado") continue;
        const linked = s.customer_id ? posCustomerById.get(s.customer_id) : null;
        addSale(linked?.k || normalizePhoneDDD8(s.customer_phone), s.total, "PDV");
      }

      const zoppySales = await fetchPaginated(
        supabase,
        "zoppy_sales",
        "id, total, customer_phone, completed_at, status",
        (q) => {
          let qq = q.gte("completed_at", convFrom).in("status", ["paid", "complete", "completed"]);
          if (convTo) qq = qq.lte("completed_at", convTo);
          return qq;
        },
        50000,
      );
      for (const s of zoppySales) addSale(normalizePhoneDDD8(s.customer_phone), s.total, "Shopify");

      const paidStages = ["paid", "shipped", "awaiting_shipment", "awaiting_shipping", "store_pickup", "awaiting_mototaxi", "awaiting_pickup", "completed"];
      const orders = await fetchPaginated(
        supabase,
        "orders",
        "id, products, is_paid, paid_at, customer_id, stage, created_at",
        (q) => {
          let qq = q.eq("is_paid", true).in("stage", paidStages).gte("paid_at", convFrom);
          if (convTo) qq = qq.lte("paid_at", convTo);
          return qq;
        },
        50000,
      );
      const orderCustomerIds = [...new Set(orders.map((o: any) => o.customer_id).filter(Boolean))];
      const orderCustomers = new Map<string, string>();
      for (let i = 0; i < orderCustomerIds.length; i += 500) {
        const chunk = orderCustomerIds.slice(i, i + 500);
        const { data } = await supabase.from("customers").select("id, whatsapp").in("id", chunk);
        for (const c of (data ?? [])) if (c.whatsapp) orderCustomers.set(c.id, c.whatsapp);
      }
      for (const o of orders) {
        const products = Array.isArray(o.products) ? o.products : [];
        const total = products.reduce((sum: number, p: any) => sum + Number(p?.price ?? 0) * Number(p?.quantity ?? 1), 0);
        addSale(normalizePhoneDDD8(o.customer_id ? orderCustomers.get(o.customer_id) : null), total, "WhatsApp");
      }
    } catch (error: any) {
      return { result: { error: error.message }, phoneLists: null };
    }
  }

  const repliedGlobal = new Set<string>();
  if (convFrom && allEngaged.size > 0) {
    try {
      const msgs = await fetchPaginated(
        supabase,
        "whatsapp_messages",
        "phone, direction, created_at",
        (q) => {
          let qq = q.eq("direction", "incoming").gte("created_at", convFrom);
          if (convTo) qq = qq.lte("created_at", convTo);
          return qq;
        },
        100000,
      );
      for (const m of msgs) {
        const k = normalizePhoneDDD8(m.phone);
        if (k && allEngaged.has(k)) repliedGlobal.add(k);
      }
    } catch (_) {
      // Resposta é complementar; se a tabela/coluna mudar, não derruba análise de compra.
    }
  }

  const sampleFromKeys = (keys: Iterable<string>) => {
    const out: string[] = [];
    for (const k of keys) {
      const p = ddd8ToPhone.get(k);
      if (p) out.push(p);
      if (out.length >= sampleLimit) break;
    }
    return out;
  };
  const phonesFromKeys = (keys: Iterable<string>) => Array.from(keys).map((k) => ddd8ToPhone.get(k)).filter(Boolean) as string[];

  const perDispatchReport: any[] = [];
  const phoneListsByDispatch: Record<string, Record<string, string[]>> = {};
  const defaultDesde = input?.desde ?? null;
  const defaultAte = input?.ate ?? null;

  for (const h of histRows) {
    const pd = perDispatch.get(h.id) ?? { buckets: {}, engaged_ddd8: new Set<string>(), read_ddd8: new Set<string>(), failed_ddd8: new Set<string>() };
    const engaged = pd.engaged_ddd8;
    const convKeys: string[] = [];
    const notConvKeys: string[] = [];
    const replKeys: string[] = [];
    let converters = 0, orders = 0, revenue = 0;

    for (const k of engaged) {
      const s = salesByKey.get(k);
      if (s) { converters += 1; orders += s.orders; revenue += s.revenue; convKeys.push(k); }
      else notConvKeys.push(k);
      if (repliedGlobal.has(k)) replKeys.push(k);
    }

    const category = String(h.template_category || "MARKETING").toUpperCase();
    const costPerMessage = h.cost_per_message != null ? Number(h.cost_per_message) : (category === "UTILITY" ? 0.05 : 0.40);
    const costTotal = Number((costPerMessage * Number(h.sent_count || engaged.size || 0)).toFixed(2));
    phoneListsByDispatch[h.id] = {
      engaged: phonesFromKeys(engaged), read: phonesFromKeys(pd.read_ddd8), failed: phonesFromKeys(pd.failed_ddd8),
      converted: phonesFromKeys(convKeys), not_converted: phonesFromKeys(notConvKeys), replied: phonesFromKeys(replKeys),
    };

    const dispatchIds = [h.id];
    perDispatchReport.push({
      id: h.id,
      campaign_name: h.campaign_name ?? h.template_name,
      template_name: h.template_name,
      started_at: h.started_at,
      audience_source: h.audience_source,
      status: h.status,
      totals_by_status: Object.fromEntries(Object.entries(pd.buckets).map(([k, v]) => [k, v.phones.size])),
      engaged: { total: engaged.size, note: "sent+delivered+read (dedup DDD+8)", source_ref: sourceRef(dispatchIds, "engaged", defaultDesde, defaultAte) },
      read: { total: pd.read_ddd8.size, sample_phones: sampleFromKeys(pd.read_ddd8), source_ref: sourceRef(dispatchIds, "read", defaultDesde, defaultAte) },
      converted: { total: converters, orders, faturamento_brl: Number(revenue.toFixed(2)), conv_rate_engaged_pct: engaged.size ? Number(((converters / engaged.size) * 100).toFixed(2)) : 0, sample_phones: sampleFromKeys(convKeys), source_ref: sourceRef(dispatchIds, "converted", defaultDesde, defaultAte) },
      not_converted: { total: notConvKeys.length, sample_phones: sampleFromKeys(notConvKeys), source_ref: sourceRef(dispatchIds, "not_converted", defaultDesde, defaultAte) },
      replied: { total: replKeys.length, sample_phones: sampleFromKeys(replKeys), source_ref: sourceRef(dispatchIds, "replied", defaultDesde, defaultAte) },
      cost: { cost_per_message_brl: costPerMessage, total_cost_brl: costTotal, roas: costTotal > 0 ? Number((revenue / costTotal).toFixed(2)) : null },
    });
  }

  let overlap: any = null;
  if (perDispatch.size > 1) {
    const count = new Map<string, number>();
    for (const pd of perDispatch.values()) for (const k of pd.engaged_ddd8) count.set(k, (count.get(k) ?? 0) + 1);
    const inAll: string[] = [];
    const inTwoPlus: string[] = [];
    const nDisp = perDispatch.size;
    for (const [k, c] of count.entries()) {
      if (c >= 2) inTwoPlus.push(k);
      if (c === nDisp) inAll.push(k);
    }
    overlap = {
      note: "engajados presentes em múltiplos disparos (chave DDD+8)",
      n_disparos: nDisp,
      in_two_or_more: { total: inTwoPlus.length, sample_phones: sampleFromKeys(inTwoPlus) },
      in_all: { total: inAll.length, sample_phones: sampleFromKeys(inAll) },
    };
  }

  const convertedAll: string[] = [];
  const notConvertedAll: string[] = [];
  const repliedAll: string[] = [];
  const readAll = new Set<string>();
  const failedAll = new Set<string>();
  for (const pd of perDispatch.values()) {
    for (const k of pd.read_ddd8) readAll.add(k);
    for (const k of pd.failed_ddd8) failedAll.add(k);
  }
  const readNotConvertedAll: string[] = [];
  const readConvertedAll: string[] = [];
  let totalConverters = 0, totalOrders = 0, totalRevenue = 0, totalCost = 0;
  for (const h of histRows) {
    const category = String(h.template_category || "MARKETING").toUpperCase();
    const costPerMessage = h.cost_per_message != null ? Number(h.cost_per_message) : (category === "UTILITY" ? 0.05 : 0.40);
    totalCost += costPerMessage * Number(h.sent_count || 0);
  }
  for (const k of allEngaged) {
    const s = salesByKey.get(k);
    if (s) { totalConverters += 1; totalOrders += s.orders; totalRevenue += s.revenue; convertedAll.push(k); }
    else notConvertedAll.push(k);
    if (repliedGlobal.has(k)) repliedAll.push(k);
  }
  for (const k of readAll) {
    if (salesByKey.has(k)) readConvertedAll.push(k);
    else readNotConvertedAll.push(k);
  }
  const consolidatedPhones = {
    engaged: phonesFromKeys(allEngaged), converted: phonesFromKeys(convertedAll),
    not_converted: phonesFromKeys(notConvertedAll), replied: phonesFromKeys(repliedAll),
    read: phonesFromKeys(readAll), failed: phonesFromKeys(failedAll),
    read_not_converted: phonesFromKeys(readNotConvertedAll),
    read_converted: phonesFromKeys(readConvertedAll),
  };

  return {
    result: {
      window: { desde: convFrom, ate: convTo ?? "now" },
      match_key: "DDD+8",
      dedup_note: "TODOS os totais consolidados abaixo já são únicos por DDD+8. NUNCA some per-dispatch: quem recebeu N disparos aparece 1x aqui. Para 'quem leu e não comprou' use consolidated.read_not_converted_unique — não subtraia manualmente.",
      sales_sources: ["pos_sales via customer_id/phone", "zoppy_sales", "orders"],
      sales_status_filter: ["paid", "completed", "complete"],
      dispatches: perDispatchReport,
      overlap,
      consolidated: {
        engaged_unique: allEngaged.size,
        read_unique: readAll.size,
        read_not_converted_unique: readNotConvertedAll.length,
        read_converted_unique: readConvertedAll.length,
        failed_unique: failedAll.size,
        converted_unique: totalConverters,
        orders_total: totalOrders,
        faturamento_brl: Number(totalRevenue.toFixed(2)),
        conv_rate_engaged_pct: allEngaged.size ? Number(((totalConverters / allEngaged.size) * 100).toFixed(2)) : 0,
        conv_rate_read_pct: readAll.size ? Number(((readConvertedAll.length / readAll.size) * 100).toFixed(2)) : 0,
        replied_unique: repliedGlobal.size,
        cost_total_brl: Number(totalCost.toFixed(2)),
        roas: totalCost > 0 ? Number((totalRevenue / totalCost).toFixed(2)) : null,
        source_refs: {
          engaged: sourceRef(ids, "engaged", defaultDesde, defaultAte),
          read: sourceRef(ids, "read", defaultDesde, defaultAte),
          read_not_converted: sourceRef(ids, "read_not_converted", defaultDesde, defaultAte),
          read_converted: sourceRef(ids, "read_converted", defaultDesde, defaultAte),
          converted: sourceRef(ids, "converted", defaultDesde, defaultAte),
          not_converted: sourceRef(ids, "not_converted", defaultDesde, defaultAte),
          replied: sourceRef(ids, "replied", defaultDesde, defaultAte),
        },
      },
    },
    phoneLists: { by_dispatch: phoneListsByDispatch, consolidated: consolidatedPhones },
  };
}

async function resolveDispatchSourcePhones(supabase: any, ref: any): Promise<string[]> {
  if (!ref || !Array.isArray(ref.dispatch_ids) || !ref.dispatch_ids.length) return [];
  const bucket = String(ref.bucket || "");
  if (!["engaged", "read", "failed", "converted", "not_converted", "replied", "read_not_converted", "read_converted"].includes(bucket)) return [];
  const { phoneLists } = await analyzeDispatchResult(supabase, {
    dispatch_ids: ref.dispatch_ids,
    desde: ref.desde ?? undefined,
    ate: ref.ate ?? undefined,
    sample_limit: 1,
  });
  if (!phoneLists) return [];
  if (ref.dispatch_id && phoneLists.by_dispatch?.[ref.dispatch_id]?.[bucket]) return phoneLists.by_dispatch[ref.dispatch_id][bucket];
  return phoneLists.consolidated?.[bucket] ?? [];
}

async function resolveLeadsPoolPhones(supabase: any, ref: any): Promise<string[]> {
  if (!ref) return [];
  const desde = ref.desde;
  const ate = ref.ate;
  if (!desde || !ate) return [];
  const canais: string[] = Array.isArray(ref.canais) && ref.canais.length
    ? ref.canais
    : ["ad_leads", "event_leads", "lp_leads", "link_page_leads"];
  const limite = Math.min(ref.limite ?? 10000, 20000);
  const desdeISO = desde;
  const ateISO = ate + "T23:59:59";
  const bySuffix = new Map<string, string>();
  for (const canal of canais) {
    const { data } = await supabase
      .from(canal)
      .select("phone, created_at")
      .gte("created_at", desdeISO)
      .lte("created_at", ateISO)
      .order("created_at", { ascending: false })
      .limit(limite);
    for (const r of (data ?? [])) {
      const suf = normalizePhoneSuffix8(r.phone);
      if (!suf || bySuffix.has(suf)) continue;
      bySuffix.set(suf, r.phone);
    }
  }
  if (ref.excluir_compradores) {
    const suffixes = Array.from(bySuffix.keys());
    for (let i = 0; i < suffixes.length; i += 500) {
      const chunk = suffixes.slice(i, i + 500);
      const { data: buyers } = await supabase
        .from("customers_unified")
        .select("phone_suffix8, total_orders")
        .in("phone_suffix8", chunk)
        .gt("total_orders", 0);
      for (const b of (buyers ?? [])) {
        if (b.phone_suffix8) bySuffix.delete(b.phone_suffix8);
      }
    }
  }
  return Array.from(bySuffix.values()).slice(0, limite);
}

async function executeReadTool(supabase: any, name: string, input: any): Promise<any> {
  if (name === "preview_audience") {
    const filtro = input?.filtro_json ?? {};
    const { data, error } = await supabase.rpc("list_campaign_audience", {
      p_filtro: filtro, p_limit: 50, p_offset: 0,
    });
    if (error) return { error: error.message };
    // total estimado extra (contagem real limitada a 5000 pra não estourar)
    const { data: bulk, error: e2 } = await supabase.rpc("list_campaign_audience", {
      p_filtro: filtro, p_limit: 5000, p_offset: 0,
    });
    if (e2) return { error: e2.message };
    return {
      total_estimado: bulk?.length ?? 0,
      total_truncado_em: 5000,
      sample: (data ?? []).slice(0, 50),
    };
  }
  if (name === "list_audiences") {
    const { data, error } = await supabase
      .from("campanha_publicos")
      .select("id, nome, filtro_json, updated_at")
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) return { error: error.message };
    return { publicos: data ?? [] };
  }
  if (name === "list_dispatches") {
    const limite = Math.min(input?.limite ?? 30, 100);
    const { data, error } = await supabase
      .from("dispatch_history")
      .select("id, campaign_name, template_name, started_at, completed_at, audience_source, total_recipients, sent_count, failed_count, status, provider, tipo_comunicacao, shadow_mode")
      .gte("started_at", input.desde)
      .lte("started_at", input.ate + "T23:59:59")
      .order("started_at", { ascending: false })
      .limit(limite);
    if (error) return { error: error.message };
    return { disparos: data ?? [] };
  }
  if (name === "get_dispatch_result") {
    const { result } = await analyzeDispatchResult(supabase, input);
    return result;
  }
  if (name === "get_leads_pool") {
    const canais: string[] = Array.isArray(input?.canais) && input.canais.length
      ? input.canais
      : ["ad_leads", "event_leads", "lp_leads", "link_page_leads"];
    const limite = Math.min(input?.limite ?? 5000, 10000);
    const desdeISO = input.desde;
    const ateISO = input.ate + "T23:59:59";

    const bySuffix = new Map<string, { phone: string; name: string | null; canal: string; created_at: string }>();

    for (const canal of canais) {
      const { data } = await supabase
        .from(canal)
        .select("phone, name, created_at")
        .gte("created_at", desdeISO)
        .lte("created_at", ateISO)
        .order("created_at", { ascending: false })
        .limit(limite);
      for (const r of (data ?? [])) {
        const suf = normalizePhoneSuffix8(r.phone);
        if (!suf) continue;
        if (!bySuffix.has(suf)) {
          bySuffix.set(suf, { phone: r.phone, name: r.name ?? null, canal, created_at: r.created_at });
        }
      }
    }

    let removedBuyers = 0;
    if (input?.excluir_compradores) {
      const suffixes = Array.from(bySuffix.keys());
      // Query customers_unified by suffix in chunks
      for (let i = 0; i < suffixes.length; i += 500) {
        const chunk = suffixes.slice(i, i + 500);
        const { data: buyers } = await supabase
          .from("customers_unified")
          .select("phone_suffix8, total_orders")
          .in("phone_suffix8", chunk)
          .gt("total_orders", 0);
        for (const b of (buyers ?? [])) {
          const suf = b.phone_suffix8;
          if (suf && bySuffix.delete(suf)) removedBuyers++;
        }

      }
    }

    const leads = Array.from(bySuffix.values()).slice(0, limite);
    return {
      total: leads.length,
      excluidos_por_ja_serem_compradores: removedBuyers,
      canais_consultados: canais,
      leads_sample: leads.slice(0, 200),
      all_phones: leads.map((l) => l.phone),
    };
  }

  const rpcMap: Record<string, { fn: string; args: (i: any) => any }> = {
    get_agent_memory: { fn: "get_agent_memory", args: (i) => ({ p_mes_ref: i.mes_ref ?? null }) },
    get_classificacao_summary: { fn: "get_classificacao_summary", args: () => ({}) },
    get_shadow_report: { fn: "get_shadow_report", args: (i) => ({ p_desde: i.desde, p_ate: i.ate }) },
    get_live_events_summary: { fn: "get_live_events_summary", args: (i) => ({ p_mes_ref: i.mes_ref }) },
    get_sales_vs_goals: { fn: "get_sales_vs_goals", args: (i) => ({ p_mes_ref: i.mes_ref }) },
    get_events_performance: { fn: "get_events_performance", args: (i) => ({ p_mes_ref: i.mes_ref }) },
    get_rfm_summary: { fn: "get_rfm_summary", args: () => ({}) },
    get_customer_lookup: { fn: "get_customer_lookup", args: (i) => ({ p_query: i.query }) },
    get_top_customers: { fn: "get_top_customers", args: (i) => ({ p_segmento: i.segmento ?? null, p_limite: i.limite ?? 20 }) },
    get_stock_by_size: { fn: "get_stock_by_size", args: (i) => ({ p_filtros: { marca: i.marca, categoria: i.categoria, min_estoque: i.min_estoque } }) },
    get_leads_by_channel: { fn: "get_leads_by_channel", args: (i) => ({ p_desde: i.desde, p_ate: i.ate }) },
    get_leads_lookup: { fn: "get_leads_lookup", args: (i) => ({ p_query: i.query ?? null, p_desde: i.desde ?? null, p_ate: i.ate ?? null }) },
    get_campaign_results: { fn: "get_campaign_results", args: (i) => ({ p_desde: i.desde, p_ate: i.ate }) },
    get_dispatch_pressure: { fn: "get_dispatch_pressure", args: (i) => ({ p_desde: i.desde, p_ate: i.ate }) },
  };
  const m = rpcMap[name];
  if (!m) return { error: `RPC ${name} não mapeada` };
  const { data, error } = await supabase.rpc(m.fn, m.args(input));
  if (error) return { error: error.message };
  return data;
}

async function commitProposal(supabase: any, kind: string, payload: any, conversationId: string) {
  if (kind === "propor_decisao") {
    const { data, error } = await supabase.from("agent_decisions").insert({
      conversation_id: conversationId,
      tipo: payload.tipo,
      descricao: payload.descricao,
      motivo: payload.motivo ?? null,
      contexto: payload.contexto ?? {},
    }).select().single();
    return error ? { error: error.message } : { ok: true, id: data.id };
  }
  if (kind === "propor_acao_calendario") {
    const { data, error } = await supabase.from("agent_calendar").insert({
      conversation_id: conversationId,
      mes_ref: payload.mes_ref,
      data: payload.data,
      tipo_acao: payload.tipo_acao,
      titulo: payload.titulo,
      descricao: payload.descricao ?? null,
      publico_alvo_descricao: payload.publico_alvo_descricao ?? null,
      custo_estimado_brl: payload.custo_estimado_brl ?? null,
    }).select().single();
    return error ? { error: error.message } : { ok: true, id: data.id };
  }
  if (kind === "propor_meta") {
    const monthBounds = getMonthBounds(payload.mes_ref);
    const store = await resolveStoreForGoal(supabase, payload.loja);

    // Fonte oficial: metas de loja/canal vivem no PDV (pos_goals).
    if (store && payload.loja !== "total") {
      await supabase
        .from("pos_goals")
        .update({ is_active: false })
        .eq("store_id", store.id)
        .eq("goal_type", "revenue")
        .is("seller_id", null)
        .eq("period", "custom")
        .lte("period_start", monthBounds.end)
        .gte("period_end", monthBounds.start);

      const { data, error } = await supabase.from("pos_goals").insert({
        store_id: store.id,
        seller_id: null,
        goal_type: "revenue",
        goal_value: payload.meta_faturamento_brl,
        period: "custom",
        period_start: monthBounds.start,
        period_end: monthBounds.end,
        is_active: true,
      }).select().single();
      return error ? { error: error.message } : { ok: true, id: data.id, fonte: "pos_goals", store: store.name };
    }

    // Fallback apenas para total consolidado ou canal sem loja cadastrada.
    const { data, error } = await supabase.from("monthly_goals").upsert({
      mes_ref: payload.mes_ref,
      loja: payload.loja,
      meta_faturamento_brl: payload.meta_faturamento_brl,
      observacao: payload.observacao ?? "Fallback: canal sem loja PDV mapeada",
    }, { onConflict: "mes_ref,loja" }).select().single();
    return error ? { error: error.message } : { ok: true, id: data.id, fonte: "monthly_goals" };
  }
  if (kind === "propor_entrada_calendario") {
    const { data, error } = await supabase.from("marketing_calendar_entries").insert({
      entry_date: payload.entry_date,
      end_date: payload.end_date ?? null,
      title: payload.title,
      content: payload.content ?? "",
      entry_type: payload.entry_type ?? "outro",
      color: payload.color ?? "#3b82f6",
    }).select().single();
    return error ? { error: error.message } : { ok: true, id: data.id, fonte: "marketing_calendar_entries" };
  }
  if (kind === "propor_meta_mensal_calendario") {
    const { data: existing } = await supabase
      .from("marketing_calendar_goals").select("id")
      .eq("year", payload.year).eq("month", payload.month).maybeSingle();
    const row = {
      year: payload.year,
      month: payload.month,
      goals: payload.goals ?? [],
      actions: payload.actions ?? "",
      notes: payload.notes ?? "",
    };
    if (existing?.id) {
      const { error } = await supabase.from("marketing_calendar_goals").update(row).eq("id", existing.id);
      return error ? { error: error.message } : { ok: true, id: existing.id, fonte: "marketing_calendar_goals", updated: true };
    }
    const { data, error } = await supabase.from("marketing_calendar_goals").insert(row).select().single();
    return error ? { error: error.message } : { ok: true, id: data.id, fonte: "marketing_calendar_goals", updated: false };
  }
  if (kind === "propor_publico") {
    // Valida filtro chamando list_campaign_audience antes de gravar.
    const filtro = payload.filtro_json ?? {};
    const { error: vErr } = await supabase.rpc("list_campaign_audience", {
      p_filtro: filtro, p_limit: 1, p_offset: 0,
    });
    if (vErr) return { error: `filtro_json inválido: ${vErr.message}` };
    const { data, error } = await supabase.from("campanha_publicos").insert({
      nome: payload.nome,
      filtro_json: filtro,
    }).select().single();
    return error ? { error: error.message } : { ok: true, id: data.id, fonte: "campanha_publicos" };
  }
  if (kind === "propor_atualizar_publico") {
    const update: any = {};
    if (payload.nome != null) update.nome = payload.nome;
    if (payload.filtro_json != null) {
      const { error: vErr } = await supabase.rpc("list_campaign_audience", {
        p_filtro: payload.filtro_json, p_limit: 1, p_offset: 0,
      });
      if (vErr) return { error: `filtro_json inválido: ${vErr.message}` };
      update.filtro_json = payload.filtro_json;
    }
    const { data, error } = await supabase.from("campanha_publicos")
      .update(update).eq("id", payload.id).select().single();
    return error ? { error: error.message } : { ok: true, id: data.id, fonte: "campanha_publicos" };
  }
  if (kind === "propor_publico_lista") {
    let phonesIn: any[] = Array.isArray(payload.phones) ? payload.phones : [];
    const sourceRefPayload = payload.source_ref ?? null;
    const src = payload.source ?? sourceRefPayload?.source ?? null;
    const rawInputCount = phonesIn.length;
    if (!phonesIn.length && (src === "dispatch_result" || Array.isArray(sourceRefPayload?.dispatch_ids))) {
      phonesIn = await resolveDispatchSourcePhones(supabase, sourceRefPayload);
    }
    if (!phonesIn.length && (src === "leads_pool" || (sourceRefPayload && (sourceRefPayload.desde || sourceRefPayload.canais)))) {
      phonesIn = await resolveLeadsPoolPhones(supabase, sourceRefPayload);
    }
    const resolvedCount = phonesIn.length;
    const seen = new Set<string>();
    const normalized: string[] = [];
    const suffixList: string[] = [];
    let invalidPhones = 0;
    for (const raw of phonesIn) {
      const e164 = normalizePhoneE164BR(raw);
      const suf = e164 ? e164.slice(-8) : normalizePhoneSuffix8(raw);
      if (!suf) { invalidPhones++; continue; }
      if (seen.has(suf)) continue;
      seen.add(suf);
      normalized.push(e164 || String(raw));
      suffixList.push(suf);
    }
    if (!normalized.length) {
      return {
        error: "Nenhum telefone válido na lista",
        diagnostico: {
          phones_recebidos_no_payload: rawInputCount,
          phones_resolvidos_via_source_ref: resolvedCount,
          phones_invalidos_descartados: invalidPhones,
          source: src,
          source_ref: sourceRefPayload,
          dica: resolvedCount === 0
            ? "source_ref não retornou telefones. Confirme desde/ate/canais em get_leads_pool ou dispatch_ids/bucket em get_dispatch_result antes de propor."
            : "Todos os telefones falharam na normalização BR. Verifique o formato de origem.",
        },
      };
    }

    // Enriquece nome via customers_unified (phone_suffix8) + fallback leads
    const nameBySuffix = new Map<string, string>();
    for (let i = 0; i < suffixList.length; i += 500) {
      const chunk = suffixList.slice(i, i + 500);
      const { data } = await supabase
        .from("customers_unified")
        .select("phone_suffix8, name")
        .in("phone_suffix8", chunk);
      for (const r of (data ?? []) as any[]) {
        const nm = String(r?.name ?? "").trim();
        if (r?.phone_suffix8 && nm && !nameBySuffix.has(r.phone_suffix8)) {
          nameBySuffix.set(r.phone_suffix8, nm);
        }
      }
    }
    const missingSuffixes = suffixList.filter((s) => !nameBySuffix.has(s));
    if (missingSuffixes.length && missingSuffixes.length <= 2000) {
      const missSet = new Set(missingSuffixes);
      for (const tbl of ["ad_leads", "event_leads", "lp_leads", "link_page_leads"]) {
        const { data } = await supabase.from(tbl).select("name, phone").limit(20000);
        for (const r of (data ?? []) as any[]) {
          const suf = normalizePhoneSuffix8(r?.phone);
          if (!suf || !missSet.has(suf) || nameBySuffix.has(suf)) continue;
          const nm = String(r?.name ?? "").trim();
          if (nm) nameBySuffix.set(suf, nm);
        }
      }
    }
    const entries = normalized.map((phone, i) => ({
      phone,
      name: nameBySuffix.get(suffixList[i]) || "",
    }));
    const withName = entries.filter((e) => e.name).length;

    const filtro = {
      mode: "phone_list",
      phones: normalized,
      entries,
      descricao: payload.descricao_curta ?? null,
      source: payload.source ?? sourceRefPayload?.source ?? "manual",
      source_ref: sourceRefPayload,
    };
    const { data, error } = await supabase.from("campanha_publicos").insert({
      nome: payload.nome,
      filtro_json: filtro,
    }).select().single();
    return error ? { error: error.message } : { ok: true, id: data.id, fonte: "campanha_publicos", total_telefones: normalized.length, com_nome: withName };
  }
  return { error: `kind desconhecido: ${kind}` };
}


function getMonthBounds(mesRef: string): { start: string; end: string } {
  const [year, month] = mesRef.split("-").map(Number);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(year, month, 0));
  const end = endDate.toISOString().slice(0, 10);
  return { start, end };
}

function normalizeStoreName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

async function resolveStoreForGoal(supabase: any, loja: string): Promise<{ id: string; name: string } | null> {
  if (loja === "total") return null;
  const { data } = await supabase
    .from("pos_stores")
    .select("id, name")
    .eq("is_active", true)
    .eq("is_simulation", false)
    .order("name");

  const stores = (data || []) as Array<{ id: string; name: string }>;
  const matches: Record<string, (name: string) => boolean> = {
    perola: (name) => name.includes("perola"),
    centro: (name) => name.includes("centro") && !name.includes("site"),
    shopify: (name) => name.includes("shopify"),
    live: (name) => name.includes("live"),
  };
  const predicate = matches[loja];
  return stores.find((s) => predicate?.(normalizeStoreName(s.name))) || null;
}

function buildSystemPrompt(): string {
  const now = new Date();
  const brNow = new Date(now.getTime() - 3 * 60 * 60 * 1000); // America/Sao_Paulo (UTC-3)
  const isoDate = brNow.toISOString().slice(0, 10);
  const mesRef = isoDate.slice(0, 7);
  const humano = brNow.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  return `Você é o "Estrategista de Marketing" da Banana Calçados, dentro do módulo Marketing → Calendário.

CONTEXTO TEMPORAL (fonte da verdade — NUNCA infira data de outra forma):
- Hoje é ${humano} (${isoDate}, America/Sao_Paulo).
- Mês de referência padrão para consultas mensais: ${mesRef}.
- Ao chamar tools com "mes_ref", use ${mesRef} salvo se o usuário pedir outro mês explicitamente.

QUEM VOCÊ FALA: o dono/gestor. Tom direto, analítico, pt-BR. Discorda com DADOS quando necessário. Nunca elogia por elogiar. Confirma antes de gravar qualquer coisa.

O QUE VOCÊ PODE FAZER:
- Ler: use as tools get_* para consultar métricas reais (nunca invente números). SEMPRE chame get_agent_memory PRIMEIRO em cada nova conversa.
- Base de clientes: get_rfm_summary (visão macro RFM + tamanhos + regiões + mapa de calor), get_customer_lookup (ficha individual por tel/CPF/nome/@/email), get_top_customers (ranking por gasto, filtrável por segmento RFM).
- TAMANHO DE CALÇADO: use SEMPRE o campo purchased_sizes (array de tamanhos efetivamente comprados) — é a MESMA base usada pelo filtro "Tamanho" em PDV > Online > Automação (Público). O campo scalar shoe_size é legado/parcial e cobre só ~600 clientes; purchased_sizes cobre 3.000+. Ao dizer "X clientes calçam 36", use a chave "36" de por_tamanho de get_rfm_summary.
- MAPA DE CALOR = por_calor de get_rfm_summary (lead_temperature: quente/morno/frio/etc) OU rfm_segment (campeões > leais > potenciais > em_risco > hibernando > perdidos). Ambos disponíveis em get_customer_lookup/get_top_customers.
- Base de leads: get_leads_by_channel (contagem) e get_leads_lookup (detalhes cruzando ad_leads/event_leads/lp_leads/link_page_leads — traz temperatura e tamanho quando existe).
- Escrever (com confirmação em DOIS PASSOS):
  1) Você chama uma tool de proposta (propor_*).
  2) O usuário responde "ok"/"confirma"/"grava" mencionando O ITEM.
  3) Só então a proposta vira real (o sistema faz o commit no próximo turn).
- Se o usuário mudar de assunto sem confirmar, a proposta expira. NÃO grave retroativamente.
- Quando houver múltiplas propostas em aberto, pergunte QUAL o "ok" cobre.

CALENDÁRIO DE MARKETING (aba Calendário):
- Para criar um evento visível na aba Calendário (live, campanha, lembrete, meta, outro), use propor_entrada_calendario (grava em marketing_calendar_entries). É o caminho oficial.
- Para gravar metas/anotações do MÊS (objetivos, ações planejadas, notas), use propor_meta_mensal_calendario (upsert em marketing_calendar_goals por year+month).
- propor_acao_calendario continua existindo, mas é apenas rascunho interno do agente (agent_calendar). Prefira as duas tools acima quando o usuário quer ver no calendário real.

PÚBLICOS REUTILIZÁVEIS (campanha_publicos):
- Você pode criar/atualizar públicos que aparecem automaticamente em: PDV > Online > Automação, Marketing > Disparos e Matriz RFM.
- Fluxo obrigatório para criar público:
  1) Chame list_audiences para não duplicar público existente.
  2) Monte o filtro_json usando SOMENTE estas chaves (dentro de include e/ou exclude):
     sizes, categories, brands, stores, payment_methods, cities, ddds, states, rfm_segments, tags,
     in_vip_group (bool), min_avg_ticket, max_avg_ticket, min_total_orders, max_total_orders,
     last_purchase_op (gt_days|lt_days|after|before|between), last_purchase_days, last_purchase_from, last_purchase_to,
     first_purchase_op, first_purchase_days, first_purchase_from, first_purchase_to.
  3) Chame preview_audience(filtro_json) para obter total_estimado e amostra.
  4) Mostre ao usuário o total + amostra e pergunte se pode gravar.
  5) Chame propor_publico(nome, filtro_json, descricao_curta). Só grava após "ok".
- NUNCA invente segmento RFM — use apenas os que aparecerem em get_rfm_summary.por_segmento.
- Tamanhos vão como strings (ex.: "36", "37"). DDDs como strings ("33", "31").
- Para editar público existente use propor_atualizar_publico (id obrigatório).

PÚBLICOS POR LISTA FIXA DE TELEFONES (quando o filtro padrão NÃO cobre):
- Use quando o público for baseado em resultado de disparo (converteu / não converteu / respondeu / engajou) OU em leads que ainda não existem em customers_unified.
- Fluxo:
  1) Descubra a base: list_dispatches(desde, ate) para pegar IDs; depois get_dispatch_result(dispatch_ids) para buckets (engaged/read/converted/not_converted/replied). OU get_leads_pool(desde, ate, excluir_compradores) para leads frescos.
  2) Escolha o bucket certo. Explique ao usuário quantos telefones e como foram obtidos (ex.: "leads captados 10–20/jul que ainda não compraram — 342 telefones").
  3) Para buckets de disparo, chame propor_publico_lista(nome, source="dispatch_result", source_ref=<source_ref do bucket>, descricao_curta). NÃO dependa de sample_phones para público final — sample é só amostra.
- O público criado aparece em Marketing → Disparos exatamente como um público normal (com badge "lista fixa"). Não passa por filtro RFM/geografia — a lista é a verdade.
- Não misture: se o público CABE nos filtros padrão (tamanho, RFM, cidade), prefira propor_publico. phone_list é para o que NÃO cabe.

REGRA CRÍTICA — NUNCA "prometa e pare":
- Se você decidir usar phone_list (por qualquer motivo — filtro RFM voltou 0, público não cabe nos filtros, usuário pediu público derivado de disparo), você DEVE emitir o tool_use propor_publico_lista NO MESMO TURNO em que anuncia a decisão. NUNCA escreva "vou criar via lista fixa" em texto sem também chamar a tool naquele turno — isso deixa a proposta sem gravar e o usuário sem o público.
- Se preview_audience retornar 0 (ou filtro CRM claramente errado), NÃO tente montar 5 variações do filtro. Vá direto para phone_list usando source_ref de get_dispatch_result ou phones de get_leads_pool e emita propor_publico_lista imediatamente.
- Quando o usuário confirmou criar MÚLTIPLOS públicos, emita todos os propor_publico_lista (ou propor_publico) NO MESMO TURNO em paralelo. Não faça um por vez esperando reconfirmação — a confirmação já foi dada.
- Antes de responder texto puro sem tool_use, cheque: "o usuário está esperando gravação AGORA?". Se sim e você não chamou nenhuma tool de proposta neste turno, você errou — chame antes de escrever o texto final.

REGRA CRÍTICA — DATAS E IDS REAIS:
- ANO é SEMPRE ${isoDate.slice(0,4)}. NUNCA use 2024/2025 em desde/ate quando o disparo ocorreu em ${isoDate.slice(0,4)}. Se em dúvida, use o ano de CONTEXTO TEMPORAL.
- NUNCA invente dispatch_ids. Se o usuário citar campanhas pelo NOME, chame list_dispatches(desde, ate) NO MESMO TURNO e use os IDs reais retornados. Passar UUID adivinhado para get_dispatch_result é erro grave — o tool devolverá erro explícito.
- Se get_dispatch_result retornar {error:"Nenhum dispatch_history..."} ou {error:"IDs inexistentes..."}, PARE de inventar — chame list_dispatches e refaça com o ID correto no mesmo turno.






FONTES DE METAS (caminho oficial — siga exatamente):
- Metas oficiais vêm de public.pos_goals (PDV) ligadas por store_id em public.pos_stores.
- Caminho de leitura: get_agent_memory(${mesRef}) e get_sales_vs_goals(${mesRef}) → ambos leem pos_goals + pos_stores.
- pos_goals cobre metas MENSAIS/CUSTOM por LOJA (store_id não nulo, seller_id nulo) E metas por VENDEDORA (seller_id não nulo). Sempre considere as duas dimensões antes de dizer "não há meta".
- Para julho/2026 já existem metas PDV: Site/Live (ex-Tiny Shopify) R$ 60.000, Loja Centro R$ 40.000, Loja Perola R$ 95.000. Se a tool divergir disso, trate como erro técnico e cite o caminho pos_goals.
- monthly_goals NÃO é fonte oficial de metas de loja. É apenas fallback para total consolidado ou canal sem loja PDV mapeada.
- Se realmente não houver meta em pos_goals para um canal, avise e proponha antes de assumir números.

REGRA CRÍTICA — LIVE vs LOJAS FÍSICAS (evita duplo-contagem):
- Vendas de Live (sale_type=live/live_shopping) muitas vezes são registradas dentro de uma loja física (Pérola ou Centro). A tool get_sales_vs_goals já separa isso:
  - realizado_loja_pura = balcão puro daquela loja (SEM Live). USE ESSE para performance da loja física.
  - live_embutida_na_loja = quanto de Live foi rung na loja (informativo, para explicar composição).
  - realizado_total_incluindo_live = soma dos dois (só cite se o usuário perguntar composição).
  - O canal "live" agrega TODAS as vendas Live (de qualquer loja). Nunca some live com o total das lojas físicas — isso seria duplo-contagem.
- META de Live = MESMA meta da loja Site/Live (ex-Tiny Shopify). A tool já espelha automaticamente quando não há meta própria (fonte_meta="espelhada_shopify"). Para reportar meta digital consolidada, use shopify_mais_live (realizado_combinado vs meta). Pedidos de eventos do canal "site" agora são roteados automaticamente para a loja Site/Live como sale_type=live.
- Para entender qual evento/live individual performou melhor, chame get_events_performance(mes_ref) — traz por event_id, canal, receita paga e conversão.

CUSTO DE DISPARO (regra oficial):
- Mensagens de campanha que MENCIONAM PRODUTO (marketing/promocional Meta): R$ 0,40 por mensagem entregue.
- Mensagens utilitárias/serviço (confirmação, atendimento): custo desprezível — considere R$ 0.
- Ao estimar custo de uma ação, multiplique tamanho do público × R$ 0,40 (nunca R$ 0,20).

RESTRIÇÕES:
- Você NÃO envia mensagens, NÃO dispara campanhas, NÃO altera estoque.
- Sempre cite a fonte (nome da tool) quando apresentar um número.
- Faça agregações por período; não peça dumps enormes.
- Se detectar contradição com um veto ou regra ativa: alerte e proponha alternativa.

FORMATO: markdown curto, listas, negritos em números-chave. Sem emojis excessivos.`;
}
const SYSTEM_PROMPT_FALLBACK = "Estrategista de Marketing da Banana Calçados.";

function isConfirmation(text: string): boolean {
  const t = text.toLowerCase().trim();
  return /\b(ok|confirmo|confirma|pode gravar|grava|sim.{0,10}(pode|grava)|aprovado|confirmado|manda ver)\b/.test(t);
}

// ---------- ANTHROPIC ----------
async function callAnthropic(apiKey: string, model: string, system: string, messages: any[]) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system,
      tools: TOOLS_ANTHROPIC,
      messages,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    const err: any = new Error(`Anthropic ${res.status}: ${errText.slice(0, 300)}`);
    err.status = res.status;
    err.body = errText;
    throw err;
  }
  return await res.json();
}

// Erros da Anthropic que devem cair no fallback (não retentar).
function shouldFallbackFromAnthropic(err: any): boolean {
  if (!err) return false;
  const status = err.status;
  const body = String(err.body || err.message || "");
  if (status === 401 || status === 403) return true; // auth
  if (status === 402) return true;
  if (/credit balance|billing|insufficient|quota/i.test(body)) return true;
  return false;
}

// ---------- LOVABLE AI GATEWAY (OpenAI-compat) ----------
async function callGateway(apiKey: string, model: string, messages: any[]) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "Lovable-API-Key": apiKey,
      },
      body: JSON.stringify({ model, messages, tools: TOOLS_OPENAI, tool_choice: "auto" }),
    });
    if (res.ok) return await res.json();
    const errText = await res.text();
    console.error(`Gateway ${res.status}:`, errText.slice(0, 400));
    if (res.status === 429) throw new Error("Limite de requisições atingido. Tente novamente em instantes.");
    if (res.status === 402) throw new Error("Créditos de IA esgotados. Adicione créditos no workspace.");
    if (res.status >= 500 && attempt < 3) { await sleep(600 * attempt); continue; }
    throw new Error(`Gateway ${res.status}: ${errText.slice(0, 200)}`);
  }
  throw new Error("Gateway exhausted retries");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!ANTHROPIC_API_KEY && !LOVABLE_API_KEY) {
      throw new Error("Nenhum provedor de IA configurado (ANTHROPIC_API_KEY ou LOVABLE_API_KEY).");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { conversationId: incomingConvId, userMessage } = await req.json();
    if (!userMessage) throw new Error("userMessage obrigatório");

    // Modelo dinâmico: guarda tanto o modelo Anthropic quanto o fallback do gateway.
    const { data: modelSetting } = await supabase
      .from("app_settings").select("value").eq("key", "agent_model").maybeSingle();
    const cfg: any = modelSetting?.value || {};
    const anthropicModel = cfg.anthropic_model || (typeof cfg.model === "string" && cfg.model.startsWith("claude") ? cfg.model : "claude-sonnet-4-5");
    const gatewayModel = cfg.gateway_model || (typeof cfg.model === "string" && !cfg.model.startsWith("claude") ? cfg.model : "google/gemini-2.5-pro");

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    let createdBy: string | null = null;
    if (jwt) {
      const { data: u } = await supabase.auth.getUser(jwt);
      createdBy = u?.user?.id ?? null;
    }

    let conversationId = incomingConvId;
    if (!conversationId) {
      const titulo = userMessage.slice(0, 80);
      const { data, error } = await supabase.from("agent_conversations")
        .insert({ titulo, created_by: createdBy }).select().single();
      if (error) throw error;
      conversationId = data.id;
    }

    await supabase.from("agent_messages").insert({
      conversation_id: conversationId, role: "user", content: userMessage,
    });

    const { data: recentMsgs } = await supabase
      .from("agent_messages").select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false }).limit(20);

    const committedThisTurn: any[] = [];
    if (isConfirmation(userMessage) && recentMsgs) {
      const lastProposal = recentMsgs.find((m: any) => m.pending_confirmation && !m.pending_confirmation.committed);
      if (lastProposal) {
        const p = lastProposal.pending_confirmation;
        const result = await commitProposal(supabase, p.kind, p.payload, conversationId);
        committedThisTurn.push({ kind: p.kind, payload: p.payload, result });
        await supabase.from("agent_messages").update({
          pending_confirmation: { ...p, committed: true, committed_at: new Date().toISOString() },
        }).eq("id", lastProposal.id);
      }
    }

    const history = (recentMsgs ?? []).slice().reverse()
      .filter((m: any) => (m.role === "user" || m.role === "assistant") && m.content)
      .map((m: any) => ({ role: m.role, content: m.content }));

    if (committedThisTurn.length > 0) {
      history.push({
        role: "user",
        content: `[SISTEMA] O usuário confirmou. Ações gravadas: ${JSON.stringify(committedThisTurn)}. Confirme brevemente ao usuário.`,
      });
    }

    // Decide provedor
    const useAnthropic = !!ANTHROPIC_API_KEY;
    let provider: "anthropic" | "gateway" = useAnthropic ? "anthropic" : "gateway";

    const executedTools: any[] = [];
    let pendingProposal: any = null;
    let finalText = "";

    async function runAnthropic(): Promise<void> {
      const msgs: any[] = history.map((m: any) => ({ role: m.role, content: m.content }));
      let steps = 0;
      while (steps < 16) {
        steps++;
        const resp = await callAnthropic(ANTHROPIC_API_KEY!, anthropicModel, buildSystemPrompt(), msgs);
        const blocks: any[] = resp.content || [];
        const textBlocks = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
        const toolUses = blocks.filter((b) => b.type === "tool_use");
        if (textBlocks) finalText = textBlocks;
        if (toolUses.length === 0) return;

        msgs.push({ role: "assistant", content: blocks });
        const toolResults: any[] = [];
        for (const tu of toolUses) {
          let result: any;
          if (READ_TOOLS.has(tu.name)) {
            result = await executeReadTool(supabase, tu.name, tu.input || {});
            executedTools.push({ name: tu.name, input: tu.input });
          } else if (PROPOSAL_TOOLS.has(tu.name)) {
            pendingProposal = { kind: tu.name, payload: tu.input };
            result = { proposta_registrada: true, aguardando: "confirmação explícita do usuário no próximo turn", resumo: tu.input };
          } else {
            result = { error: `Tool desconhecida: ${tu.name}` };
          }
          toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result) });
        }
        msgs.push({ role: "user", content: toolResults });
      }
    }

    async function runGateway(): Promise<void> {
      const msgs: any[] = [{ role: "system", content: buildSystemPrompt() }, ...history];
      let steps = 0;
      while (steps < 16) {
        steps++;
        const resp = await callGateway(LOVABLE_API_KEY!, gatewayModel, msgs);
        const msg = resp.choices?.[0]?.message;
        if (!msg) return;
        const toolCalls = msg.tool_calls || [];
        finalText = (msg.content || "").trim() || finalText;
        if (toolCalls.length === 0) return;
        msgs.push({ role: "assistant", content: msg.content ?? "", tool_calls: toolCalls });
        for (const tc of toolCalls) {
          const name = tc.function?.name;
          let input: any = {};
          try { input = JSON.parse(tc.function?.arguments || "{}"); } catch { /* ignore */ }
          let result: any;
          if (READ_TOOLS.has(name)) {
            result = await executeReadTool(supabase, name, input);
            executedTools.push({ name, input });
          } else if (PROPOSAL_TOOLS.has(name)) {
            pendingProposal = { kind: name, payload: input };
            result = { proposta_registrada: true, aguardando: "confirmação explícita do usuário no próximo turn", resumo: input };
          } else {
            result = { error: `Tool desconhecida: ${name}` };
          }
          msgs.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
        }
      }
    }

    if (useAnthropic) {
      try {
        await runAnthropic();
      } catch (e: any) {
        if (shouldFallbackFromAnthropic(e) && LOVABLE_API_KEY) {
          console.warn("Anthropic indisponível, caindo para Lovable AI Gateway:", e.message);
          provider = "gateway";
          // reseta estado parcial
          executedTools.length = 0;
          pendingProposal = null;
          finalText = "";
          await runGateway();
        } else {
          throw e;
        }
      }
    } else {
      await runGateway();
    }

    await supabase.from("agent_messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: finalText || "(sem resposta)",
      tool_calls: executedTools.length ? { tools: executedTools, provider } : { provider },
      pending_confirmation: pendingProposal ? { ...pendingProposal, created_at: new Date().toISOString() } : null,
    });

    await supabase.from("agent_conversations")
      .update({ last_message_at: new Date().toISOString() }).eq("id", conversationId);

    return new Response(JSON.stringify({
      conversationId,
      reply: finalText,
      toolCalls: executedTools,
      pendingProposal,
      committed: committedThisTurn,
      provider,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("marketing-agent-chat error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
