import { Hono } from "hono";
import { McpServer, StreamableHttpTransport } from "mcp-lite";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const AGENT_KEY = "bnn-agent-2f8a9c4e7b1d3f6a";

function getSupabase() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

const mcpServer = new McpServer({
  name: "banana-calcados-mcp",
  version: "1.0.0",
});

// ─── READ TOOLS ───────────────────────────────────────────

mcpServer.tool({
  name: "list_events",
  description: "Lista todos os eventos/lives. Filtros opcionais: is_active (boolean).",
  inputSchema: {
    type: "object",
    properties: {
      is_active: { type: "boolean", description: "Filtrar por eventos ativos" },
      limit: { type: "number", description: "Limite de resultados (default 50)" },
    },
  },
  handler: async ({ is_active, limit }: any) => {
    const sb = getSupabase();
    let q = sb.from("events").select("*").order("created_at", { ascending: false }).limit(limit || 50);
    if (is_active !== undefined) q = q.eq("is_active", is_active);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: `Erro: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool({
  name: "get_event",
  description: "Busca detalhes de um evento por ID, incluindo catálogo associado.",
  inputSchema: {
    type: "object",
    properties: { event_id: { type: "string", description: "UUID do evento" } },
    required: ["event_id"],
  },
  handler: async ({ event_id }: any) => {
    const sb = getSupabase();
    const { data, error } = await sb.from("events").select("*, catalog_lead_pages(*)").eq("id", event_id).single();
    if (error) return { content: [{ type: "text", text: `Erro: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool({
  name: "get_active_product",
  description: "Retorna o produto atualmente ativo em uma live/evento.",
  inputSchema: {
    type: "object",
    properties: { event_id: { type: "string", description: "UUID do evento" } },
    required: ["event_id"],
  },
  handler: async ({ event_id }: any) => {
    const sb = getSupabase();
    const { data: ev } = await sb.from("events").select("name, catalog_lead_page_id").eq("id", event_id).single();
    if (!ev?.catalog_lead_page_id) return { content: [{ type: "text", text: "Evento sem catálogo associado" }] };
    const { data: cat } = await sb.from("catalog_lead_pages").select("title, slug, selected_product_ids").eq("id", ev.catalog_lead_page_id).single();
    const ids = cat?.selected_product_ids || [];
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          evento: ev.name,
          produto_ativo_id: ids[0] || null,
          todos_produto_ids: ids,
          total_produtos: ids.length,
          catalogo: { titulo: cat?.title, slug: cat?.slug },
        }, null, 2),
      }],
    };
  },
});

