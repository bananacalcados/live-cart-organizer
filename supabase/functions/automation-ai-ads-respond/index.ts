import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const {
      phone,
      messageText,
      campaignId,
      whatsappNumberId,
      channel = 'zapi',
      historyLimit = 20,
    } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Load the campaign
    let campaign: any = null;
    if (campaignId) {
      const { data } = await supabase
        .from('ad_campaigns_ai')
        .select('*')
        .eq('id', campaignId)
        .eq('is_active', true)
        .maybeSingle();
      campaign = data;
    }

    // If no campaignId, try to detect via keyword matching
    if (!campaign && messageText) {
      const { data: campaigns } = await supabase
        .from('ad_campaigns_ai')
        .select('*')
        .eq('is_active', true);

      if (campaigns) {
        const msgLower = (messageText || '').toLowerCase().trim();
        campaign = campaigns.find((c: any) =>
          (c.activation_keywords || []).some((kw: string) =>
            msgLower.includes(kw.toLowerCase())
          )
        );
      }
    }

    if (!campaign) {
      return new Response(JSON.stringify({ error: 'No active campaign found', skip: true }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Find or create lead
    const normalizedPhone = phone.replace(/\D/g, '');
    let { data: existingLead } = await supabase
      .from('ad_leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .eq('campaign_id', campaign.id)
      .eq('is_active', true)
      .maybeSingle();

    if (!existingLead) {
      const { data: newLead } = await supabase
        .from('ad_leads')
        .insert({
          phone: normalizedPhone,
          campaign_id: campaign.id,
          temperature: 'frio',
          source: 'ad',
          event_id: campaign.event_id,
          whatsapp_number_id: whatsappNumberId,
          channel,
        })
        .select()
        .single();
      existingLead = newLead;
    }

    // 3. Load event info if campaign is linked to one
    let eventContext = '';
    if (campaign.event_id) {
      const { data: event } = await supabase
        .from('events')
        .select('id, name, starts_at, status, description')
        .eq('id', campaign.event_id)
        .maybeSingle();

      if (event) {
        const now = new Date();
        const brNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
        const eventDate = new Date(event.starts_at);
        const diffMs = eventDate.getTime() - brNow.getTime();
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

        let statusText = '';
        if (event.status === 'live') {
          statusText = 'A live está acontecendo AGORA! Mande o link para o cliente participar.';
        } else if (event.status === 'ended' || diffDays < 0) {
          statusText = `A live "${event.name}" já aconteceu. Informe que quando houver outra, você avisa. Pergunte se ele quer ficar na lista.`;
        } else if (diffDays === 0) {
          statusText = `A live "${event.name}" é HOJE! Crie expectativa e garanta que o cliente saiba o horário.`;
        } else {
          statusText = `A live "${event.name}" será em ${diffDays} dia(s), no dia ${eventDate.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. Crie expectativa!`;
        }

        eventContext = `
INFORMAÇÕES DO EVENTO/LIVE:
- Nome: ${event.name}
- Data: ${eventDate.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })} às ${eventDate.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}
- Status: ${statusText}
- Descrição: ${event.description || 'N/A'}`;
      }
    }

    // 4. Build product/payment context
    let productContext = '';
    if (campaign.product_info) {
      const pi = campaign.product_info;
      if (pi.catalogo && Array.isArray(pi.catalogo) && pi.catalogo.length > 0) {
        productContext = `
CATÁLOGO DE PRODUTOS DA CAMPANHA:
${pi.catalogo.map((p: any, i: number) => `${i + 1}. ${p.nome} — R$ ${p.preco}${p.detalhes ? ` (${p.detalhes})` : ''}${p.keywords?.length ? ` [ativado por: ${p.keywords.join(', ')}]` : ''}`).join('\n')}

IMPORTANTE: Quando o cliente mencionar um produto específico (pelas keywords ou nome), apresente as informações DAQUELE produto. Se não ficar claro qual produto, pergunte qual interessa.`;
      } else {
        productContext = `
INFORMAÇÕES DO PRODUTO/OFERTA:
${JSON.stringify(pi, null, 2)}`;
      }
    }
    if (campaign.payment_conditions) {
      productContext += `
CONDIÇÕES DE PAGAMENTO: ${campaign.payment_conditions}`;
    }

    // 5. Lead data context
    const collectedData = existingLead?.collected_data || {};
    const missingFields = (campaign.data_to_collect || []).filter(
      (f: string) => !collectedData[f]
    );

    let leadContext = `
DADOS DO LEAD:
- Telefone: ${normalizedPhone}
- Temperatura: ${existingLead?.temperature || 'frio'}
- Dados coletados: ${Object.keys(collectedData).length > 0 ? JSON.stringify(collectedData) : 'Nenhum ainda'}
- Dados faltando: ${missingFields.length > 0 ? missingFields.join(', ') : 'Todos coletados ✅'}`;

    // 6. Build objective instructions
    let objectiveInstructions = '';
    switch (campaign.objective) {
      case 'venda_direta':
        objectiveInstructions = `
OBJETIVO PRINCIPAL: VENDA DIRETA
- Apresente o produto/oferta de forma natural e envolvente.
- Colete os dados necessários (${(campaign.data_to_collect || []).join(', ')}).
- Tire dúvidas sobre o produto, tamanho, cor, etc.
- Ofereça condições de pagamento e gere link quando possível.
- Se o cliente NÃO comprar após algumas interações, tente novamente de forma sutil.
- ${campaign.post_sale_action === 'convite_live' && campaign.event_id ? 'Se o cliente COMPRAR ou demonstrar que não vai comprar agora, convide para a Live como alternativa.' : ''}`;
        break;
      case 'captacao_live':
        objectiveInstructions = `
OBJETIVO PRINCIPAL: CAPTAÇÃO PARA LIVE
- Explique sobre a Live: o que é, quando será, o que vai ter.
- Crie expectativa e urgência (vagas limitadas, ofertas exclusivas, etc).
- Colete os dados necessários (${(campaign.data_to_collect || []).join(', ')}).
- Confirme a participação do cliente.
- ${campaign.post_capture_action === 'oferta_produto' ? 'Se o cliente demonstrar interesse em comprar agora, ofereça produtos disponíveis.' : ''}`;
        break;
      case 'hibrido':
        objectiveInstructions = `
OBJETIVO: HÍBRIDO (VENDA + CAPTAÇÃO LIVE)
- Entenda primeiro o que trouxe o cliente (interesse em produto ou na live).
- Se interesse em COMPRA: apresente produto, tire dúvidas, ofereça pagamento.
- Se interesse na LIVE: explique sobre o evento, crie expectativa, confirme participação.
- Em AMBOS os casos, colete os dados necessários (${(campaign.data_to_collect || []).join(', ')}).
- Se não converter na venda, convide para a live. Se já captou para live, ofereça produtos.`;
        break;
    }

    // 7. Temperature classification instructions
    const temperatureInstructions = `
CLASSIFICAÇÃO DE TEMPERATURA DO LEAD:
Após cada interação, avalie a temperatura do lead e inclua no final da resposta:
[TEMPERATURA:valor]

Critérios:
- frio: Apenas recebeu a msg, não demonstrou interesse real
- morno: Respondeu, fez perguntas, mas sem compromisso
- quente: Demonstrou interesse claro (perguntou preço, tamanho, como comprar, confirmou presença na live)
- super_quente: Pediu link de pagamento, disse que vai comprar, ou confirmou presença com entusiasmo
- convertido: Comprou ou se cadastrou oficialmente para a live

A tag deve ser a ÚLTIMA coisa na resposta, após uma quebra de linha.`;

    // 8. Data extraction instructions
    const dataExtractionInstructions = `
EXTRAÇÃO DE DADOS:
Quando o cliente informar dados, inclua na resposta:
[DADOS:campo=valor]

Campos possíveis: ${(campaign.data_to_collect || []).join(', ')}
Exemplo: [DADOS:nome=Maria Silva] [DADOS:tamanho=38]

Importante: Colete os dados de forma NATURAL na conversa. Não faça um interrogatório.
Pergunte um dado por vez, de forma contextualizada.`;

    // 9. Assemble system prompt
    const basePrompt = campaign.prompt || 'Você é uma atendente simpática da Banana Calçados. Responda de forma natural, curta e envolvente em português brasileiro.';
    
    const systemPrompt = `${basePrompt}

${objectiveInstructions}
${eventContext}
${productContext}
${leadContext}

${temperatureInstructions}
${dataExtractionInstructions}

REGRAS GERAIS:
- Seja simpática, natural e humana. Nada de parecer robô.
- Mensagens CURTAS (máximo 3-4 linhas). Use emojis com moderação.
- NÃO repita informações que já disse nas mensagens anteriores.
- Varie suas respostas. Não siga sempre o mesmo padrão.
- Não termine TODAS as mensagens com pergunta. Às vezes apenas responda.
- Use o nome do cliente se já souber.
- Fuso horário: America/Sao_Paulo (horário de Brasília).`;

    // 10. Build chat history
    const chatMessages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    // Fetch only recent messages (last 2 hours) to avoid mixing old contexts
    const historyWindowCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: dbMessages } = await supabase
      .from('whatsapp_messages')
      .select('message, direction, created_at')
      .eq('phone', normalizedPhone)
      .gt('created_at', historyWindowCutoff)
      .order('created_at', { ascending: false })
      .limit(historyLimit);

    // Reverse to chronological order after fetching most recent
    const chronologicalMessages = (dbMessages || []).reverse();

    for (const msg of chronologicalMessages) {
      const text = msg.message?.trim();
      if (!text) continue;
      // Skip template placeholders
      if (/\{\{\d+\}\}/.test(text)) continue;
      // Skip messages from other AI agents (Concierge, Livete) to avoid context contamination
      if (text.startsWith('[IA]') || text.startsWith('[IA-CONCIERGE]') || text.startsWith('[IA-LIVETE]')) continue;
      // Skip mass dispatch messages
      if (text.length > 500) continue;
      chatMessages.push({
        role: msg.direction === 'incoming' ? 'user' : 'assistant',
        content: text.replace(/^\[IA-ADS\]\s*/i, ''),
      });
    }

    // Add current message if not already in history
    if (messageText) {
      const last = chatMessages[chatMessages.length - 1];
      if (!last || last.role !== 'user' || last.content !== messageText) {
        chatMessages.push({ role: 'user', content: messageText });
      }
    }

    console.log(`[ads-ai] Responding for phone=${normalizedPhone}, campaign=${campaign.name}, objective=${campaign.objective}, temperature=${existingLead?.temperature || 'frio'}`);

    // 11. Call AI
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
        return new Response(JSON.stringify({ error: 'Rate limit' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const errorText = await response.text();
      console.error('[ads-ai] Gateway error:', status, errorText);
      return new Response(JSON.stringify({ error: 'AI service error' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    let reply = data.choices?.[0]?.message?.content || '';

    // 12. Parse temperature tag
    let newTemperature: string | null = null;
    const tempMatch = reply.match(/\[TEMPERATURA:(\w+)\]/);
    if (tempMatch) {
      newTemperature = tempMatch[1];
      reply = reply.replace(tempMatch[0], '').trim();
    }

    // 13. Parse data extraction tags
    const dataMatches = [...reply.matchAll(/\[DADOS:(\w+)=([^\]]+)\]/g)];
    const extractedData: Record<string, string> = {};
    for (const m of dataMatches) {
      extractedData[m[1]] = m[2].trim();
      reply = reply.replace(m[0], '').trim();
    }

    // 14. Update lead with extracted data and temperature
    if (existingLead) {
      const updates: Record<string, any> = {
        last_ai_contact_at: new Date().toISOString(),
      };

      if (newTemperature && ['frio', 'morno', 'quente', 'super_quente', 'convertido'].includes(newTemperature)) {
        updates.temperature = newTemperature;
      }

      if (Object.keys(extractedData).length > 0) {
        updates.collected_data = { ...collectedData, ...extractedData };
        // Update name if extracted
        if (extractedData.nome) {
          updates.name = extractedData.nome;
        }
      }

      await supabase
        .from('ad_leads')
        .update(updates)
        .eq('id', existingLead.id);
    }

    // 15. Log the interaction
    await supabase.from('ai_conversation_logs').insert({
      phone: normalizedPhone,
      message_in: messageText,
      message_out: reply,
      stage: `ads_${campaign.objective}`,
      ai_decision: newTemperature ? `temperature:${newTemperature}` : null,
      provider: 'lovable',
    });

    return new Response(JSON.stringify({
      success: true,
      reply,
      campaignId: campaign.id,
      campaignName: campaign.name,
      leadId: existingLead?.id,
      temperature: newTemperature || existingLead?.temperature || 'frio',
      extractedData,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[ads-ai] Error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
