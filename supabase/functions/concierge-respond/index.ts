import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { transcribeAudio } from "../_shared/audio-transcribe.ts";
import { analyzeIncomingAttachment, parseDataUrl } from "../_shared/media-understanding.ts";
import { isVisualReferenceMessage, joinMeaningfulMessages, sanitizeMediaPlaceholderText } from "../_shared/media-message-utils.ts";

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

async function createAiAssistanceRequest(
  supabase: any,
  payload: {
    phone: string;
    customerName?: string | null;
    whatsappNumberId?: string | null;
    requestType: 'product_photo' | 'takeover_chat' | 'technical_info' | 'verify_stock';
    summary: string;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    productTitle?: string | null;
  },
) {
  try {
    await supabase.from('ai_assistance_requests').insert({
      request_type: payload.requestType,
      status: 'pending',
      customer_phone: payload.phone,
      customer_name: payload.customerName || null,
      product_title: payload.productTitle || null,
      ai_agent: 'bia',
      ai_summary: payload.summary,
      priority: payload.priority || 'normal',
      whatsapp_number_id: payload.whatsappNumberId || null,
      store_id: null,
    });
  } catch (error) {
    console.error('[concierge] ai assistance request error:', error);
  }
}

function classifyConciergeRequestType(text: string): 'product_photo' | 'takeover_chat' | 'technical_info' | 'verify_stock' {
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ' ');

  if (/(estoque|disponivel|disponível|tem\s+no|tem\s+na|tamanho\s+\d|numero\s+\d|esgotado|indisponivel|falta|acabou|quantidade)/i.test(normalized)) {
    return 'verify_stock';
  }

  if (/(foto|fotos|imagem|imagens|video|vídeo|ver\s+o\s+produto|mostrar|visualizar|como\s+e\s+o|como\s+que\s+e|sem\s+foto)/i.test(normalized)) {
    return 'product_photo';
  }

  if (/(material|composicao|composição|tecido|couro|sintetico|caimento|medida|largura|solado|palmilha|peso|lavagem|garantia|troca|defeito|problema|reclamacao)/i.test(normalized)) {
    return 'technical_info';
  }

  return 'takeover_chat';
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

function buildTrackingReplyFromToolResult(toolName: string, rawResult: string, recentAiMessages?: Array<{ message_out: string | null }>): string | null {
  if (toolName !== 'get_order_details') return null;

  try {
    const result = JSON.parse(rawResult);

    // Check if this exact tracking code was already sent recently
    if (result?.tracking_code && recentAiMessages && recentAiMessages.length > 0) {
      const alreadySent = recentAiMessages.some((m: any) =>
        m.message_out && m.message_out.includes(result.tracking_code)
      );
      if (alreadySent) {
        // Don't force a template — let the AI respond contextually
        return null;
      }
    }

    if (result?.tracking_code) {
      const orderLabel = result.order_number ? `#${result.order_number}` : 'do seu pedido';
      const customerName = result.customer_name || '';
      const greeting = getTimeGreeting();
      const parts = [
        `${greeting}! 😊 Encontrei o rastreio do pedido ${orderLabel}${customerName ? ` em nome de *${customerName}*` : ''}.`,
        `Código de rastreio: ${result.tracking_code}`,
        result.tracking_link ? `Acompanhe aqui: ${result.tracking_link}` : null,
      ].filter(Boolean);

      return parts.join('\n');
    }

    if (!result?.error && result?.order_number) {
      return null; // Let the AI handle this contextually instead of a rigid template
    }
  } catch (_err) {
    return null;
  }

  return null;
}