mcpServer.tool({
  name: "list_orders",
  description: "Lista pedidos com filtros. Retorna pedidos com dados do cliente.",
  inputSchema: {
    type: "object",
    properties: {
      event_id: { type: "string", description: "Filtrar por evento" },
      stage: { type: "string", description: "Filtrar por estágio (new, awaiting_confirmation, confirmed, paid, shipped, cancelled, incomplete_order)" },
      customer_instagram: { type: "string", description: "Filtrar por Instagram do cliente" },
      limit: { type: "number", description: "Limite (default 50)" },
      offset: { type: "number", description: "Offset para paginação" },
    },
  },
  handler: async ({ event_id, stage, customer_instagram, limit, offset }: any) => {
    const sb = getSupabase();
    let q = sb.from("orders").select("*, customers(*)").order("created_at", { ascending: false }).limit(limit || 50);
    if (offset) q = q.range(offset, offset + (limit || 50) - 1);
    if (event_id) q = q.eq("event_id", event_id);
    if (stage) q = q.eq("stage", stage);
    if (customer_instagram) {
      const { data: cust } = await sb.from("customers").select("id").ilike("instagram_handle", `%${customer_instagram.replace("@", "")}%`);
      if (cust?.length) q = q.in("customer_id", cust.map((c: any) => c.id));
      else return { content: [{ type: "text", text: "Nenhum cliente encontrado com esse Instagram" }] };
    }
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: `Erro: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool({
  name: "get_order",
  description: "Busca um pedido específico por ID com dados do cliente e registro de cadastro.",
  inputSchema: {
    type: "object",
    properties: { order_id: { type: "string", description: "UUID do pedido" } },
    required: ["order_id"],
  },
  handler: async ({ order_id }: any) => {
    const sb = getSupabase();
    const { data, error } = await sb.from("orders").select("*, customers(*), customer_registrations(*)").eq("id", order_id).single();
    if (error) return { content: [{ type: "text", text: `Erro: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool({
  name: "list_customers",
  description: "Lista clientes. Busca por Instagram ou WhatsApp.",
  inputSchema: {
    type: "object",
    properties: {
      search: { type: "string", description: "Buscar por Instagram ou WhatsApp" },
      limit: { type: "number", description: "Limite (default 50)" },
    },
  },
  handler: async ({ search, limit }: any) => {
    const sb = getSupabase();
    let q = sb.from("customers").select("*").order("created_at", { ascending: false }).limit(limit || 50);
    if (search) {
      const clean = search.replace("@", "");
      q = q.or(`instagram_handle.ilike.%${clean}%,whatsapp.ilike.%${clean}%`);
    }
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: `Erro: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool({
  name: "get_customer",
  description: "Busca um cliente por ID.",
  inputSchema: {
    type: "object",
    properties: { customer_id: { type: "string", description: "UUID do cliente" } },
    required: ["customer_id"],
  },
  handler: async ({ customer_id }: any) => {
    const sb = getSupabase();
    const { data, error } = await sb.from("customers").select("*").eq("id", customer_id).single();
    if (error) return { content: [{ type: "text", text: `Erro: ${error.message}` }] };
    // Also fetch orders
    const { data: orders } = await sb.from("orders").select("id, stage, products, created_at, event_id").eq("customer_id", customer_id).order("created_at", { ascending: false }).limit(20);
    return { content: [{ type: "text", text: JSON.stringify({ ...data, recent_orders: orders }, null, 2) }] };
  },
});

mcpServer.tool({
  name: "list_conversations",
  description: "Lista conversas do WhatsApp com última mensagem e contagem de não lidas.",
  inputSchema: {
    type: "object",
    properties: {
      whatsapp_number_id: { type: "string", description: "Filtrar por instância WhatsApp (UUID)" },
      limit: { type: "number", description: "Limite (default 30)" },
    },
  },
  handler: async ({ whatsapp_number_id, limit }: any) => {
    const sb = getSupabase();
    const { data, error } = await sb.rpc("get_conversations", { p_number_id: whatsapp_number_id || null });
    if (error) return { content: [{ type: "text", text: `Erro: ${error.message}` }] };
    const limited = (data || []).slice(0, limit || 30);
    return { content: [{ type: "text", text: JSON.stringify(limited, null, 2) }] };
  },
});

mcpServer.tool({
  name: "get_messages",
  description: "Busca mensagens de uma conversa WhatsApp por telefone.",
  inputSchema: {
    type: "object",
    properties: {
      phone: { type: "string", description: "Telefone (ex: 5533999999999)" },
      limit: { type: "number", description: "Limite (default 50)" },
      whatsapp_number_id: { type: "string", description: "UUID da instância WhatsApp" },
    },
    required: ["phone"],
  },
  handler: async ({ phone, limit, whatsapp_number_id }: any) => {
    const sb = getSupabase();
    let q = sb.from("whatsapp_messages").select("*").eq("phone", phone).order("created_at", { ascending: false }).limit(limit || 50);
    if (whatsapp_number_id) q = q.eq("whatsapp_number_id", whatsapp_number_id);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: `Erro: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify(data?.reverse(), null, 2) }] };
  },
});

