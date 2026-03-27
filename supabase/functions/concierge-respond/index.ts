import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// ─── Tiny ERP search helpers ─────────────────────────────────────────────────

async function searchTinyContactByCpf(token: string, cpf: string): Promise<{ name: string; id: string } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch('https://api.tiny.com.br/api2/contatos.pesquisa.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${token}&formato=json&cpf_cnpj=${encodeURIComponent(cpf)}`,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = JSON.parse(await resp.text());
    if (data.retorno?.status === 'OK' && data.retorno?.contatos?.length > 0) {
      const contato = data.retorno.contatos[0].contato;
      return { name: contato.nome || '', id: String(contato.id || '') };
    }
    return null;
  } catch (e) {
    console.error('[concierge] Tiny contact search error:', e);
    return null;
  }
}

async function searchTinyOrders(token: string, searchTerm: string): Promise<any[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch('https://api.tiny.com.br/api2/pedidos.pesquisa.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${token}&formato=json&pesquisa=${encodeURIComponent(searchTerm)}&sort=DESC`,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = JSON.parse(await resp.text());
    if (data.retorno?.status === 'OK' && data.retorno?.pedidos) {
      return data.retorno.pedidos.map((p: any) => p.pedido).filter(Boolean);
    }
    return [];
  } catch (e) {
    console.error('[concierge] Tiny search error:', e);
    return [];
  }
}

