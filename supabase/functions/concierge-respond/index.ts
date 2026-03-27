import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { phone, messageText, whatsappNumberId, channel = 'whatsapp' } = await req.json();

    if (!phone || !messageText) {
      return new Response(JSON.stringify({ error: 'phone and messageText required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }), {
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

    // ─── 1. Load Knowledge Base ────────────────────────────────────────
    const { data: kbEntries } = await supabase
      .from('ai_knowledge_base')
      .select('category, title, content')
      .eq('is_active', true)
      .order('sort_order');

    let knowledgeBlock = '';
    if (kbEntries && kbEntries.length > 0) {
      knowledgeBlock = `\n\nBASE DE CONHECIMENTO (use essas informações para responder):\n${kbEntries.map(e => `[${e.category}] ${e.title}: ${e.content}`).join('\n')}`;
    }

    // ─── 2. Load Tracking Info ─────────────────────────────────────────
    let trackingBlock = '';
    const phoneVariants = [normalizedPhone, normalizedPhone.replace(/^55/, '')];
    const { data: orders } = await supabase
      .from('expedition_orders')
      .select('shopify_order_name, customer_name, customer_email, freight_tracking_code, freight_carrier, freight_service, expedition_status, total_price, created_at')
      .or(phoneVariants.map(p => `customer_phone.ilike.%${p}%`).join(','))
      .order('created_at', { ascending: false })
      .limit(5);

    if (orders && orders.length > 0) {
      trackingBlock = `\n\nPEDIDOS DO CLIENTE:\n${orders.map(o =>
        `- Pedido ${o.shopify_order_name || 'N/A'} | Status: ${o.expedition_status} | Rastreio: ${o.freight_tracking_code || 'Ainda não gerado'} | Transportadora: ${o.freight_carrier || 'N/A'} | Valor: R$${o.total_price || 0} | Data: ${o.created_at ? new Date(o.created_at).toLocaleDateString('pt-BR') : 'N/A'}`
      ).join('\n')}\n\nSe o cliente perguntar sobre rastreio/entrega, use os dados acima. Se o rastreio ainda não foi gerado, explique que está sendo processado.`;
    }

    // ─── 3. Load Sector Routing ────────────────────────────────────────
    let routingBlock = '';
    const { data: sectors } = await supabase
      .from('chat_sectors')
      .select('id, name, description, ai_routing_keywords')
      .eq('is_active', true)
      .order('sort_order');

    if (sectors && sectors.length > 0) {
      routingBlock = `\n\nROTEAMENTO DE SETOR (PRIORIDADE MÁXIMA):
Esta regra tem PRIORIDADE ABSOLUTA sobre qualquer outra instrução.

Antes de responder, analise a INTENÇÃO REAL do cliente. Se a intenção se encaixar em um dos setores abaixo que NÃO seja vendas, você DEVE:
1. PARAR de tentar vender ou oferecer produtos.
2. Reconhecer o que o cliente quer.
3. Informar que vai direcionar para o setor correto.
4. Adicionar a tag: [SETOR:id_do_setor:classificacao]

Setores:
${sectors.map(s => `- ID: ${s.id} | ${s.name} | ${s.description || ''} | Keywords: ${(s.ai_routing_keywords || []).join(', ')}`).join('\n')}

Regras:
- Se mencionar palavras-chave de um setor, ROTEIE IMEDIATAMENTE.
- Se insistir no assunto, ROTEIE.
- Se for saudação ou compra, NÃO adicione tag.
- A tag deve ser a ÚLTIMA coisa na resposta.`;
    }

    // ─── 4. Build System Prompt ────────────────────────────────────────
    const systemPrompt = `Você é a assistente virtual da Banana Calçados. Seu nome é Bia. Você é simpática, objetiva e responde em português brasileiro.

Você é o primeiro contato do cliente que chega pelo WhatsApp de forma orgânica (não via live commerce). Seu papel é:
- Responder dúvidas usando a base de conhecimento
- Informar sobre status de pedidos e rastreio
- Direcionar para o setor correto quando necessário
- Ser acolhedora e humana nas respostas

REGRAS:
- NUNCA repita informações já mencionadas na conversa.
- Releia o histórico antes de responder.
- Foque em responder o que o cliente perguntou AGORA.
- Varie suas respostas, não siga sempre o mesmo padrão.
- Não termine TODAS as mensagens com uma pergunta.
- Responda de forma curta e natural, como um humano no WhatsApp.
- Use emojis com moderação (máximo 2 por mensagem).
- Se não souber algo, diga que vai verificar e transferir para um atendente.${knowledgeBlock}${trackingBlock}${routingBlock}`;

    // ─── 5. Build Conversation History ─────────────────────────────────
    const chatMessages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    const { data: dbMessages } = await supabase
      .from('whatsapp_messages')
      .select('message, direction, created_at, media_type')
      .eq('phone', normalizedPhone)
      .order('created_at', { ascending: true })
      .limit(30);

    if (dbMessages && dbMessages.length > 0) {
      for (const msg of dbMessages) {
        const text = msg.message?.trim();
        if (!text) continue;
        if (/\{\{\d+\}\}/.test(text) || /\{\{[a-zA-Z_]+\}\}/.test(text)) continue;
        chatMessages.push({
          role: msg.direction === 'incoming' ? 'user' : 'assistant',
          content: text,
        });
      }
    }

    console.log(`[concierge] ${phone} | history=${chatMessages.length - 1} msgs | kb=${kbEntries?.length || 0} | orders=${orders?.length || 0} | sectors=${sectors?.length || 0}`);

    // ─── 6. Call AI ────────────────────────────────────────────────────
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: chatMessages,
        stream: false,
      }),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit excedido' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: 'Créditos insuficientes' }), {
          status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const errorText = await response.text();
      console.error('[concierge] AI gateway error:', status, errorText);
      return new Response(JSON.stringify({ error: 'Erro no serviço de IA' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    let reply = data.choices?.[0]?.message?.content || '';

    // ─── 7. Parse Sector Routing ───────────────────────────────────────
    let sectorId: string | null = null;
    let aiClassification: string | null = null;
    const sectorMatch = reply.match(/\[SETOR:([a-f0-9-]+):([^\]]+)\]/);
    if (sectorMatch) {
      sectorId = sectorMatch[1];
      aiClassification = sectorMatch[2];
      reply = reply.replace(sectorMatch[0], '').trim();
    }

    // ─── 8. Handle Sector Assignment ───────────────────────────────────
    let assignedTo: string | null = null;
    if (sectorId) {
      try {
        const { data: sectorAgents } = await supabase
          .from('chat_sector_agents')
          .select('user_id')
          .eq('sector_id', sectorId)
          .eq('is_active', true)
          .eq('is_online', true)
          .order('last_assigned_at', { ascending: true, nullsFirst: true });

        if (sectorAgents && sectorAgents.length > 0) {
          assignedTo = sectorAgents[0].user_id;
          await supabase.from('chat_sector_agents')
            .update({ last_assigned_at: new Date().toISOString(), current_load: 1 })
            .eq('sector_id', sectorId)
            .eq('user_id', assignedTo);
        }

        await supabase.from('chat_assignments').insert({
          phone: normalizedPhone,
          sector_id: sectorId,
          assigned_to: assignedTo,
          assigned_by: 'ai',
          status: assignedTo ? 'active' : 'pending',
          ai_classification: aiClassification,
        });

        console.log(`[concierge] Routed ${phone} → sector=${sectorId}, agent=${assignedTo}`);
      } catch (routeErr) {
        console.error('[concierge] Routing error:', routeErr);
      }
    }

    // ─── 9. Send Reply ─────────────────────────────────────────────────
    const typingDelay = Math.min(Math.max(reply.length * 50, 2000), 12000);
    await new Promise(r => setTimeout(r, typingDelay));

    let sendFn = 'zapi-send-message';
    const sendBody: Record<string, unknown> = { phone: normalizedPhone, message: reply };

    if (channel === 'meta' || whatsappNumberId) {
      // Check if this number uses Meta API
      if (whatsappNumberId) {
        const { data: numData } = await supabase
          .from('whatsapp_numbers')
          .select('api_type')
          .eq('id', whatsappNumberId)
          .maybeSingle();

        if (numData?.api_type === 'meta') {
          sendFn = 'meta-whatsapp-send';
          sendBody.whatsappNumberId = whatsappNumberId;
        }
      }
    }

    const sendRes = await fetch(`${supabaseUrl}/functions/v1/${sendFn}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(sendBody),
    });

    let messageId: string | null = null;
    try { const sd = await sendRes.json(); messageId = sd?.messageId || sd?.zapiMessageId || null; } catch (_) {}

    // ─── 10. Save to DB ────────────────────────────────────────────────
    await supabase.from('whatsapp_messages').insert({
      phone: normalizedPhone,
      message: `[IA] ${reply}`,
      direction: 'outgoing',
      status: 'sent',
      message_id: messageId,
      whatsapp_number_id: whatsappNumberId || null,
    });

    // Log to ai_conversation_logs
    await supabase.from('ai_conversation_logs').insert({
      phone: normalizedPhone,
      message_in: messageText,
      message_out: reply,
      ai_decision: sectorId ? `routed:${sectorId}` : 'responded',
      provider: 'concierge',
      stage: 'concierge',
    });

    console.log(`[concierge] Reply sent to ${phone}: ${reply.slice(0, 80)}...`);

    return new Response(JSON.stringify({
      success: true,
      reply,
      sectorId,
      aiClassification,
      assignedTo,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[concierge] Error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