mcpServer.tool({
  name: "list_products",
  description: "Lista produtos do POS com estoque. Busca por nome, SKU ou código de barras.",
  inputSchema: {
    type: "object",
    properties: {
      store_id: { type: "string", description: "UUID da loja" },
      search: { type: "string", description: "Buscar por nome, SKU ou barcode" },
      limit: { type: "number", description: "Limite (default 50)" },
    },
  },
  handler: async ({ store_id, search, limit }: any) => {
    const sb = getSupabase();
    if (search && store_id) {
      const { data, error } = await sb.rpc("search_products_unaccent", { search_term: search, p_store_id: store_id });
      if (error) return { content: [{ type: "text", text: `Erro: ${error.message}` }] };
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
    let q = sb.from("pos_products").select("*").eq("is_active", true).order("name").limit(limit || 50);
    if (store_id) q = q.eq("store_id", store_id);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: `Erro: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool({
  name: "list_stores",
  description: "Lista lojas físicas cadastradas.",
  inputSchema: { type: "object", properties: {} },
  handler: async () => {
    const sb = getSupabase();
    const { data, error } = await sb.from("pos_stores").select("*").eq("is_active", true);
    if (error) return { content: [{ type: "text", text: `Erro: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool({
  name: "list_whatsapp_numbers",
  description: "Lista instâncias/números de WhatsApp configurados.",
  inputSchema: { type: "object", properties: {} },
  handler: async () => {
    const sb = getSupabase();
    const { data, error } = await sb.from("whatsapp_numbers").select("id, label, phone, provider, is_active");
    if (error) return { content: [{ type: "text", text: `Erro: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool({
  name: "list_expedition_orders",
  description: "Lista pedidos de expedição com filtros de status.",
  inputSchema: {
    type: "object",
    properties: {
      expedition_status: { type: "string", description: "pending, picking, packed, invoiced, shipped, delivered" },
      limit: { type: "number", description: "Limite (default 50)" },
    },
  },
  handler: async ({ expedition_status, limit }: any) => {
    const sb = getSupabase();
    let q = sb.from("expedition_beta_orders").select("*, expedition_beta_order_items(*)").order("created_at", { ascending: false }).limit(limit || 50);
    if (expedition_status) q = q.eq("expedition_status", expedition_status);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: `Erro: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool({
  name: "get_event_stats",
  description: "Retorna estatísticas de um evento: total pedidos por estágio, faturamento, clientes únicos.",
  inputSchema: {
    type: "object",
    properties: { event_id: { type: "string", description: "UUID do evento" } },
    required: ["event_id"],
  },
  handler: async ({ event_id }: any) => {
    const sb = getSupabase();
    const { data: orders, error } = await sb.from("orders").select("stage, products, customer_id").eq("event_id", event_id);
    if (error) return { content: [{ type: "text", text: `Erro: ${error.message}` }] };
    const stats: Record<string, number> = {};
    let revenue = 0;
    const uniqueCustomers = new Set<string>();
    for (const o of orders || []) {
      stats[o.stage] = (stats[o.stage] || 0) + 1;
      uniqueCustomers.add(o.customer_id);
      if (["confirmed", "paid", "shipped"].includes(o.stage)) {
        const prods = (o.products as any[]) || [];
        for (const p of prods) revenue += (p.price || 0) * (p.quantity || 1);
      }
    }
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          total_orders: (orders || []).length,
          by_stage: stats,
          estimated_revenue: revenue,
          unique_customers: uniqueCustomers.size,
        }, null, 2),
      }],
    };
  },
});

mcpServer.tool({
  name: "list_campaigns",
  description: "Lista campanhas de marketing.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", description: "draft, active, paused, completed" },
      limit: { type: "number", description: "Limite (default 20)" },
    },
  },
  handler: async ({ status, limit }: any) => {
    const sb = getSupabase();
    let q = sb.from("marketing_campaigns").select("*").order("created_at", { ascending: false }).limit(limit || 20);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: `Erro: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool({
  name: "list_automation_flows",
  description: "Lista fluxos de automação de WhatsApp.",
  inputSchema: {
    type: "object",
    properties: {
      is_active: { type: "boolean", description: "Filtrar por ativos" },
    },
  },
  handler: async ({ is_active }: any) => {
    const sb = getSupabase();
    let q = sb.from("automation_flows").select("*, automation_steps(*)").order("created_at", { ascending: false });
    if (is_active !== undefined) q = q.eq("is_active", is_active);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: `Erro: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
});

// ─── WRITE TOOLS ──────────────────────────────────────────

mcpServer.tool({
  name: "create_order",
  description: "Cria um novo pedido. Se faltar dados, cria como 'incomplete_order'. Se completo, cria como 'awaiting_confirmation'.",
  inputSchema: {
    type: "object",
    properties: {
      evento_id: { type: "string", description: "UUID do evento" },
      cliente_instagram: { type: "string", description: "@ do Instagram do cliente" },
      cliente_whatsapp: { type: "string", description: "WhatsApp do cliente (5533...)" },
      produto_shopify_id: { type: "string", description: "ID do produto no Shopify" },
      variante_sku: { type: "string", description: "SKU da variante" },
      tamanho: { type: "string", description: "Tamanho" },
      cor: { type: "string", description: "Cor" },
      observacao: { type: "string", description: "Observações" },
    },
  },
  handler: async (params: any) => {
    // Delegate to the existing edge function
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/criar-pedido-externo`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-key": AGENT_KEY,
      },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool({
  name: "update_order",
  description: "Atualiza um pedido existente: mudar estágio, adicionar notas, atualizar produtos.",
  inputSchema: {
    type: "object",
    properties: {
      order_id: { type: "string", description: "UUID do pedido" },
      stage: { type: "string", description: "Novo estágio: new, awaiting_confirmation, confirmed, paid, shipped, cancelled" },
      notes: { type: "string", description: "Notas/observações" },
      products: {
        type: "array",
        description: "Array de produtos (substitui os existentes)",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            variant: { type: "string" },
            price: { type: "number" },
            quantity: { type: "number" },
            sku: { type: "string" },
            shopifyId: { type: "string" },
          },
        },
      },
    },
    required: ["order_id"],
  },
  handler: async ({ order_id, stage, notes, products }: any) => {
    const sb = getSupabase();
    const updates: Record<string, any> = {};
    if (stage) updates.stage = stage;
    if (notes !== undefined) updates.notes = notes;
    if (products) updates.products = products;
    if (Object.keys(updates).length === 0) {
      return { content: [{ type: "text", text: "Nenhum campo para atualizar" }] };
    }
    const { data, error } = await sb.from("orders").update(updates).eq("id", order_id).select("id, stage, notes").single();
    if (error) return { content: [{ type: "text", text: `Erro: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify({ success: true, ...data }, null, 2) }] };
  },
});

