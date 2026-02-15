import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { prompt, messages, mode = 'chat', phone, historyLimit = 30, enableRouting = false, enableTracking = false } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Append anti-repetition instruction to whatever prompt the flow provides
    const basePrompt = prompt || 'Você é um assistente da Banana Calçados. Responda de forma simpática, curta e objetiva em português brasileiro.';
    const antiRepetition = `

REGRA CRÍTICA SOBRE REPETIÇÃO:
- NUNCA repita informações (endereço, horário, preços, etc.) que você já mencionou nas últimas mensagens da conversa.
- Só repita uma informação se o cliente PERGUNTAR explicitamente de novo ou se já faz MUITAS mensagens desde a última vez que você disse.
- Releia o histórico antes de responder. Se a informação já está lá em cima, NÃO repita.
- Foque apenas em responder o que o cliente perguntou AGORA, de forma natural e humana.
- Evite parecer robótico. Varie suas respostas, não siga sempre o mesmo padrão de estrutura.
- Não termine TODAS as mensagens com uma pergunta. Às vezes apenas responda.`;

    // Build sector routing instructions if enabled
    let routingInstructions = '';
    let trackingInstructions = '';

    if (enableRouting) {
      const { data: sectors } = await supabase
        .from('chat_sectors')
        .select('id, name, description, ai_routing_keywords')
        .eq('is_active', true)
        .order('sort_order');

      if (sectors && sectors.length > 0) {
        routingInstructions = `

ROTEAMENTO DE SETOR:
Quando você identificar que o cliente precisa de atendimento humano especializado, classifique a intenção e indique o setor adequado.
Responda NORMALMENTE ao cliente, mas ao final da sua resposta, adicione uma tag invisível no formato: [SETOR:id_do_setor:classificacao]

Setores disponíveis:
${sectors.map(s => `- ID: ${s.id} | Nome: ${s.name} | Descrição: ${s.description || 'N/A'} | Palavras-chave: ${(s.ai_routing_keywords || []).join(', ')}`).join('\n')}

Regras:
- Só adicione a tag de setor quando o assunto claramente pertencer a um setor específico.
- Se for uma conversa genérica ou saudação, NÃO adicione tag de setor.
- Se o cliente pedir para falar com alguém, roteie para o setor mais adequado.
- A tag deve ser a ÚLTIMA coisa na sua resposta, após uma quebra de linha.`;
      }
    }

    if (enableTracking && phone) {
      // Look up tracking info for this customer
      let normalizedPhone = phone.replace(/\D/g, '');
      if (!normalizedPhone.startsWith('55') && normalizedPhone.length <= 11) {
        normalizedPhone = '55' + normalizedPhone;
      }

      // Search by phone, email, or name variants
      const phoneVariants = [normalizedPhone, normalizedPhone.replace(/^55/, '')];
      
      const { data: orders } = await supabase
        .from('expedition_orders')
        .select('shopify_order_name, customer_name, customer_email, freight_tracking_code, freight_carrier, freight_service, expedition_status, total_price, created_at')
        .or(phoneVariants.map(p => `customer_phone.ilike.%${p}%`).join(','))
        .order('created_at', { ascending: false })
        .limit(5);

      if (orders && orders.length > 0) {
        trackingInstructions = `

INFORMAÇÕES DE PEDIDOS DO CLIENTE (dados reais do sistema):
${orders.map(o => `- Pedido ${o.shopify_order_name || 'N/A'} | Status: ${o.expedition_status} | Rastreio: ${o.freight_tracking_code || 'Ainda não gerado'} | Transportadora: ${o.freight_carrier || 'N/A'} | Serviço: ${o.freight_service || 'N/A'} | Valor: R$${o.total_price || 0} | Data: ${o.created_at ? new Date(o.created_at).toLocaleDateString('pt-BR') : 'N/A'}`).join('\n')}

REGRAS DE RASTREIO:
- Se o cliente perguntar sobre rastreio/entrega, consulte os dados acima e responda com as informações reais.
- Se o código de rastreio existir, informe e indique que pode acompanhar pelo site da transportadora.
- Se o rastreio ainda não foi gerado, explique que o pedido está sendo processado.
- Seja preciso com os dados, não invente informações.`;
      }
    }

    const systemPrompt = basePrompt + antiRepetition + routingInstructions + trackingInstructions;

    // Build conversation history from DB if phone is provided
    let chatMessages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    if (phone) {
      // Normalize phone for query
      let normalizedPhone = phone.replace(/\D/g, '');
      if (!normalizedPhone.startsWith('55') && normalizedPhone.length <= 11) {
        normalizedPhone = '55' + normalizedPhone;
      }

      // Fetch recent messages for this conversation
      const { data: dbMessages } = await supabase
        .from('whatsapp_messages')
        .select('message, direction, created_at, media_type')
        .eq('phone', normalizedPhone)
        .order('created_at', { ascending: true })
        .limit(historyLimit);

      if (dbMessages && dbMessages.length > 0) {
        for (const msg of dbMessages) {
          // Skip media-only messages without text
          const text = msg.message?.trim();
          if (!text) continue;

          // Skip template messages (contain unresolved {{variables}})
          if (/\{\{\d+\}\}/.test(text) || /\{\{[a-zA-Z_]+\}\}/.test(text)) continue;

          chatMessages.push({
            role: msg.direction === 'incoming' ? 'user' : 'assistant',
            content: text,
          });
        }
      }
    }

    // Append any extra messages passed directly (fallback / override)
    if (messages && messages.length > 0) {
      chatMessages.push(...messages);
    }

    console.log(`AI responding for phone=${phone || 'N/A'}, history=${chatMessages.length - 1} msgs, routing=${enableRouting}, tracking=${enableTracking}`);

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
        return new Response(JSON.stringify({ error: 'Rate limit excedido. Tente novamente em alguns segundos.' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: 'Créditos insuficientes. Adicione créditos no workspace.' }), {
          status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const errorText = await response.text();
      console.error('AI gateway error:', status, errorText);
      return new Response(JSON.stringify({ error: 'Erro no serviço de IA' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    let reply = data.choices?.[0]?.message?.content || '';

    // Parse sector routing tag from reply
    let sectorId: string | null = null;
    let aiClassification: string | null = null;
    const sectorMatch = reply.match(/\[SETOR:([a-f0-9-]+):([^\]]+)\]/);
    if (sectorMatch) {
      sectorId = sectorMatch[1];
      aiClassification = sectorMatch[2];
      // Remove the tag from the visible reply
      reply = reply.replace(sectorMatch[0], '').trim();
    }

    // If routing detected, create assignment with round-robin
    let assignedTo: string | null = null;
    if (sectorId && phone) {
      try {
        // Get agents for this sector
        const { data: sectorAgents } = await supabase
          .from('chat_sector_agents')
          .select('user_id')
          .eq('sector_id', sectorId)
          .eq('is_active', true)
          .eq('is_online', true)
          .order('last_assigned_at', { ascending: true, nullsFirst: true });

        if (sectorAgents && sectorAgents.length > 0) {
          // Round-robin: pick the agent with oldest last_assigned_at
          const nextAgent = sectorAgents[0];
          assignedTo = nextAgent.user_id;

          // Update last_assigned_at
          await supabase.from('chat_sector_agents')
            .update({ last_assigned_at: new Date().toISOString(), current_load: 1 })
            .eq('sector_id', sectorId)
            .eq('user_id', assignedTo);
        }

        // Create assignment
        await supabase.from('chat_assignments').insert({
          phone: phone.replace(/\D/g, ''),
          sector_id: sectorId,
          assigned_to: assignedTo,
          assigned_by: 'ai',
          status: assignedTo ? 'active' : 'pending',
          ai_classification: aiClassification,
        });

        console.log(`Routed phone=${phone} to sector=${sectorId}, agent=${assignedTo}, classification=${aiClassification}`);
      } catch (routeErr) {
        console.error('Routing error:', routeErr);
      }
    }

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
    console.error('AI automation error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