function normalizeSearchTerm(raw: string): { normalized: string; digitsOnly: string; isCpf: boolean } {
  const normalized = raw.trim();
  const digitsOnly = normalized.replace(/\D/g, '');
  const isCpf = digitsOnly.length === 11;

  return {
    normalized: isCpf ? digitsOnly : normalized,
    digitsOnly,
    isCpf,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function normalizeLooseText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function getCustomerFacingStoreName(storeName: string): string {
  const normalized = normalizeLooseText(storeName);
  if (normalized.includes('shopify')) return 'Site';
  if (normalized.includes('centro')) return 'Loja Centro';
  if (normalized.includes('perola')) return 'Loja Pérola';
  return storeName.replace(/^tiny\s+/i, '').trim();
}

function storeMatchesReference(storeName: string, reference: string): boolean {
  const normalizedStore = normalizeLooseText(storeName);
  const normalizedRef = normalizeLooseText(reference);
  const customerFacingStore = normalizeLooseText(getCustomerFacingStoreName(storeName));

  if (!normalizedRef) return false;
  if (normalizedRef === 'site') return normalizedStore.includes('shopify');

  return normalizedStore.includes(normalizedRef)
    || normalizedRef.includes(normalizedStore)
    || customerFacingStore.includes(normalizedRef)
    || normalizedRef.includes(customerFacingStore);
}

function extractCpfFromTexts(texts: Array<string | null | undefined>): string | null {
  for (const text of texts) {
    if (!text) continue;
    const cpfMatch = text.match(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/);
    if (cpfMatch) return cpfMatch[0].replace(/\D/g, '');

    const digits = text.replace(/\D/g, '');
    if (digits.length === 11) return digits;
  }

  return null;
}

function extractOrdersFromToolParams(toolParams: any): any[] {
  const executions = Array.isArray(toolParams?.toolExecutions) ? toolParams.toolExecutions : [];
  for (const execution of [...executions].reverse()) {
    if (execution?.name === 'search_customer_orders' && Array.isArray(execution?.result?.orders)) {
      return execution.result.orders;
    }
  }
  return [];
}

function resolveTrackingToolArgs(
  args: Record<string, any>,
  toolExecutions: Array<{ name: string; args: Record<string, any>; result: any }>,
): Record<string, any> {
  if (!args?.tiny_order_id) return args;

  const requestedRef = String(args.tiny_order_id).trim().replace(/^#/, '').replace(/\D/g, '');
  if (!requestedRef) return args;

  const searchExecutions = [...toolExecutions].reverse().filter((execution) => execution.name === 'search_customer_orders');
  for (const execution of searchExecutions) {
    const orders = Array.isArray(execution.result?.orders) ? execution.result.orders : [];
    const matchedOrder = orders.find((order: any) => {
      const orderNumber = String(order?.order_number || '').replace(/\D/g, '');
      const tinyOrderId = String(order?.tiny_order_id || '').replace(/\D/g, '');
      const storeOk = !args.store_name || storeMatchesReference(String(order?.store_name || ''), String(args.store_name || ''));
      return storeOk && (requestedRef === orderNumber || requestedRef === tinyOrderId);
    });

    if (matchedOrder?.tiny_order_id) {
      return {
        ...args,
        tiny_order_id: String(matchedOrder.tiny_order_id),
        store_name: matchedOrder.store_name || args.store_name,
      };
    }
  }

  return args;
}

async function getTinyOrderDetail(token: string, tinyOrderId: string): Promise<any | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch('https://api.tiny.com.br/api2/pedido.obter.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${token}&formato=json&id=${tinyOrderId}`,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = JSON.parse(await resp.text());
    if (data.retorno?.status === 'OK' && data.retorno?.pedido) {
      return data.retorno.pedido;
    }
    return null;
  } catch (e) {
    console.error('[concierge] Tiny detail error:', e);
    return null;
  }
}

async function resolveTinyOrderDetail(token: string, requestedOrderRef: string): Promise<any | null> {
  const cleanedRef = String(requestedOrderRef || '').trim().replace(/^#/, '');
  if (!cleanedRef) return null;

  const directOrder = await getTinyOrderDetail(token, cleanedRef);
  if (directOrder) return directOrder;

  const searchResults = await searchTinyOrders(token, cleanedRef);
  const matchedOrder = searchResults.find((order: any) => {
    const orderId = String(order.id || '').replace(/\D/g, '');
    const orderNumber = String(order.numero || '').replace(/\D/g, '');
    const ecommerceNumber = String(order.numero_ecommerce || '').replace(/\D/g, '');
    const refDigits = cleanedRef.replace(/\D/g, '');

    return !!refDigits && (orderId === refDigits || orderNumber === refDigits || ecommerceNumber === refDigits);
  });

  if (!matchedOrder?.id) return null;
  return await getTinyOrderDetail(token, String(matchedOrder.id));
}

function extractTrackingDataFromOrder(pedido: any): { trackingCode: string | null; trackingLink: string | null; carrier: string | null } {
  const expedition = pedido?.expedicao || pedido?.expedition || pedido?.envio || {};

  return {
    trackingCode: firstNonEmptyString(
      pedido?.codigo_rastreamento,
      pedido?.codigoRastreamento,
      pedido?.objeto_postal,
      pedido?.objetoPostal,
      pedido?.codigo_objeto,
      pedido?.codigoObjeto,
      expedition?.codigo_rastreamento,
      expedition?.codigoRastreamento,
      expedition?.objeto_postal,
      expedition?.objetoPostal,
      expedition?.codigo_objeto,
      expedition?.codigoObjeto,
    ),
    trackingLink: firstNonEmptyString(
      pedido?.url_rastreamento,
      pedido?.urlRastreamento,
      pedido?.link_rastreamento,
      pedido?.linkRastreamento,
      expedition?.url_rastreamento,
      expedition?.urlRastreamento,
      expedition?.link_rastreamento,
      expedition?.linkRastreamento,
    ),
    carrier: firstNonEmptyString(
      pedido?.nome_transportador,
      pedido?.forma_envio,
      pedido?.transportador,
      expedition?.transportadora,
      expedition?.forma_envio,
      expedition?.formaEnvio,
    ),
  };
}

function buildTrackingReplyFromToolResult(toolName: string, rawResult: string): string | null {
  if (toolName !== 'get_order_details') return null;

  try {
    const result = JSON.parse(rawResult);
    if (result?.tracking_code) {
      const orderLabel = result.order_number ? `#${result.order_number}` : 'do seu pedido';
      const parts = [
        `Prontinho! Encontrei o rastreio ${orderLabel}.`,
        `Código de rastreio: ${result.tracking_code}`,
        result.tracking_link ? `Acompanhe aqui: ${result.tracking_link}` : null,
      ].filter(Boolean);

      return parts.join('\n');
    }

    if (!result?.error && result?.order_number) {
      return `Encontrei o pedido #${result.order_number}, mas o código de rastreio ainda não aparece disponível no sistema.`;
    }
  } catch (_err) {
    return null;
  }

  return null;
}

function parseToolResult(rawResult: string): any {
  try {
    return JSON.parse(rawResult);
  } catch {
    return { raw: rawResult };
  }
}

function isPositiveTrackingConfirmation(message: string): boolean {
  const normalized = message.toLowerCase().trim();
  return [
    /^sim\b/,
    /esse mesmo/,
    /é esse/,
    /e esse/,
    /pode ser esse/,
    /quero esse/,
    /quero rastrear esse/,
    /correto/,
    /confirmo/,
  ].some((pattern) => pattern.test(normalized));
}

function resolveOrderFromConfirmation(message: string, orders: any[]): any | null {
  if (!Array.isArray(orders) || orders.length === 0) return null;

  const normalized = message.toLowerCase().trim();
  const explicitOrderRef = normalized.match(/#?\s*(\d{3,})/);
  if (explicitOrderRef) {
    const ref = explicitOrderRef[1];
    const matched = orders.find((order: any) =>
      String(order?.order_number || '').replace(/\D/g, '') === ref ||
      String(order?.tiny_order_id || '').replace(/\D/g, '') === ref
    );
    if (matched) return matched;
  }

  const ordinalMap: Array<{ patterns: RegExp[]; index: number }> = [
    { patterns: [/pedido 1\b/, /\b1\b/, /primeir[oa]/], index: 0 },
    { patterns: [/pedido 2\b/, /\b2\b/, /segund[oa]/], index: 1 },
    { patterns: [/pedido 3\b/, /\b3\b/, /terceir[oa]/], index: 2 },
  ];

  for (const entry of ordinalMap) {
    if (entry.patterns.some((pattern) => pattern.test(normalized)) && orders[entry.index]) {
      return orders[entry.index];
    }
  }

  if (orders.length === 1 && isPositiveTrackingConfirmation(message)) {
    return orders[0];
  }

  return null;
}

// ─── Tool definitions for AI ─────────────────────────────────────────────────

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_customer_orders",
      description: "Busca pedidos de um cliente pelo nome completo ou CPF no sistema Tiny ERP. Pesquisa em todas as lojas (Site, Centro, Pérola). Use quando o cliente pedir rastreio, status de pedido, ou informações sobre uma compra. Retorna produtos, data, status e loja.",
      parameters: {
        type: "object",
        properties: {
          search_term: {
            type: "string",
            description: "Nome completo do cliente ou CPF (somente números). Mínimo 3 caracteres."
          }
        },
        required: ["search_term"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_order_details",
      description: "Obtém detalhes completos de um pedido específico: produtos comprados, código de rastreio, transportadora, status e valores. Use após encontrar o pedido com search_customer_orders, tanto para buscar rastreio quanto para saber quais produtos o cliente comprou.",
      parameters: {
        type: "object",
        properties: {
          tiny_order_id: {
            type: "string",
            description: "ID interno do pedido no Tiny ERP ou número visível do pedido (ex: 4809 ou #4809)"
          },
          store_name: {
            type: "string",
            description: "Nome da loja onde o pedido foi encontrado (Site, Loja Centro, ou Loja Perola)"
          }
        },
        required: ["tiny_order_id", "store_name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "transfer_to_human",
      description: "Transfere a conversa para um atendente humano e cria um ticket de suporte. Use APENAS quando: a IA não consegue resolver, o cliente insiste em algo fora do escopo de suporte, ou precisa de atendimento especializado. NÃO use se ainda tem ferramentas que podem responder a pergunta. Preencha summary com um resumo claro da situação do cliente.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Motivo curto da transferência para uso como assunto do ticket (ex: 'Pedido parado na transportadora', 'Cliente quer trocar produto', 'Pedido não encontrado')"
          },
          summary: {
            type: "string",
            description: "Resumo detalhado da situação do cliente para a equipe de suporte. Inclua: o que o cliente pediu, o que foi encontrado, qual o problema. Ex: 'Cliente Hélia Maria, CPF 766.180.721-15, pedido #4809 enviado em 27/03 com rastreio AN754068518BR. Pedido está parado há muito tempo segundo a cliente.'"
          },
          priority: {
            type: "string",
            enum: ["low", "medium", "high"],
            description: "Urgência do ticket: 'high' para problemas urgentes (pedido extraviado, defeito, reclamação grave), 'medium' para questões normais (dúvidas, atraso moderado), 'low' para questões simples (informações gerais)"
          }
        },
        required: ["reason", "summary", "priority"],
        additionalProperties: false,
      },
    },
  },
];

// ─── Tool execution ──────────────────────────────────────────────────────────

interface StoreConfig {
  id: string;
  name: string;
  token: string;
}

async function executeToolCall(
  toolName: string,
  args: Record<string, any>,
  stores: StoreConfig[],
  supabase: any,
  phone: string,
  whatsappNumberId?: string,
): Promise<string> {
  if (toolName === 'search_customer_orders') {
    const originalTerm = args.search_term?.trim();
    const { normalized: term, digitsOnly, isCpf } = normalizeSearchTerm(originalTerm || '');
    if (!term || term.length < 3) {
      return JSON.stringify({ error: "Termo de busca muito curto. Peça o nome completo ou CPF ao cliente." });
    }

    const allResults: any[] = [];

    for (const store of stores) {
      if (isCpf) {
        // ── TWO-STAGE CPF FLOW ──
        // Stage 1: Find contact by CPF using contatos.pesquisa.php
        console.log(`[concierge] Stage 1: Searching contact by CPF in "${store.name}"`);
        const contact = await searchTinyContactByCpf(store.token, digitsOnly);
        
        if (!contact || !contact.name) {
          console.log(`[concierge] No contact found by CPF in "${store.name}"`);
          continue;
        }

        console.log(`[concierge] Stage 2: Contact found "${contact.name}", searching orders in "${store.name}"`);
        
        // Stage 2: Search orders by the contact name returned from Tiny
        const orders = await searchTinyOrders(store.token, contact.name);
        if (orders.length === 0) {
          console.log(`[concierge] No orders found for contact "${contact.name}" in "${store.name}"`);
          continue;
        }

        // Filter orders that STRICTLY match the contact name
        const contactNameLower = contact.name.toLowerCase();
        const contactWords = contactNameLower.split(/\s+/).filter((w: string) => w.length >= 2);
        const filtered = orders.filter((o: any) => {
          const orderName = (o.nome || '').toLowerCase();
          if (!orderName) return false;
          // At least the first AND last word of the contact name must appear in order name
          // This prevents returning orders from completely different customers
          const firstWord = contactWords[0];
          const lastWord = contactWords[contactWords.length - 1];
          return firstWord && lastWord && orderName.includes(firstWord) && orderName.includes(lastWord);
        });

        // CRITICAL: Do NOT fallback to unfiltered orders - only use confirmed matches
        if (filtered.length === 0) {
          console.log(`[concierge] CPF contact "${contact.name}" found in "${store.name}" but no orders match this name. Skipping.`);
          continue;
        }

        const ordersToUse = filtered;

        for (const order of ordersToUse.slice(0, 3)) {
          // Fetch detail to get product names
          let productNames: string[] = [];
          try {
            const detail = await getTinyOrderDetail(store.token, String(order.id));
            if (detail?.itens) {
              productNames = detail.itens.map((i: any) => {
                const item = i.item || i;
                return item.descricao || item.nome || '';
              }).filter(Boolean).slice(0, 3);
            }
          } catch (e) { console.error('[concierge] detail fetch error:', e); }

          allResults.push({
            tiny_order_id: String(order.id),
            order_number: String(order.numero),
            date: order.data_pedido,
            customer_name: contact.name,
            products: productNames.length > 0 ? productNames : ['(produtos não disponíveis)'],
            status: order.situacao,
            store_name: getCustomerFacingStoreName(store.name),
            searched_by: 'cpf',
            cpf_suffix: digitsOnly.slice(-4),
          });
        }
      } else {
        // ── NAME SEARCH (fallback) ──
        console.log(`[concierge] Searching orders by name "${term}" in "${store.name}"`);
        const orders = await searchTinyOrders(store.token, term);
        if (orders.length > 0) {
          const termLower = term.toLowerCase();
          const termWords = termLower.split(/\s+/).filter((w: string) => w.length >= 2);
          const filtered = orders.filter((o: any) => {
            const name = (o.nome || '').toLowerCase();
            return termWords.some((word: string) => name.includes(word));
          });

          for (const order of filtered.slice(0, 3)) {
            let productNames: string[] = [];
            try {
              const detail = await getTinyOrderDetail(store.token, String(order.id));
              if (detail?.itens) {
                productNames = detail.itens.map((i: any) => {
                  const item = i.item || i;
                  return item.descricao || item.nome || '';
                }).filter(Boolean).slice(0, 3);
              }
            } catch (e) { console.error('[concierge] detail fetch error:', e); }

            allResults.push({
              tiny_order_id: String(order.id),
              order_number: String(order.numero),
              date: order.data_pedido,
              customer_name: order.nome,
              products: productNames.length > 0 ? productNames : ['(produtos não disponíveis)'],
              status: order.situacao,
              store_name: getCustomerFacingStoreName(store.name),
              searched_by: 'name',
              cpf_suffix: null,
            });
          }
        }
      }
    }

    if (allResults.length === 0) {
      return JSON.stringify({
        found: false,
        message: isCpf
          ? "Nenhum pedido encontrado com esse CPF em nenhuma das lojas. Confirme o CPF ou tente com o nome completo."
          : "Nenhum pedido encontrado com esse nome em nenhuma das lojas."
      });
    }

    return JSON.stringify({
      found: true,
      total_results: allResults.length,
      orders: allResults.slice(0, 10),
    });
  }

  if (toolName === 'get_order_details') {
    const requestedOrderRef = String(args.tiny_order_id || '').trim().replace(/^#/, '');
    const storeName = args.store_name;
    const store = stores.find(s => storeMatchesReference(s.name, storeName));
    if (!store) {
      return JSON.stringify({ error: `Loja "${storeName}" não encontrada.` });
    }

    const pedido = await resolveTinyOrderDetail(store.token, requestedOrderRef);
    if (!pedido) {
      return JSON.stringify({ error: "Não foi possível obter detalhes do pedido." });
    }

    const { trackingCode, trackingLink: trackingLinkRaw, carrier } = extractTrackingDataFromOrder(pedido);
    const items = (pedido.itens || []).map((i: any) => {
      const item = i.item || i;
      return `${item.descricao} (x${item.quantidade})`;
    });

    // Build tracking link
    let trackingLink: string | null = trackingLinkRaw;
    if (trackingCode) {
      const codeLower = (trackingCode || '').toUpperCase();
      // Correios codes usually match pattern: 2 letters + 9 digits + 2 letters (e.g., AB123456789BR)
      const isCorreios = /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(codeLower);
      if (!trackingLink && isCorreios) {
        trackingLink = `https://www.linkcorreios.com.br/?id=${trackingCode}`;
      } else if (!trackingLink) {
        // For other carriers, try generic tracking
        trackingLink = `https://www.muambator.com.br/pacotes/${trackingCode}/detalhes/`;
      }
    }

    return JSON.stringify({
      tiny_order_id: String(pedido.id || ''),
      order_number: String(pedido.numero),
      date: pedido.data_pedido,
      status: pedido.situacao,
      total: parseFloat(pedido.valor || '0'),
      customer_name: pedido.cliente?.nome || null,
      items: items,
      tracking_code: trackingCode,
      tracking_link: trackingLink,
      tracking_available: !!trackingCode,
      carrier: carrier,
      store_name: getCustomerFacingStoreName(store.name),
      obs: pedido.obs || null,
    });
  }

  if (toolName === 'transfer_to_human') {
    const ticketPriority = args.priority || 'medium';
    const ticketSubject = args.reason || 'Transferência da Bia';
    const ticketDescription = args.summary || '';

    // Calculate deadline based on priority
    const deadline = new Date();
    if (ticketPriority === 'high') deadline.setMinutes(deadline.getMinutes() + 10);
    else if (ticketPriority === 'medium') deadline.setMinutes(deadline.getMinutes() + 60);
    else deadline.setMinutes(deadline.getMinutes() + 120);

    // Resolve customer name from recent conversation context
    let customerName: string | null = null;
    try {
      const { data: recentLogs } = await supabase
        .from('ai_conversation_logs')
        .select('tool_params, tool_called')
        .eq('phone', phone)
        .order('created_at', { ascending: false })
        .limit(10);

      for (const log of recentLogs || []) {
        if (log.tool_called === 'search_customer_orders' && log.tool_params) {
          const params = typeof log.tool_params === 'string' ? JSON.parse(log.tool_params) : log.tool_params;
          if (params?.customer_name) { customerName = params.customer_name; break; }
        }
      }
    } catch (_e) { /* ignore */ }

    // Create support ticket
    try {
      const { error: ticketError } = await supabase.from('support_tickets').insert({
        subject: ticketSubject,
        description: `${ticketDescription}\n\nInstância WhatsApp: ${whatsappNumberId || 'não identificada'}`.trim(),
        priority: ticketPriority,
        customer_name: customerName,
        customer_phone: phone,
        deadline_at: deadline.toISOString(),
        source: 'bia_ai',
      });
      if (ticketError) console.error('[concierge] Ticket creation error:', ticketError);
      else console.log(`[concierge] Support ticket created for ${phone} - priority: ${ticketPriority}`);
    } catch (e) {
      console.error('[concierge] Ticket creation error:', e);
    }

    // Also create chat assignment for routing
    try {
      const { data: sectors } = await supabase
        .from('chat_sectors')
        .select('id, name')
        .eq('is_active', true)
        .order('sort_order');

      let sectorId = sectors?.[0]?.id;
      const supportSector = sectors?.find((s: any) =>
        s.name.toLowerCase().includes('suporte') || s.name.toLowerCase().includes('atendimento')
      );
      if (supportSector) sectorId = supportSector.id;

      if (sectorId) {
        await supabase.from('chat_assignments').insert({
          phone,
          sector_id: sectorId,
          assigned_by: 'ai',
          status: 'pending',
          ai_classification: args.reason || 'transfer_requested',
        });
      }
    } catch (e) {
      console.error('[concierge] Transfer error:', e);
    }

    return JSON.stringify({
      transferred: true,
      message: "Conversa transferida para atendente humano. Ticket de suporte criado.",
    });
  }

  return JSON.stringify({ error: `Tool "${toolName}" not found.` });
}

// ─── Main handler ────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { phone, messageText, whatsappNumberId, channel = 'whatsapp' } = await req.json();

    if (!phone || !messageText) {
      return new Response(JSON.stringify({ error: 'phone and messageText required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!ANTHROPIC_API_KEY && !LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'No AI API key configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Normalize phone
    let normalizedPhone = phone.replace(/\D/g, '');
    if (!normalizedPhone.startsWith('55') && normalizedPhone.length <= 11) {
      normalizedPhone = '55' + normalizedPhone;
    }

    const incomingMessageText = messageText.trim().slice(0, 500);
    const aggregationCutoff = new Date(Date.now() - 30000).toISOString();

    // ─── 0. Debounce + aggregate fragmented messages ───────────────────
    await sleep(10000);

    let latestIncomingQuery = supabase
      .from('whatsapp_messages')
      .select('message, created_at')
      .eq('phone', normalizedPhone)
      .eq('direction', 'incoming');

    if (whatsappNumberId) {
      latestIncomingQuery = latestIncomingQuery.eq('whatsapp_number_id', whatsappNumberId);
    }

    const { data: latestIncoming } = await latestIncomingQuery
      .order('created_at', { ascending: false })
      .limit(1);

    const latestIncomingText = latestIncoming?.[0]?.message?.trim() || '';
    const latestIncomingAt = latestIncoming?.[0]?.created_at || null;
    if (latestIncomingText && incomingMessageText && latestIncomingText !== incomingMessageText) {
      console.log(`[concierge] Debounced fragmented message for ${normalizedPhone}; newer input detected.`);
      return new Response(JSON.stringify({ success: true, handled: false, reason: 'debounced_newer_message' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let recentIncomingQuery = supabase
      .from('whatsapp_messages')
      .select('message, created_at')
      .eq('phone', normalizedPhone)
      .eq('direction', 'incoming')
      .gte('created_at', aggregationCutoff)
      .order('created_at', { ascending: true });

    if (whatsappNumberId) {
      recentIncomingQuery = recentIncomingQuery.eq('whatsapp_number_id', whatsappNumberId);
    }

    const { data: recentIncomingMessages } = await recentIncomingQuery;
    const combinedMessage = (recentIncomingMessages && recentIncomingMessages.length > 0)
      ? recentIncomingMessages.map((msg: any) => msg.message?.trim()).filter(Boolean).join('\n').slice(0, 500)
      : incomingMessageText;

    // ─── 1. Load stores with Tiny tokens ────────────────────────────────
    const { data: storesData } = await supabase
      .from('pos_stores')
      .select('id, name, tiny_token')
      .eq('is_active', true)
      .not('tiny_token', 'is', null);

    const stores: StoreConfig[] = (storesData || [])
      .filter((s: any) => s.tiny_token)
      .map((s: any) => ({ id: s.id, name: s.name, token: s.tiny_token }));

    // Reorder: Tiny Shopify first, then Centro, then Pérola
    stores.sort((a, b) => {
      const priority = (name: string) => {
        if (name.toLowerCase().includes('shopify')) return 0;
        if (name.toLowerCase().includes('centro')) return 1;
        if (name.toLowerCase().includes('perola') || name.toLowerCase().includes('pérola')) return 2;
        return 3;
      };
      return priority(a.name) - priority(b.name);
    });

    // ─── 1b. Deterministic tracking confirmation path ───────────────────
    const { data: recentAiLogs } = await supabase
      .from('ai_conversation_logs')
      .select('message_out, tool_called, tool_params, created_at')
      .eq('phone', normalizedPhone)
      .eq('stage', 'concierge')
      .order('created_at', { ascending: false })
      .limit(12);

    const { data: recentIncomingContext } = await supabase
      .from('whatsapp_messages')
      .select('message, created_at')
      .eq('phone', normalizedPhone)
      .eq('direction', 'incoming')
      .order('created_at', { ascending: false })
      .limit(12);

    const latestSearchLog = (recentAiLogs || []).find((log: any) => {
      return extractOrdersFromToolParams(log?.tool_params).length > 0;
    });

    let recentOrders = latestSearchLog ? extractOrdersFromToolParams(latestSearchLog.tool_params) : [];

    if (recentOrders.length === 0) {
      const fallbackCpf = extractCpfFromTexts((recentIncomingContext || []).map((msg: any) => msg.message));
      if (fallbackCpf) {
        const fallbackSearchRaw = await executeToolCall('search_customer_orders', { search_term: fallbackCpf }, stores, supabase, normalizedPhone);
        const fallbackSearch = parseToolResult(fallbackSearchRaw);
        recentOrders = Array.isArray(fallbackSearch?.orders) ? fallbackSearch.orders : [];
      }
    }

    if (recentOrders.length > 0) {
      const selectedOrder = resolveOrderFromConfirmation(combinedMessage, recentOrders);

      if (selectedOrder) {
        console.log(`[concierge] Deterministic tracking path for ${normalizedPhone}: order=${selectedOrder.order_number} store=${selectedOrder.store_name}`);
        const trackingResult = await executeToolCall('get_order_details', {
          tiny_order_id: selectedOrder.tiny_order_id,
          store_name: selectedOrder.store_name,
        }, stores, supabase, normalizedPhone);

        const forcedTrackingReply = buildTrackingReplyFromToolResult('get_order_details', trackingResult);
        if (forcedTrackingReply) {
          const typingDelay = Math.min(Math.max(forcedTrackingReply.length * 50, 2000), 12000);
          await sleep(typingDelay);

          let latestBeforeSendQuery = supabase
            .from('whatsapp_messages')
            .select('message, created_at')
            .eq('phone', normalizedPhone)
            .eq('direction', 'incoming');

          if (whatsappNumberId) {
            latestBeforeSendQuery = latestBeforeSendQuery.eq('whatsapp_number_id', whatsappNumberId);
          }

          const { data: latestBeforeSend } = await latestBeforeSendQuery.order('created_at', { ascending: false }).limit(1);
          const latestBeforeSendAt = latestBeforeSend?.[0]?.created_at || null;
          const latestBeforeSendText = latestBeforeSend?.[0]?.message?.trim() || '';

          if (latestIncomingAt && latestBeforeSendAt && latestBeforeSendAt > latestIncomingAt && latestBeforeSendText !== latestIncomingText) {
            return new Response(JSON.stringify({ success: true, handled: false, reason: 'superseded_before_send' }), {
              status: 200,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }

          let sendFn = 'zapi-send-message';
          const sendBody: Record<string, unknown> = { phone: normalizedPhone, message: forcedTrackingReply };

          if (whatsappNumberId) {
            const { data: numData } = await supabase
              .from('whatsapp_numbers')
              .select('api_type')
              .eq('id', whatsappNumberId)
              .maybeSingle();

            if (numData?.api_type === 'meta') {
              sendFn = 'meta-whatsapp-send';
              sendBody.whatsappNumberId = whatsappNumberId;
            } else {
              sendBody.whatsapp_number_id = whatsappNumberId;
            }
          }

          const sendRes = await fetch(`${supabaseUrl}/functions/v1/${sendFn}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(sendBody),
          });

          let messageId: string | null = null;
          try { const sd = await sendRes.json(); messageId = sd?.messageId || sd?.zapiMessageId || null; } catch (_) {}

          await supabase.from('whatsapp_messages').insert({
            phone: normalizedPhone,
            message: `[IA] ${forcedTrackingReply}`,
            direction: 'outgoing',
            status: 'sent',
            message_id: messageId,
            whatsapp_number_id: whatsappNumberId || null,
          });

          await supabase.from('ai_conversation_logs').insert({
            phone: normalizedPhone,
            message_in: combinedMessage,
            message_out: forcedTrackingReply,
            ai_decision: 'deterministic_tracking_reply',
            provider: 'deterministic',
            stage: 'concierge',
            tool_called: 'get_order_details',
            tool_params: {
              source: 'recent_search_confirmation',
              selectedOrder,
              trackingResult: parseToolResult(trackingResult),
            },
          });

          return new Response(JSON.stringify({ success: true, reply: forcedTrackingReply, deterministic: true }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    }

    // ─── 2. Load Knowledge Base ─────────────────────────────────────────
    const { data: kbEntries } = await supabase
      .from('ai_knowledge_base')
      .select('category, title, content')
      .eq('is_active', true)
      .contains('agents', ['concierge'])
      .order('sort_order');

    let knowledgeBlock = '';
    if (kbEntries && kbEntries.length > 0) {
      knowledgeBlock = `\n\nBASE DE CONHECIMENTO:\n${kbEntries.map(e => `[${e.category}] ${e.title}: ${e.content}`).join('\n')}`;
    }

    // ─── 3. Load Sector Routing ─────────────────────────────────────────
    let routingBlock = '';
    const { data: sectors } = await supabase
      .from('chat_sectors')
      .select('id, name, description, ai_routing_keywords')
      .eq('is_active', true)
      .order('sort_order');

    if (sectors && sectors.length > 0) {
      routingBlock = `\n\nROTEAMENTO DE SETOR:
Se o cliente precisar de algo que você NÃO consegue resolver (como vendas), use a ferramenta transfer_to_human.
Setores disponíveis:
${sectors.map(s => `- ${s.name}: ${s.description || ''} (Keywords: ${(s.ai_routing_keywords || []).join(', ')})`).join('\n')}`;
    }

    // ─── 4. Build System Prompt ─────────────────────────────────────────
    const systemPrompt = `Você é a Bia, assistente virtual de SUPORTE da Banana Calçados. Você responde em português brasileiro de forma simpática e objetiva.

SEU PAPEL (APENAS):
- Ajudar clientes com rastreio de pedidos usando as ferramentas disponíveis
- Informar sobre produtos comprados, status e detalhes do pedido
- Direcionar para atendente humano quando necessário
- Responder dúvidas básicas usando a base de conhecimento

O QUE VOCÊ NÃO PODE FAZER (PROIBIDO):
- NUNCA fale sobre preços, valores ou promoções
- NUNCA ofereça produtos novos, modelos disponíveis, fotos ou catálogos
- NUNCA tente vender nada
- NUNCA prometa enviar fotos, imagens ou vídeos
- NUNCA fale sobre disponibilidade de estoque, tamanhos ou cores
- Se a cliente pedir algo de vendas, diga "Vou te conectar com uma de nossas consultoras! 😊" e use transfer_to_human

FLUXO DE RASTREIO E DETALHES DO PEDIDO:
1. Cliente pede rastreio ou informação do pedido → peça PRIMEIRO o CPF; aceite CPF com pontos e traços (remova a máscara)
2. Só use nome como plano B quando a pessoa realmente não souber o CPF
3. Use search_customer_orders para buscar — os resultados já incluem os produtos comprados
4. Se encontrar UM ÚNICO pedido, confirme o nome e o produto com o cliente. NÃO transfira — aguarde confirmação
5. Se encontrar VÁRIOS pedidos, liste mostrando: número, data, produto(s) e loja. NÃO mostre valores/preços. Pergunte qual deseja
6. Quando o cliente ESCOLHER ou CONFIRMAR um pedido, use IMEDIATAMENTE get_order_details para buscar rastreio e mais detalhes
7. Após obter o rastreio, envie código + link clicável
8. Se o cliente perguntar qual produto comprou, você já tem essa info nos resultados — responda diretamente, sem transferir
9. Se não encontrar pelo nome, peça o CPF; se não encontrar pelo CPF, use transfer_to_human
10. NUNCA use transfer_to_human se você ainda tem informação de pedido para consultar

REGRAS:
- Responda de forma curta e natural, como humano no WhatsApp
- Use emojis com moderação (máximo 2 por mensagem)
- NUNCA repita informações já ditas
- Se não conseguir resolver, use transfer_to_human
- Para o cliente, diga "Site" e nunca "Shopify"
- Ao enviar rastreio, SEMPRE inclua o link clicável
- NUNCA mostre valores monetários (R$) dos pedidos ao cliente${knowledgeBlock}${routingBlock}`;

    // ─── 5. Build Conversation History ──────────────────────────────────
    const chatMessages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    const { data: dbMessages } = await supabase
      .from('whatsapp_messages')
      .select('message, direction, created_at, media_type, is_mass_dispatch')
      .eq('phone', normalizedPhone)
      .order('created_at', { ascending: false })
      .limit(30);

    if (dbMessages && dbMessages.length > 0) {
      const recentMessages = [...dbMessages].reverse();
      for (const msg of recentMessages) {
        const text = msg.message?.trim();
        if (!text) continue;
        if (/\{\{\d+\}\}/.test(text) || /\{\{[a-zA-Z_]+\}\}/.test(text)) continue;
        if (/\[Template:\s/.test(text)) continue;
        if (text.length > 600) continue;
        if (msg.is_mass_dispatch) continue;
        if (msg.direction === 'incoming' && msg.created_at >= aggregationCutoff) continue;
        chatMessages.push({
          role: msg.direction === 'incoming' ? 'user' : 'assistant',
          content: text.replace(/^\[IA\]\s*/i, '').slice(0, 500),
        });
      }
    }

    // Always add the CURRENT incoming message (aggregated when fragmented)
    const lastHistoryMsg = chatMessages[chatMessages.length - 1];
    const currentMsgText = combinedMessage;
    if (!lastHistoryMsg || lastHistoryMsg.role !== 'user' || lastHistoryMsg.content !== currentMsgText) {
      chatMessages.push({ role: 'user', content: currentMsgText });
    }

    console.log(`[concierge] ${phone} | history=${chatMessages.length - 1} msgs | combined=${currentMsgText.split('\n').length} parts | latest_included=${dbMessages?.[0]?.created_at || 'none'} | kb=${kbEntries?.length || 0} | stores=${stores.length}`);

    // ─── 6. AI Loop (with tool calling, max 3 turns) ────────────────────
    // Primary: Anthropic Claude | Fallback: Lovable AI (Gemini)
    let finalReply = '';
    let sectorId: string | null = null;
    let aiClassification: string | null = null;
    const toolExecutions: Array<{ name: string; args: Record<string, any>; result: any }> = [];
    const MAX_TOOL_TURNS = 3;
    let usedProvider = 'anthropic';

    // Convert tools to Anthropic format
    const ANTHROPIC_TOOLS = TOOLS.map(t => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));

    // Extract system prompt (first message) and user/assistant messages
    const systemContent = chatMessages[0]?.content || '';
    const conversationMsgs = chatMessages.slice(1);

    // ─── Try Anthropic first ────────────────────────────────────────────
    async function runAnthropic(): Promise<string> {
      if (!ANTHROPIC_API_KEY) throw new Error('NO_KEY');

      // Build Anthropic-format messages
      let anthropicMsgs: Array<{ role: 'user' | 'assistant'; content: any }> = conversationMsgs.map(m => ({
        role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
        content: m.content,
      }));
      // Anthropic requires first message to be 'user'
      if (anthropicMsgs.length === 0 || anthropicMsgs[0].role !== 'user') {
        anthropicMsgs = [{ role: 'user' as const, content: '(início da conversa)' }, ...anthropicMsgs];
      }
      // Merge consecutive same-role messages
      const merged: Array<{ role: 'user' | 'assistant'; content: any }> = [];
      for (const m of anthropicMsgs) {
        if (merged.length > 0 && merged[merged.length - 1].role === m.role) {
          merged[merged.length - 1].content += '\n' + m.content;
        } else {
          merged.push({ ...m });
        }
      }

      let currentAnthropicMsgs = [...merged];

      for (let turn = 0; turn <= MAX_TOOL_TURNS; turn++) {
        console.log(`[concierge][anthropic] turn ${turn}/${MAX_TOOL_TURNS}, msgs=${currentAnthropicMsgs.length}`);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1024,
            system: systemContent,
            messages: currentAnthropicMsgs,
            tools: turn < MAX_TOOL_TURNS ? ANTHROPIC_TOOLS : undefined,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!resp.ok) {
          const errText = await resp.text();
          console.error(`[concierge][anthropic] error ${resp.status}: ${errText.slice(0, 300)}`);
          throw new Error(`ANTHROPIC_${resp.status}`);
        }

        const data = await resp.json();
        const stopReason = data.stop_reason;
        const contentBlocks = Array.isArray(data.content) ? data.content : [];

        console.log(`[concierge][anthropic] turn ${turn} stop_reason=${stopReason}, content_blocks=${contentBlocks.length}`);

        // Empty/malformed Anthropic response should trigger fallback
        if (contentBlocks.length === 0) {
          throw new Error('ANTHROPIC_EMPTY_CONTENT');
        }

        // Extract text + tool_use blocks
        let textReply = '';
        const toolUseBlocks: any[] = [];
        const sanitizedAssistantContent: any[] = [];
        for (const block of contentBlocks) {
          if (block.type === 'text') {
            const text = typeof block.text === 'string' ? block.text : '';
            if (text.trim()) {
              textReply += text;
              sanitizedAssistantContent.push({ ...block, text });
            }
            continue;
          }

          if (block.type === 'tool_use') {
            toolUseBlocks.push(block);
            sanitizedAssistantContent.push(block);
            continue;
          }

          sanitizedAssistantContent.push(block);
        }

        if (toolUseBlocks.length > 0) {
          // Add assistant response to messages, stripping empty text blocks
          currentAnthropicMsgs.push({ role: 'assistant', content: sanitizedAssistantContent });

          // Execute tools and add results
          const toolResults: any[] = [];
          for (const tu of toolUseBlocks) {
            const resolvedToolArgs = tu.name === 'get_order_details'
              ? resolveTrackingToolArgs(tu.input || {}, toolExecutions)
              : (tu.input || {});
            console.log(`[concierge][anthropic] tool: ${tu.name}(${JSON.stringify(resolvedToolArgs)})`);
            const result = await executeToolCall(tu.name, resolvedToolArgs, stores, supabase, normalizedPhone);
            console.log(`[concierge][anthropic] result: ${result.slice(0, 200)}`);
            toolExecutions.push({ name: tu.name, args: resolvedToolArgs, result: parseToolResult(result) });
            const forcedReply = buildTrackingReplyFromToolResult(tu.name, result);
            if (forcedReply) return forcedReply;
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: result,
            });
          }
          currentAnthropicMsgs.push({ role: 'user', content: toolResults } as any);

          if (textReply.trim()) finalReply = textReply.trim();
          continue;
        }

        // No tool calls and no text = malformed response, trigger fallback
        if (!textReply.trim()) {
          throw new Error('ANTHROPIC_EMPTY_TEXT');
        }

        // No tool calls — final text
        return textReply.trim();
      }

      return finalReply || '';
    }

    // ─── Fallback: Lovable AI (OpenAI-compatible) ───────────────────────
    async function runLovableAI(): Promise<string> {
      if (!LOVABLE_API_KEY) throw new Error('NO_LOVABLE_KEY');
      usedProvider = 'lovable-gemini';

      let currentMessages = [...chatMessages];

      for (let turn = 0; turn <= MAX_TOOL_TURNS; turn++) {
        const aiBody: Record<string, any> = {
          model: 'google/gemini-2.5-flash',
          messages: currentMessages,
          stream: false,
        };
        if (turn < MAX_TOOL_TURNS) aiBody.tools = TOOLS;

        console.log(`[concierge][lovable] turn ${turn}/${MAX_TOOL_TURNS}, msgs=${currentMessages.length}`);

        const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(aiBody),
        });

        if (!response.ok) {
          const st = response.status;
          const errText = await response.text();
          console.error(`[concierge][lovable] error ${st}: ${errText.slice(0, 300)}`);
          if (st === 429) return 'Estou com muitas solicitações no momento, pode me mandar de novo em 1 minutinho? 😊';
          if (st === 402) return 'Desculpe, estou com uma limitação técnica. Vou te conectar com uma de nossas consultoras! 😊';
          throw new Error(`LOVABLE_${st}`);
        }

        const data = await response.json();
        const message = data.choices?.[0]?.message;

        if (message?.tool_calls && message.tool_calls.length > 0) {
          currentMessages.push(message);
          for (const toolCall of message.tool_calls) {
            const fnName = toolCall.function?.name;
            let fnArgs: Record<string, any> = {};
            try { fnArgs = JSON.parse(toolCall.function?.arguments || '{}'); } catch { fnArgs = {}; }
            const resolvedFnArgs = fnName === 'get_order_details'
              ? resolveTrackingToolArgs(fnArgs, toolExecutions)
              : fnArgs;
            console.log(`[concierge][lovable] tool: ${fnName}(${JSON.stringify(resolvedFnArgs)})`);
            const result = await executeToolCall(fnName, resolvedFnArgs, stores, supabase, normalizedPhone);
            console.log(`[concierge][lovable] result: ${result.slice(0, 200)}`);
            toolExecutions.push({ name: fnName, args: resolvedFnArgs, result: parseToolResult(result) });
            const forcedReply = buildTrackingReplyFromToolResult(fnName, result);
            if (forcedReply) return forcedReply;
            currentMessages.push({ role: 'tool', content: result, tool_call_id: toolCall.id } as any);
          }
          if (message?.content?.trim()) finalReply = message.content.trim();
          continue;
        }

        return message?.content?.trim() || '';
      }
      return finalReply || '';
    }

    // ─── Helper: log AI error ─────────────────────────────────────────
    async function logAiError(errorType: string, errorMessage: string, providerAttempted: string, fallbackProvider?: string, fallbackSuccess?: boolean, aiResponse?: string) {
      try {
        await supabase.from('ai_error_logs').insert({
          agent: 'concierge',
          phone: normalizedPhone,
          error_type: errorType,
          error_message: errorMessage,
          provider_attempted: providerAttempted,
          fallback_provider: fallbackProvider || null,
          fallback_success: fallbackSuccess ?? false,
          customer_message: combinedMessage,
          ai_response: aiResponse || null,
          history_sent_count: chatMessages.length - 1,
          status: 'open',
        });
      } catch (e) { console.error('[concierge] Failed to log error:', e); }
    }

    // ─── Execute with fallback ──────────────────────────────────────────
    try {
      finalReply = await runAnthropic();
      if (!finalReply?.trim()) {
        throw new Error('ANTHROPIC_EMPTY_FINAL_REPLY');
      }
      console.log(`[concierge] Anthropic OK, reply len=${finalReply.length}`);
    } catch (anthropicErr: any) {
      console.warn(`[concierge] Anthropic failed: ${anthropicErr.message}, falling back to Lovable AI`);
      try {
        finalReply = await runLovableAI();
        console.log(`[concierge] Lovable AI fallback OK, reply len=${finalReply.length}`);
        await logAiError(anthropicErr.message, anthropicErr.message, 'anthropic', 'lovable-gemini', true, finalReply);
      } catch (lovableErr: any) {
        console.error(`[concierge] Both AI providers failed:`, lovableErr.message);
        finalReply = 'Desculpe, tive um probleminha técnico. Pode repetir sua mensagem? 😊';
        await logAiError(anthropicErr.message, `anthropic: ${anthropicErr.message} | lovable: ${lovableErr.message}`, 'anthropic', 'lovable-gemini', false);
      }
    }

    if (!finalReply) {
      finalReply = 'Desculpe, estou com dificuldades técnicas. Vou transferir você para um atendente. 😊';
      await logAiError('BOTH_EMPTY', 'Both providers returned empty', 'anthropic', 'lovable-gemini', false);
    }

    // ─── 7. Send Reply ──────────────────────────────────────────────────
    const typingDelay = Math.min(Math.max(finalReply.length * 50, 2000), 12000);
    await new Promise(r => setTimeout(r, typingDelay));

    let latestBeforeSendQuery = supabase
      .from('whatsapp_messages')
      .select('message, created_at')
      .eq('phone', normalizedPhone)
      .eq('direction', 'incoming');

    if (whatsappNumberId) {
      latestBeforeSendQuery = latestBeforeSendQuery.eq('whatsapp_number_id', whatsappNumberId);
    }

    const { data: latestBeforeSend } = await latestBeforeSendQuery
      .order('created_at', { ascending: false })
      .limit(1);

    const latestBeforeSendAt = latestBeforeSend?.[0]?.created_at || null;
    const latestBeforeSendText = latestBeforeSend?.[0]?.message?.trim() || '';

    if (latestIncomingAt && latestBeforeSendAt && latestBeforeSendAt > latestIncomingAt && latestBeforeSendText !== latestIncomingText) {
      console.log(`[concierge] Skipping stale reply for ${normalizedPhone}; newer incoming message arrived during processing.`);
      return new Response(JSON.stringify({ success: true, handled: false, reason: 'superseded_before_send' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let sendFn = 'zapi-send-message';
    const sendBody: Record<string, unknown> = { phone: normalizedPhone, message: finalReply };

    if (whatsappNumberId) {
      const { data: numData } = await supabase
        .from('whatsapp_numbers')
        .select('api_type')
        .eq('id', whatsappNumberId)
        .maybeSingle();

      if (numData?.api_type === 'meta') {
        sendFn = 'meta-whatsapp-send';
        sendBody.whatsappNumberId = whatsappNumberId;
      } else {
        sendBody.whatsapp_number_id = whatsappNumberId;
      }
    }

    const sendRes = await fetch(`${supabaseUrl}/functions/v1/${sendFn}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(sendBody),
    });

    let messageId: string | null = null;
    try { const sd = await sendRes.json(); messageId = sd?.messageId || sd?.zapiMessageId || null; } catch (_) {}

    // ─── 8. Save to DB ──────────────────────────────────────────────────
    await supabase.from('whatsapp_messages').insert({
      phone: normalizedPhone,
      message: `[IA] ${finalReply}`,
      direction: 'outgoing',
      status: 'sent',
      message_id: messageId,
      whatsapp_number_id: whatsappNumberId || null,
    });

    // Log
    await supabase.from('ai_conversation_logs').insert({
      phone: normalizedPhone,
      message_in: combinedMessage,
      message_out: finalReply,
      ai_decision: sectorId ? `routed:${sectorId}` : 'responded',
      provider: usedProvider,
      stage: 'concierge',
      tool_called: toolExecutions.map((exec) => exec.name).join(',') || null,
      tool_params: toolExecutions.length > 0 ? { toolExecutions } : null,
    });

    console.log(`[concierge] Reply sent to ${phone}: ${finalReply.slice(0, 80)}...`);

    return new Response(JSON.stringify({
      success: true,
      reply: finalReply,
      sectorId,
      aiClassification,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[concierge] Error:', error);
    return new Response(JSON.stringify({ error: error?.message || 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