mcpServer.tool({
  name: "create_customer",
  description: "Cria ou atualiza um cliente pelo Instagram handle.",
  inputSchema: {
    type: "object",
    properties: {
      instagram_handle: { type: "string", description: "@ do Instagram (sem @)" },
      whatsapp: { type: "string", description: "WhatsApp (5533...)" },
      tags: { type: "array", items: { type: "string" }, description: "Tags do cliente" },
    },
    required: ["instagram_handle"],
  },
  handler: async ({ instagram_handle, whatsapp, tags }: any) => {
    const sb = getSupabase();
    const handle = instagram_handle.replace("@", "");
    const { data: existing } = await sb.from("customers").select("id").eq("instagram_handle", handle).maybeSingle();
    if (existing) {
      const updates: Record<string, any> = {};
      if (whatsapp) updates.whatsapp = whatsapp;
      if (tags) updates.tags = tags;
      const { data, error } = await sb.from("customers").update(updates).eq("id", existing.id).select().single();
      if (error) return { content: [{ type: "text", text: `Erro: ${error.message}` }] };
      return { content: [{ type: "text", text: JSON.stringify({ action: "updated", ...data }, null, 2) }] };
    }
    const { data, error } = await sb.from("customers").insert({
      instagram_handle: handle,
      whatsapp: whatsapp || null,
      tags: tags || null,
      is_banned: false,
    }).select().single();
    if (error) return { content: [{ type: "text", text: `Erro: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify({ action: "created", ...data }, null, 2) }] };
  },
});

mcpServer.tool({
  name: "update_customer",
  description: "Atualiza dados de um cliente por ID.",
  inputSchema: {
    type: "object",
    properties: {
      customer_id: { type: "string", description: "UUID do cliente" },
      whatsapp: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      is_banned: { type: "boolean" },
      ban_reason: { type: "string" },
    },
    required: ["customer_id"],
  },
  handler: async ({ customer_id, ...updates }: any) => {
    const sb = getSupabase();
    const clean: Record<string, any> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined) clean[k] = v;
    }
    const { data, error } = await sb.from("customers").update(clean).eq("id", customer_id).select().single();
    if (error) return { content: [{ type: "text", text: `Erro: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify({ success: true, ...data }, null, 2) }] };
  },
});