function getTimeGreeting(): string {
  // Brazil timezone (UTC-3)
  const now = new Date();
  const brHour = (now.getUTCHours() - 3 + 24) % 24;
  if (brHour >= 5 && brHour < 12) return 'Bom dia';
  if (brHour >= 12 && brHour < 18) return 'Boa tarde';
  return 'Boa noite';
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
      name: "create_exchange_request",
      description: "Registra uma solicitação de troca de produto E gera automaticamente o código de postagem reversa (Correios via Melhor Envio). Use quando o cliente disser que quer trocar, devolver ou que o produto não serviu/não gostou. A IA DEVE coletar TODAS as informações antes de chamar esta ferramenta: qual pedido, qual produto, motivo detalhado, e tamanho desejado (se aplicável). Os dados do cliente (nome, CPF, endereço) serão PUXADOS AUTOMATICAMENTE do cadastro do pedido — NÃO peça novamente. Apenas CONFIRME o endereço antes de chamar. IMPORTANTE: Antes de chamar, use get_order_details para verificar a data de entrega e confirmar que o prazo de troca está dentro da política (30 dias a partir do recebimento).",
      parameters: {
        type: "object",
        properties: {
          order_number: {
            type: "string",
            description: "Número do pedido (ex: 4811)"
          },
          tiny_order_id: {
            type: "string",
            description: "ID interno Tiny do pedido"
          },
          store_name: {
            type: "string",
            description: "Nome da loja onde o pedido foi feito (Site, Loja Centro, ou Loja Perola)"
          },
          customer_name: {
            type: "string",
            description: "Nome do cliente (se já disponível no contexto)"
          },
          product_name: {
            type: "string",
            description: "Nome completo do produto que será trocado"
          },
          product_sku: {
            type: "string",
            description: "SKU do produto, se disponível"
          },
          product_size: {
            type: "string",
            description: "Tamanho atual do produto (ex: 37, 38, M, G)"
          },
          desired_size: {
            type: "string",
            description: "Tamanho desejado na troca, se aplicável"
          },
          reason_category: {
            type: "string",
            enum: ["tamanho", "defeito", "nao_gostou", "produto_errado", "outro"],
            description: "Categoria principal: 'tamanho' (ficou grande/pequeno/apertou), 'defeito' (problema de fabricação), 'nao_gostou' (estética/conforto), 'produto_errado' (enviamos errado), 'outro'"
          },
          reason_subcategory: {
            type: "string",
            description: "Subcategoria interpretada pela IA. Exemplos: 'comprimento_pequeno', 'comprimento_grande', 'largura_apertada', 'peito_do_pe', 'calcanhar_folgado', 'solado_descolando', 'costura_soltando', 'cor_diferente_da_foto', 'desconfortavel', 'material_diferente'"
          },
          ai_nuance_tags: {
            type: "array",
            items: { type: "string" },
            description: "Tags de nuance para análise futura. Ex: ['peito_do_pe', 'altura_produto', 'forma_pequena']. Interprete o que o cliente diz para gerar tags precisas sobre o FIT do calçado."
          },
          customer_verbatim: {
            type: "string",
            description: "Frase EXATA do cliente descrevendo o motivo da troca, sem editar"
          },
          ai_interpretation: {
            type: "string",
            description: "Interpretação da IA sobre o problema real. Ex: 'Cliente reporta que o calçado apertou no peito do pé. Isso indica que a FORMA do modelo é estreita na região do metatarso, não necessariamente que o comprimento está errado. Recomenda-se numeração maior OU modelo com forma mais larga.'"
          },
          fit_area: {
            type: "string",
            description: "Área do pé afetada (se troca por tamanho): 'comprimento', 'largura', 'peito_do_pe', 'calcanhar', 'bico', 'cano', 'palmilha', 'geral'"
          },
          fit_detail: {
            type: "string",
            description: "Detalhe sobre o fit: 'apertado', 'folgado', 'curto', 'longo', 'alto', 'baixo'"
          },
          address_confirmed: {
            type: "boolean",
            description: "Se o cliente confirmou que o endereço cadastrado está correto. DEVE ser true para gerar o código de postagem."
          }
        },
        required: ["product_name", "reason_category", "customer_verbatim", "ai_interpretation", "tiny_order_id"],
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

        const ordersToUse = filtered.filter((o: any) => {
          const sit = (o.situacao || '').toLowerCase();
          return sit !== 'cancelado' && sit !== 'cancelled';
        });

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
            const sit = (o.situacao || '').toLowerCase();
            return termWords.some((word: string) => name.includes(word)) && sit !== 'cancelado' && sit !== 'cancelled';
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

  if (toolName === 'create_exchange_request') {
    // Determine if auto-approve or needs human review
    const isSimple = ['tamanho'].includes(args.reason_category) && !['defeito'].includes(args.reason_category);
    const requiresHuman = ['defeito', 'produto_errado'].includes(args.reason_category);

    // ── Pull customer data from registration (no need to ask again) ──
    let customerData: any = null;

    // Try to find customer registration by phone suffix
    const phoneSuffix = phone.replace(/\D/g, '').slice(-8);
    const { data: regByPhone } = await supabase
      .from('customer_registrations')
      .select('*')
      .ilike('whatsapp', `%${phoneSuffix}`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (regByPhone) customerData = regByPhone;

    const customerName = args.customer_name || customerData?.full_name || null;
    const customerCpf = customerData?.cpf || null;
    const customerCep = customerData?.cep || null;
    const customerAddress = customerData?.address || null;
    const customerNumber = customerData?.address_number || null;
    const customerDistrict = customerData?.neighborhood || null;
    const customerCity = customerData?.city || null;
    const customerState = customerData?.state || null;
    const customerEmail = customerData?.email || null;

    const exchangeData: Record<string, any> = {
      phone,
      customer_name: customerName,
      order_number: args.order_number || null,
      tiny_order_id: args.tiny_order_id || null,
      product_name: args.product_name,
      product_sku: args.product_sku || null,
      product_size: args.product_size || null,
      desired_size: args.desired_size || null,
      reason_category: args.reason_category || 'outro',
      reason_subcategory: args.reason_subcategory || null,
      ai_nuance_tags: args.ai_nuance_tags || [],
      customer_verbatim: args.customer_verbatim || null,
      ai_interpretation: args.ai_interpretation || null,
      fit_area: args.fit_area || null,
      fit_detail: args.fit_detail || null,
      auto_approved: isSimple && !requiresHuman,
      requires_human_review: requiresHuman,
      status: requiresHuman ? 'solicitado' : (isSimple ? 'aprovado' : 'solicitado'),
      whatsapp_number_id: whatsappNumberId || null,
    };

    const { data: exchangeRow, error: exchangeErr } = await supabase
      .from('exchange_requests')
      .insert(exchangeData)
      .select('id')
      .single();

    if (exchangeErr) {
      console.error('[concierge] Exchange request creation error:', exchangeErr);
      return JSON.stringify({ error: 'Erro ao registrar solicitação de troca.' });
    }

    console.log(`[concierge] Exchange request created: ${exchangeRow.id} | category=${args.reason_category} | auto_approved=${isSimple && !requiresHuman}`);

    // ── Generate reverse shipping via Melhor Envio (Correios only) ──
    let reverseShippingInfo: string | null = null;
    let reverseInstructions: string | null = null;
    if (isSimple && !requiresHuman && customerCep && customerCpf && customerName) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

        const reverseResp = await fetch(`${supabaseUrl}/functions/v1/exchange-reverse-shipping`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            exchange_request_id: exchangeRow.id,
            customer_name: customerName,
            customer_cpf: customerCpf,
            customer_email: customerEmail,
            customer_phone: phone,
            customer_cep: customerCep,
            customer_address: customerAddress,
            customer_number: customerNumber,
            customer_district: customerDistrict,
            customer_city: customerCity,
            customer_state: customerState,
            product_name: args.product_name,
            insurance_value: 100,
          }),
        });

        if (reverseResp.ok) {
          const reverseData = await reverseResp.json();
          if (reverseData.success) {
            const code = reverseData.tracking_code || reverseData.melhor_envio_order_id;
            reverseShippingInfo = `Código de postagem: ${code} | Correios (${reverseData.service || reverseData.carrier}) | Prazo: ${reverseData.delivery_days || '?'} dias úteis`;
            if (reverseData.label_url) {
              reverseShippingInfo += ` | Etiqueta: ${reverseData.label_url}`;
            }
            reverseInstructions = reverseData.instructions || 'Leve o pacote até uma agência dos Correios mais próxima e informe o código de postagem no balcão.';
          } else {
            reverseShippingInfo = `Erro: ${reverseData.message || reverseData.error || 'erro desconhecido'}. Equipe será notificada.`;
          }
        }
      } catch (e) {
        console.error('[concierge] Reverse shipping error:', e);
        reverseShippingInfo = 'Erro ao gerar código de postagem. Equipe será notificada.';
      }
    } else if (isSimple && !requiresHuman && (!customerCep || !customerCpf)) {
      reverseShippingInfo = 'Dados cadastrais incompletos para gerar código automaticamente. Equipe será notificada.';
    }

    // Also create a support ticket for visibility
    try {
      const deadline = new Date();
      deadline.setMinutes(deadline.getMinutes() + (requiresHuman ? 30 : 120));
      
      await supabase.from('support_tickets').insert({
        subject: `Troca: ${args.product_name} - ${args.reason_category}`,
        description: `Solicitação de troca registrada pela Bia.\n\nProduto: ${args.product_name}\nTamanho atual: ${args.product_size || 'N/I'}\nTamanho desejado: ${args.desired_size || 'N/I'}\nMotivo: ${args.reason_category} - ${args.reason_subcategory || ''}\nVerbatim cliente: "${args.customer_verbatim}"\nInterpretação IA: ${args.ai_interpretation}\nFit: ${args.fit_area || 'N/A'} - ${args.fit_detail || 'N/A'}\nNuance tags: ${(args.ai_nuance_tags || []).join(', ')}\n${reverseShippingInfo ? `\nLogística reversa: ${reverseShippingInfo}` : ''}\nEndereço: ${customerAddress || 'N/I'}, ${customerNumber || ''} - ${customerCity || ''}/${customerState || ''}\n\nInstância WhatsApp: ${whatsappNumberId || 'N/I'}`,
        priority: requiresHuman ? 'high' : 'medium',
        customer_name: customerName,
        customer_phone: phone,
        deadline_at: deadline.toISOString(),
        source: 'bia_ai',
      });
    } catch (e) {
      console.error('[concierge] Exchange ticket error:', e);
    }

    const result: Record<string, any> = {
      exchange_created: true,
      exchange_id: exchangeRow.id,
      auto_approved: isSimple && !requiresHuman,
      requires_human_review: requiresHuman,
      status: exchangeData.status,
      customer_data_found: !!customerData,
      customer_address_used: customerCep ? `${customerAddress || ''}, ${customerNumber || ''} - ${customerDistrict || ''}, ${customerCity || ''}/${customerState || ''} - CEP ${customerCep}` : null,
    };

    if (reverseShippingInfo) result.reverse_shipping = reverseShippingInfo;
    if (reverseInstructions) result.correios_instructions = reverseInstructions;

    if (requiresHuman) {
      result.message = 'Solicitação de troca registrada. Como envolve defeito/produto errado, nossa equipe vai analisar e entrar em contato.';
    } else if (isSimple && reverseShippingInfo && !reverseShippingInfo.includes('Erro')) {
      result.message = 'Troca aprovada! Código de postagem reversa gerado via Correios. O cliente deve levar o pacote até uma agência dos Correios.';
    } else if (isSimple) {
      result.message = 'Troca aprovada! A equipe vai gerar o código de postagem e enviar.';
    } else {
      result.message = 'Solicitação de troca registrada. Nossa equipe vai analisar e retornar em breve.';
    }

    return JSON.stringify(result);
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

    // Try to get customer name from the AI's summary or from recent tool results
    let customerName: string | null = null;
    try {
      const { data: recentLogs } = await supabase
        .from('ai_conversation_logs')
        .select('message_out, tool_called')
        .eq('phone', phone)
        .order('created_at', { ascending: false })
        .limit(10);

      for (const log of recentLogs || []) {
        if (log.message_out) {
          // Extract customer name from Bia's messages like "*Cliente:* Helia Maria de Oliveira"
          const nameMatch = log.message_out.match(/\*Cliente:\*\s*(.+)/i);
          if (nameMatch) { customerName = nameMatch[1].trim(); break; }
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

    await createAiAssistanceRequest(supabase, {
      phone,
      customerName,
      whatsappNumberId,
      requestType: classifyConciergeRequestType(`${ticketSubject}\n${ticketDescription}`),
      summary: ticketDescription || ticketSubject,
      priority: ticketPriority,
    });

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
    const { phone, messageText, whatsappNumberId, channel = 'whatsapp', mediaUrl = null, mediaType = null } = await req.json();

    if (!phone || (!messageText && !mediaUrl)) {
      return new Response(JSON.stringify({ error: 'phone and messageText or mediaUrl required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ─── Transcribe audio if present ───────────────────────────────────
    let transcribedText: string | null = null;
    if (mediaType === 'audio' && mediaUrl) {
      console.log(`[concierge] Transcribing audio for ${phone}...`);
      transcribedText = await transcribeAudio(mediaUrl);
      if (transcribedText) {
        console.log(`[concierge] Audio transcribed: "${transcribedText.slice(0, 100)}"`);
      } else {
        console.log(`[concierge] Audio transcription failed, will inform user`);
      }
    }

    // Use transcribed text if original message is just a placeholder
    const effectiveMessageText = transcribedText || messageText || '';
    if (!effectiveMessageText.trim() && mediaType !== 'image') {
      return new Response(JSON.stringify({ success: true, handled: false, reason: 'no_text_content' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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

    const incomingMessageText = effectiveMessageText.trim().slice(0, 500);
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
    // Skip debounce text comparison for audio/image — DB stores empty/placeholder text
    // while incomingMessageText contains the transcription or description
    const isMediaMessage = mediaType === 'audio' || mediaType === 'image';
    if (!isMediaMessage && latestIncomingText && incomingMessageText && latestIncomingText !== incomingMessageText) {
      console.log(`[concierge] Debounced fragmented message for ${normalizedPhone}; newer input detected.`);
      return new Response(JSON.stringify({ success: true, handled: false, reason: 'debounced_newer_message' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let recentIncomingQuery = supabase
      .from('whatsapp_messages')
      .select('message, created_at, media_type, media_url')
      .eq('phone', normalizedPhone)
      .eq('direction', 'incoming')
      .gte('created_at', aggregationCutoff)
      .order('created_at', { ascending: true });

    if (whatsappNumberId) {
      recentIncomingQuery = recentIncomingQuery.eq('whatsapp_number_id', whatsappNumberId);
    }

    const { data: recentIncomingMessages } = await recentIncomingQuery;
    const aggregatedIncomingText = joinMeaningfulMessages(recentIncomingMessages || []).slice(0, 500);
    const combinedMessage = aggregatedIncomingText
      || sanitizeMediaPlaceholderText(incomingMessageText)
      || (mediaType === 'image' ? 'O cliente enviou uma imagem.' : '');
    const referencesVisual = isVisualReferenceMessage(combinedMessage);

    let relevantAttachment: { media_url: string; media_type: string } | null = mediaUrl && mediaType && ['image', 'document'].includes(mediaType)
      ? { media_url: mediaUrl, media_type: mediaType }
      : null;

    if (!relevantAttachment && referencesVisual) {
      let latestAttachmentQuery = supabase
        .from('whatsapp_messages')
        .select('media_url, media_type, created_at')
        .eq('phone', normalizedPhone)
        .eq('direction', 'incoming')
        .in('media_type', ['image', 'document'])
        .not('media_url', 'is', null)
        .gte('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(1);

      if (whatsappNumberId) {
        latestAttachmentQuery = latestAttachmentQuery.eq('whatsapp_number_id', whatsappNumberId);
      }

      const { data: latestAttachmentRows } = await latestAttachmentQuery;
      const latestAttachment = latestAttachmentRows?.[0];
      relevantAttachment = latestAttachment?.media_url ? latestAttachment : null;
    }

    const attachmentAnalysis = relevantAttachment
      ? await analyzeIncomingAttachment({
          mediaUrl: relevantAttachment.media_url,
          mediaType: relevantAttachment.media_type,
          promptContext: combinedMessage,
        })
      : null;

    const currentMessageForAi = attachmentAnalysis?.analysis
      ? `${combinedMessage}\n\n[ANÁLISE DO ANEXO]\n${attachmentAnalysis.analysis}`.trim()
      : combinedMessage;

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
        const fallbackSearchRaw = await executeToolCall('search_customer_orders', { search_term: fallbackCpf }, stores, supabase, normalizedPhone, whatsappNumberId);
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
        }, stores, supabase, normalizedPhone, whatsappNumberId);

        const forcedTrackingReply = buildTrackingReplyFromToolResult('get_order_details', trackingResult, recentAiLogs);
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

          if (channel === 'instagram') {
            sendFn = 'meta-messenger-send';
            delete sendBody.phone;
            sendBody.recipientId = normalizedPhone;
            sendBody.channel = 'instagram';
          } else if (whatsappNumberId) {
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
            channel: channel === 'instagram' ? 'instagram' : undefined,
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
    const greeting = getTimeGreeting();
    const systemPrompt = `Você é a Bia, assistente virtual de SUPORTE da Banana Calçados. Você é simpática, acolhedora e fala como uma pessoa real no WhatsApp — nunca como robô.

PERSONALIDADE E TOM:
- Comece SEMPRE a primeira mensagem de uma conversa com uma saudação natural: "${greeting}!" seguida de algo acolhedor como "tudo bem?", "como posso te ajudar?", etc.
- Fale de forma natural e humana. Varie suas frases. Não use sempre a mesma estrutura.
- Use emojis com moderação (1-2 por mensagem), mas de forma natural.
- Quando o cliente continuar conversando, MANTENHA O CONTEXTO. Releia o histórico antes de responder.
- Se você já deu uma informação (rastreio, nome, pedido), NÃO repita. Apenas confirme de forma natural: "Isso mesmo!", "É esse aí!", "Tá certinho o que te mandei antes 😊"
- Adapte seu tom ao do cliente: se ele está tranquilo, seja leve; se está nervoso ou irritado, seja empática e acolhedora.
- Não termine TODAS as mensagens com perguntas. Às vezes só responda naturalmente.

EMPATIA E SITUAÇÕES DIFÍCEIS:
- Se o cliente estiver irritado, frustrado ou com pressa: acolha primeiro ("Entendo sua frustração", "Imagino como isso é chato"), depois resolva.
- Se o pedido está atrasado: diga que vai verificar e ajudar. Nunca minimize a preocupação do cliente.
- Se não encontrar o rastreio: NÃO diga simplesmente "não tem rastreio". Diga algo como "O rastreio ainda não apareceu no sistema, mas vou abrir um chamado pra nossa equipe verificar e te dar um retorno rapidinho! 😊" e use transfer_to_human com prioridade adequada.
- Se o cliente insistir em algo que você não resolve: transfira para humano com empatia, informe o horário de atendimento (Seg-Sex 9h às 18h) e diga que a equipe vai entrar em contato.
- Faça o cliente sentir que estamos fazendo TUDO ao nosso alcance pra resolver.

PROIBIÇÕES ABSOLUTAS (ALUCINAÇÕES):
- NUNCA invente números de telefone, 0800, SAC ou contatos de transportadoras. Você NÃO sabe esses dados.
- NUNCA invente informações que você não obteve das ferramentas (rastreio, datas, nomes, endereços).
- NUNCA invente prazos de entrega específicos. Use APENAS dados reais das ferramentas.
- NUNCA diga "amanhã", "hoje" ou "segunda-feira" para previsões de entrega sem verificar se é dia útil.
- Se o cliente perguntar contato da transportadora, diga: "Vou verificar com a equipe o contato correto e te retorno!" e use transfer_to_human.
- Se não tem certeza de uma informação, NÃO invente. Diga que vai verificar e abra um chamado.

CONSCIÊNCIA DE DIAS ÚTEIS (IMPORTANTE):
- Transportadoras NÃO entregam em finais de semana (sábado/domingo) nem feriados.
- Se o cliente reclamar de uma tentativa de entrega, NÃO diga automaticamente "vão tentar de novo amanhã". Considere:
  * Se hoje é sexta-feira → próxima tentativa será segunda-feira (ou próximo dia útil)
  * Se hoje é sábado/domingo → próxima tentativa será segunda-feira (ou próximo dia útil)
  * Se for feriado → próxima tentativa será no próximo dia útil
- Sempre diga "no próximo dia útil" ao invés de "amanhã" quando não tiver certeza.
- Data de hoje: ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.

SEU PAPEL (APENAS):
- Ajudar clientes com rastreio de pedidos usando as ferramentas disponíveis
- Informar sobre produtos comprados, status e detalhes do pedido
- PROCESSAR SOLICITAÇÕES DE TROCA/DEVOLUÇÃO (novo! detalhes abaixo)
- Direcionar para atendente humano quando necessário
- Responder dúvidas básicas usando a base de conhecimento

FLUXO DE TROCA/DEVOLUÇÃO (IMPORTANTE):
Quando o cliente disser que quer trocar, devolver, que o produto não serviu, ficou apertado, grande, etc.:
1. Primeiro, identifique QUAL pedido e QUAL produto. Se não souber, pergunte: "Qual pedido você gostaria de trocar? Me passa seu CPF que localizo rapidinho! 😊"
2. OBRIGATÓRIO: Use get_order_details para buscar detalhes do pedido. Verifique a DATA DE ENTREGA. O prazo começa A PARTIR DO RECEBIMENTO.
3. VALIDE O PRAZO: Se passaram mais de 30 dias da entrega → informe com empatia que o prazo expirou e transfira para humano. Dentro do prazo → prossiga.
4. Pergunte o MOTIVO da troca de forma empática: "Entendo! E o que aconteceu com o produto? Ficou apertado, grande, ou foi outro motivo?"
5. Se TAMANHO, investigue: "Apertou onde? No comprimento, na largura, no peito do pé?"
6. Se DEFEITO, peça foto: "Pode me mandar uma foto do defeito? 📸"
7. Pergunte o tamanho desejado (se troca por tamanho).
8. CONFIRME O ENDEREÇO (os dados são puxados do cadastro, NÃO peça de novo): "Seu endereço cadastrado é Rua X, 123 - Bairro Y. Está correto? É de lá que você vai postar?"
9. Com TUDO confirmado, use create_exchange_request. INTERPRETE o motivo para classificar corretamente.
10. Após registrar, informe:
   - Se aprovada com código: "Sua troca foi aprovada! 🎉 Seu código de postagem é: [CÓDIGO]. Leve o pacote até uma *agência dos Correios* mais próxima e informe esse código no balcão. Prazo: ~X dias úteis."
   - SEMPRE diga que deve ir a uma AGÊNCIA DOS CORREIOS. Nunca mencione transportadoras.
   - Se revisão humana: "Registrei e nossa equipe vai analisar com prioridade! Seg-Sex 9h às 18h 😊"

POLÍTICA DE TROCA (PRAZOS A PARTIR DO RECEBIMENTO):
- Troca por tamanho: 30 dias → aprovação automática + código Correios
- Defeito: 90 dias → análise humana + foto
- Arrependimento: 7 dias (CDC)
- Produto errado: sem prazo fixo → prioridade alta
- Frete reverso: cliente NÃO paga em defeito/produto errado
- LOGÍSTICA REVERSA: SEMPRE Correios (PAC/SEDEX). NUNCA transportadora privada.
- Destino fixo: Loja Tiny Pérola, Gov. Valadares/MG
- Produto: sem uso, com etiqueta, embalagem original

O QUE VOCÊ NÃO PODE FAZER (PROIBIDO):
- NUNCA fale sobre preços, valores ou promoções
- NUNCA ofereça produtos novos, modelos disponíveis, fotos ou catálogos
- NUNCA tente vender nada
- NUNCA prometa enviar fotos, imagens ou vídeos de catálogo
- NUNCA fale sobre disponibilidade de estoque, tamanhos ou cores
- Se a cliente pedir algo de vendas, diga "Vou te conectar com uma de nossas consultoras! 😊" e use transfer_to_human

SOBRE IMAGENS ENVIADAS PELO CLIENTE:
- Você CONSEGUE analisar fotos e prints enviados pelo cliente quando eles vierem anexados no contexto.
- Se a cliente mandar uma imagem e logo depois perguntar "o que é isso?", "viu a foto?" ou algo parecido, trate isso como continuação da imagem mais recente.
- Se houver um bloco [ANÁLISE DO ANEXO] na mensagem atual, trate-o como leitura real da imagem ou PDF enviado.
- Se o CPF, pedido, rastreio, data, link ou qualquer outro dado estiver visível nessa análise, use esse dado diretamente e NÃO peça de novo.
- Quando a mensagem atual for sobre o anexo, responda primeiro sobre ele e só depois retome qualquer assunto anterior.
- Diferencie bem: você pode ANALISAR a imagem enviada pela cliente, mas NÃO pode oferecer fotos de catálogo nem prometer enviar novas imagens.

FLUXO DE RASTREIO E DETALHES DO PEDIDO:
1. Cliente pede rastreio ou informação do pedido → peça PRIMEIRO o CPF com uma frase natural: "Me passa seu CPF que eu busco rapidinho pra você! 😊"
2. Só use nome como plano B quando a pessoa realmente não souber o CPF
3. Use search_customer_orders para buscar — os resultados já incluem os produtos comprados
4. Se encontrar UM ÚNICO pedido, confirme o nome e o produto com o cliente de forma natural: "Achei aqui! É o pedido #XXXX em nome de Fulana, certo?"
5. Se encontrar VÁRIOS pedidos, liste de forma organizada mostrando: número, data, produto(s) e loja. NÃO mostre valores/preços. Pergunte qual deseja.
6. Quando o cliente ESCOLHER ou CONFIRMAR um pedido, use IMEDIATAMENTE get_order_details para buscar rastreio e mais detalhes
7. Após obter o rastreio, envie código + link clicável de forma natural
8. Se o cliente perguntar qual produto comprou, você já tem essa info nos resultados — responda diretamente
9. Se não encontrar pelo nome, peça o CPF; se não encontrar pelo CPF, acolha e use transfer_to_human
10. NUNCA use transfer_to_human se você ainda tem informação de pedido para consultar

LEITURA DE CONTEXTO (CRÍTICO):
- SEMPRE releia as últimas mensagens antes de responder.
- Se você já enviou um código de rastreio e o cliente manda CPF ou confirma, NÃO repita o rastreio. Confirme que está tudo certo: "É esse mesmo, [nome]! O rastreio que te mandei tá certinho 😊 Conseguiu acompanhar?"
- Se o cliente muda de assunto, acompanhe a mudança naturalmente.
- Se o cliente faz uma pergunta de acompanhamento (follow-up), conecte com o que já foi dito.
- Prolongue a conversa quando o cliente demonstrar que quer continuar. Pergunte se tem mais dúvidas, se conseguiu resolver, etc.

REGRAS GERAIS:
- Responda de forma curta e natural, como humano no WhatsApp
- NUNCA repita informações já ditas na conversa
- Se não conseguir resolver, use transfer_to_human com um resumo completo
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
        const text = sanitizeMediaPlaceholderText(msg.message);
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
    const currentMsgText = currentMessageForAi;

    // Build current message content - may include image for vision
    let currentUserContent: any = currentMsgText;
    const inlineImageUrl = attachmentAnalysis?.mediaKind === 'image' ? attachmentAnalysis.inlineDataUrl : null;
    const hasImage = Boolean(inlineImageUrl);
    
    if (hasImage) {
      const imageContextText = referencesVisual
        ? `${currentMsgText || 'A cliente está se referindo à imagem recém-enviada.'}\n\nConsidere a imagem anexada como o foco principal da pergunta atual.`
        : (currentMsgText || 'A cliente enviou esta imagem.');
      currentUserContent = [
        { type: 'text', text: imageContextText },
        { type: 'image_url', image_url: { url: inlineImageUrl } },
      ];
    }

    if (!lastHistoryMsg || lastHistoryMsg.role !== 'user' || lastHistoryMsg.content !== currentMsgText) {
      chatMessages.push({ role: 'user', content: currentUserContent });
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

      // Build Anthropic-format messages, converting image_url to Anthropic image format
      let anthropicMsgs: Array<{ role: 'user' | 'assistant'; content: any }> = conversationMsgs.map(m => {
        let content = m.content;
        // Convert OpenAI-style multimodal content to Anthropic format
        if (Array.isArray(content)) {
          content = content.map((part: any) => {
            if (part.type === 'image_url' && part.image_url?.url) {
              const parsed = parseDataUrl(part.image_url.url);
              if (parsed) {
                return {
                  type: 'image',
                  source: { type: 'base64', media_type: parsed.mimeType, data: parsed.data },
                };
              }
              return {
                type: 'text',
                text: '[Imagem anexada pelo cliente]',
              };
            }
            return part;
          });
        }
        return {
          role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
          content,
        };
      });
      // Anthropic requires first message to be 'user'
      if (anthropicMsgs.length === 0 || anthropicMsgs[0].role !== 'user') {
        anthropicMsgs = [{ role: 'user' as const, content: '(início da conversa)' }, ...anthropicMsgs];
      }
      // Merge consecutive same-role messages (only merge string contents)
      const merged: Array<{ role: 'user' | 'assistant'; content: any }> = [];
      for (const m of anthropicMsgs) {
        if (merged.length > 0 && merged[merged.length - 1].role === m.role && typeof m.content === 'string' && typeof merged[merged.length - 1].content === 'string') {
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
            const result = await executeToolCall(tu.name, resolvedToolArgs, stores, supabase, normalizedPhone, whatsappNumberId);
            console.log(`[concierge][anthropic] result: ${result.slice(0, 200)}`);
            toolExecutions.push({ name: tu.name, args: resolvedToolArgs, result: parseToolResult(result) });
            const forcedReply = buildTrackingReplyFromToolResult(tu.name, result, recentAiLogs);
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
            const result = await executeToolCall(fnName, resolvedFnArgs, stores, supabase, normalizedPhone, whatsappNumberId);
            console.log(`[concierge][lovable] result: ${result.slice(0, 200)}`);
            toolExecutions.push({ name: fnName, args: resolvedFnArgs, result: parseToolResult(result) });
            const forcedReply = buildTrackingReplyFromToolResult(fnName, result, recentAiLogs);
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

    if (channel === 'instagram') {
      sendFn = 'meta-messenger-send';
      delete sendBody.phone;
      sendBody.recipientId = normalizedPhone;
      sendBody.channel = 'instagram';
    } else if (whatsappNumberId) {
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
      channel: channel === 'instagram' ? 'instagram' : undefined,
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
