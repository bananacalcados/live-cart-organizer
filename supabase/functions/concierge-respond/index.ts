import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// ─── Tiny ERP search helper ──────────────────────────────────────────────────

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

function extractTinyCpf(order: any): string {
  const cliente = order?.cliente || {};
  const directCpf = String(cliente.cpf_cnpj || cliente.cpf || '').replace(/\D/g, '');
  if (directCpf.length >= 11) return directCpf;

  const textSources = [order?.obs, order?.obs_interna, order?.observacoes, order?.observacao];
  for (const source of textSources) {
    if (!source) continue;
    const match = String(source).match(/\b(?:cpf|cpf_cnpj)\b[^0-9]*([\d.\-\/]{11,18})/i)
      || String(source).match(/\b([\d]{3}\.?[\d]{3}\.?[\d]{3}-?[\d]{2})\b/);
    if (match?.[1]) {
      const digits = match[1].replace(/\D/g, '');
      if (digits.length >= 11) return digits;
    }
  }

  return '';
}

// ─── Tool definitions for AI ─────────────────────────────────────────────────

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_customer_orders",
      description: "Busca pedidos de um cliente pelo nome completo ou CPF no sistema Tiny ERP. Pesquisa em todas as lojas (Shopify, Centro, Pérola). Use quando o cliente pedir rastreio, status de pedido, ou informações sobre uma compra.",
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
      name: "get_order_tracking",
      description: "Obtém detalhes completos de um pedido específico no Tiny, incluindo código de rastreio e transportadora. Use após encontrar o pedido com search_customer_orders.",
      parameters: {
        type: "object",
        properties: {
          tiny_order_id: {
            type: "string",
            description: "ID do pedido no Tiny ERP (obtido da busca anterior)"
          },
          store_name: {
            type: "string",
            description: "Nome da loja onde o pedido foi encontrado (Tiny Shopify, Loja Centro, ou Loja Perola)"
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
      description: "Transfere a conversa para um atendente humano. Use quando: a IA não consegue resolver, o cliente insiste em algo fora do escopo, ou precisa de atendimento especializado.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Motivo da transferência (ex: pedido_nao_encontrado, fora_do_escopo, solicitacao_cliente)"
          }
        },
        required: ["reason"],
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
): Promise<string> {
  if (toolName === 'search_customer_orders') {
    const originalTerm = args.search_term?.trim();
    const { normalized: term, digitsOnly, isCpf } = normalizeSearchTerm(originalTerm || '');
    if (!term || term.length < 3) {
      return JSON.stringify({ error: "Termo de busca muito curto. Peça o nome completo ou CPF ao cliente." });
    }

    const allResults: any[] = [];
    // Search priority: Tiny Shopify → Centro → Pérola
    for (const store of stores) {
      console.log(`[concierge] Searching Tiny "${store.name}" for: ${term}`);
      const orders = await searchTinyOrders(store.token, term);
      if (orders.length > 0) {
        let filtered = isCpf
          ? orders
          : orders.filter((o: any) => {
              const termLower = term.toLowerCase();
              const termWords = termLower.split(/\s+/).filter((w: string) => w.length >= 2);
              const name = (o.nome || '').toLowerCase();
              return termWords.some((word: string) => name.includes(word));
            });

        if (isCpf) {
          const detailedMatches = await Promise.all(
            filtered.slice(0, 12).map(async (order: any) => {
              const detail = await getTinyOrderDetail(store.token, String(order.id));
              const orderCpf = extractTinyCpf(detail);
              if (orderCpf && orderCpf === digitsOnly) {
                return { order, detail };
              }
              return null;
            })
          );

          const exactCpfMatches = detailedMatches.filter(Boolean) as Array<{ order: any; detail: any }>;
          if (exactCpfMatches.length > 0) {
            filtered = exactCpfMatches.map(({ order }) => order);
          }
        }

        for (const order of filtered.slice(0, 5)) {
          allResults.push({
            tiny_order_id: String(order.id),
            order_number: String(order.numero),
            date: order.data_pedido,
            customer_name: order.nome,
            total: parseFloat(order.valor || '0'),
            status: order.situacao,
            store_name: store.name,
            searched_by: isCpf ? 'cpf' : 'name',
            cpf_suffix: isCpf ? digitsOnly.slice(-4) : null,
          });
        }
      }
    }

    if (allResults.length === 0) {
      return JSON.stringify({
        found: false,
        message: isCpf
          ? "Nenhum pedido encontrado com esse CPF em nenhuma das lojas."
          : "Nenhum pedido encontrado com esse nome em nenhuma das lojas."
      });
    }

    return JSON.stringify({
      found: true,
      total_results: allResults.length,
      orders: allResults.slice(0, 10),
    });
  }

  if (toolName === 'get_order_tracking') {
    const tinyOrderId = args.tiny_order_id;
    const storeName = args.store_name;
    const store = stores.find(s => s.name.toLowerCase().includes(storeName.toLowerCase()));
    if (!store) {
      return JSON.stringify({ error: `Loja "${storeName}" não encontrada.` });
    }

    const pedido = await getTinyOrderDetail(store.token, tinyOrderId);
    if (!pedido) {
      return JSON.stringify({ error: "Não foi possível obter detalhes do pedido." });
    }

    // Extract tracking info from obs_interna or codigo_rastreamento
    const trackingCode = pedido.codigo_rastreamento || null;
    const carrier = pedido.nome_transportador || pedido.forma_envio || null;
    const items = (pedido.itens || []).map((i: any) => {
      const item = i.item || i;
      return `${item.descricao} (x${item.quantidade})`;
    });

    // Build tracking link
    let trackingLink: string | null = null;
    if (trackingCode) {
      const codeLower = (trackingCode || '').toUpperCase();
      // Correios codes usually match pattern: 2 letters + 9 digits + 2 letters (e.g., AB123456789BR)
      const isCorreios = /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(codeLower);
      if (isCorreios) {
        trackingLink = `https://www.linkcorreios.com.br/?id=${trackingCode}`;
      } else {
        // For other carriers, try generic tracking
        trackingLink = `https://www.muambator.com.br/pacotes/${trackingCode}/detalhes/`;
      }
    }

    return JSON.stringify({
      order_number: String(pedido.numero),
      date: pedido.data_pedido,
      status: pedido.situacao,
      total: parseFloat(pedido.valor || '0'),
      customer_name: pedido.cliente?.nome || null,
      items: items,
      tracking_code: trackingCode,
      tracking_link: trackingLink,
      carrier: carrier,
      store_name: store.name,
      obs: pedido.obs || null,
    });
  }

  if (toolName === 'transfer_to_human') {
    // Create a chat assignment for human support
    try {
      // Find the "Suporte" sector or first available
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
      message: "Conversa transferida para atendente humano.",
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
- Direcionar para atendente humano quando necessário
- Responder dúvidas básicas usando a base de conhecimento

O QUE VOCÊ NÃO PODE FAZER (PROIBIDO):
- NUNCA fale sobre preços, valores ou promoções
- NUNCA ofereça produtos, modelos, fotos ou catálogos
- NUNCA tente vender nada
- NUNCA prometa enviar fotos, imagens ou vídeos
- NUNCA fale sobre disponibilidade de estoque, tamanhos ou cores
- Se a cliente pedir algo de vendas, diga "Vou te conectar com uma de nossas consultoras! 😊" e use transfer_to_human

FLUXO DE RASTREIO:
1. Cliente pede rastreio → peça PRIMEIRO o CPF do pedido; aceite CPF com pontos e traços e trate isso normalmente removendo a máscara
2. Só use nome como plano B quando a pessoa realmente não souber o CPF
3. Use a ferramenta search_customer_orders para buscar
4. Se encontrar pedido via CPF, antes de passar o rastreio confirme com o cliente: nome encontrado + data da compra
5. Só depois da confirmação use get_order_tracking para obter o código de rastreio
6. Se encontrar vários pedidos, confirme qual é mostrando nome, data e valor
7. Envie o código + link clicável para rastreamento
8. Se não encontrar pelo nome, peça o CPF antes de transferir; se não encontrar pelo CPF, use transfer_to_human

REGRAS:
- Responda de forma curta e natural, como humano no WhatsApp
- Use emojis com moderação (máximo 2 por mensagem)
- NUNCA repita informações já ditas
- Se não conseguir resolver, use transfer_to_human
- Ao enviar rastreio, SEMPRE inclua o link clicável${knowledgeBlock}${routingBlock}`;

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
        chatMessages.push({
          role: msg.direction === 'incoming' ? 'user' : 'assistant',
          content: text.replace(/^\[IA\]\s*/i, '').slice(0, 500),
        });
      }
    }

    console.log(`[concierge] ${phone} | history=${chatMessages.length - 1} msgs | latest_included=${dbMessages?.[0]?.created_at || 'none'} | kb=${kbEntries?.length || 0} | stores=${stores.length}`);

    // ─── 6. AI Loop (with tool calling, max 3 turns) ────────────────────
    // Primary: Anthropic Claude | Fallback: Lovable AI (Gemini)
    let finalReply = '';
    let sectorId: string | null = null;
    let aiClassification: string | null = null;
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
            console.log(`[concierge][anthropic] tool: ${tu.name}(${JSON.stringify(tu.input)})`);
            const result = await executeToolCall(tu.name, tu.input || {}, stores, supabase, normalizedPhone);
            console.log(`[concierge][anthropic] result: ${result.slice(0, 200)}`);
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
            console.log(`[concierge][lovable] tool: ${fnName}(${JSON.stringify(fnArgs)})`);
            const result = await executeToolCall(fnName, fnArgs, stores, supabase, normalizedPhone);
            console.log(`[concierge][lovable] result: ${result.slice(0, 200)}`);
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
          customer_message: messageText,
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
      message_in: messageText,
      message_out: finalReply,
      ai_decision: sectorId ? `routed:${sectorId}` : 'responded',
      provider: usedProvider,
      stage: 'concierge',
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