mcpServer.tool({
  name: "send_whatsapp",
  description: "Envia mensagem de WhatsApp para um número via Z-API.",
  inputSchema: {
    type: "object",
    properties: {
      phone: { type: "string", description: "Telefone destino (5533999999999)" },
      message: { type: "string", description: "Texto da mensagem" },
      whatsapp_number_id: { type: "string", description: "UUID da instância WhatsApp (usar list_whatsapp_numbers para obter)" },
    },
    required: ["phone", "message", "whatsapp_number_id"],
  },
  handler: async ({ phone, message, whatsapp_number_id }: any) => {
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/zapi-send-message`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
      },
      body: JSON.stringify({ phone, message, whatsapp_number_id }),
    });
    const data = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool({
  name: "send_whatsapp_media",
  description: "Envia mídia (imagem, vídeo, documento, áudio) via WhatsApp.",
  inputSchema: {
    type: "object",
    properties: {
      phone: { type: "string", description: "Telefone destino" },
      media_url: { type: "string", description: "URL da mídia" },
      media_type: { type: "string", description: "image, video, document, audio" },
      caption: { type: "string", description: "Legenda (opcional)" },
      whatsapp_number_id: { type: "string", description: "UUID da instância" },
    },
    required: ["phone", "media_url", "media_type", "whatsapp_number_id"],
  },
  handler: async ({ phone, media_url, media_type, caption, whatsapp_number_id }: any) => {
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/zapi-send-media`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
      },
      body: JSON.stringify({ phone, mediaUrl: media_url, mediaType: media_type, caption, whatsapp_number_id }),
    });
    const data = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool({
  name: "search_pos_customer",
  description: "Busca clientes do POS por nome, telefone ou CPF.",
  inputSchema: {
    type: "object",
    properties: {
      search: { type: "string", description: "Nome, telefone ou CPF" },
      store_id: { type: "string", description: "UUID da loja" },
    },
    required: ["search"],
  },
  handler: async ({ search, store_id }: any) => {
    const sb = getSupabase();
    let q = sb.from("pos_customers").select("*")
      .or(`name.ilike.%${search}%,whatsapp.ilike.%${search}%,cpf.ilike.%${search}%`)
      .limit(20);
    if (store_id) q = q.eq("store_id", store_id);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: `Erro: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool({
  name: "get_inventory_summary",
  description: "Retorna resumo do inventário por loja: total itens, valor, custo, SKUs sem estoque.",
  inputSchema: { type: "object", properties: {} },
  handler: async () => {
    const sb = getSupabase();
    const { data, error } = await sb.rpc("get_inventory_summary");
    if (error) return { content: [{ type: "text", text: `Erro: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool({
  name: "list_support_tickets",
  description: "Lista tickets de suporte/atendimento (chat_assignments).",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", description: "open, in_progress, resolved" },
      limit: { type: "number" },
    },
  },
  handler: async ({ status, limit }: any) => {
    const sb = getSupabase();
    let q = sb.from("chat_assignments").select("*, chat_sectors(name)").order("created_at", { ascending: false }).limit(limit || 30);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: `Erro: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool({
  name: "run_query",
  description: "Executa uma consulta SELECT em qualquer tabela pública. Apenas leitura, sem mutações.",
  inputSchema: {
    type: "object",
    properties: {
      table: { type: "string", description: "Nome da tabela (ex: orders, customers, events)" },
      select: { type: "string", description: "Campos para selecionar (default: *)" },
      filters: {
        type: "array",
        description: "Filtros [{column, operator, value}]. Operators: eq, neq, gt, gte, lt, lte, like, ilike, in, is",
        items: {
          type: "object",
          properties: {
            column: { type: "string" },
            operator: { type: "string" },
            value: {},
          },
          required: ["column", "operator", "value"],
        },
      },
      order_by: { type: "string", description: "Coluna para ordenar" },
      ascending: { type: "boolean", description: "Ordem ascendente (default false)" },
      limit: { type: "number", description: "Limite (default 50)" },
    },
    required: ["table"],
  },
  handler: async ({ table, select, filters, order_by, ascending, limit }: any) => {
    const sb = getSupabase();
    let q = sb.from(table).select(select || "*").limit(limit || 50);
    if (filters) {
      for (const f of filters) {
        switch (f.operator) {
          case "eq": q = q.eq(f.column, f.value); break;
          case "neq": q = q.neq(f.column, f.value); break;
          case "gt": q = q.gt(f.column, f.value); break;
          case "gte": q = q.gte(f.column, f.value); break;
          case "lt": q = q.lt(f.column, f.value); break;
          case "lte": q = q.lte(f.column, f.value); break;
          case "like": q = q.like(f.column, f.value); break;
          case "ilike": q = q.ilike(f.column, f.value); break;
          case "in": q = q.in(f.column, f.value); break;
          case "is": q = q.is(f.column, f.value); break;
        }
      }
    }
    if (order_by) q = q.order(order_by, { ascending: ascending ?? false });
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: `Erro: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
});

// ─── HTTP TRANSPORT ──────────────────────────────────────

const app = new Hono();
const transport = new StreamableHttpTransport();

// Auth middleware
app.use("/*", async (c, next) => {
  // Allow OPTIONS for CORS
  if (c.req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-agent-key, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      },
    });
  }

  // Check agent key
  const agentKey = c.req.header("x-agent-key");
  if (agentKey !== AGENT_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized. Set header x-agent-key." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  await next();
});

app.all("/*", async (c) => {
  const response = await transport.handleRequest(c.req.raw, mcpServer);
  // Add CORS headers
  response.headers.set("Access-Control-Allow-Origin", "*");
  return response;
});

Deno.serve(app.fetch);
