import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { prompt, type, campaignName, monthYear, messageCount, periodStart, periodEnd } = await req.json();

    if (!prompt) {
      return new Response(JSON.stringify({ error: 'prompt is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const msgCount = messageCount || 10;
    const periodInfo = periodStart && periodEnd
      ? `Período: de ${periodStart} até ${periodEnd}`
      : `Mês/Ano de referência: ${monthYear || 'atual'}`;

    const commonInstructions = `
Quantidade de mensagens solicitada: ${msgCount}
${periodInfo}

REGRAS OBRIGATÓRIAS PARA O ROTEIRO:
1. Gere EXATAMENTE ${msgCount} mensagens distribuídas ao longo do período
2. Para CADA mensagem, especifique:
   - 📅 **Data e horário sugerido** de envio
   - 📝 **Tipo**: texto, enquete, imagem, vídeo ou áudio
   - ✉️ **Mensagem pronta** para copiar e enviar (com emojis)
   - 🎨 **Se for imagem**: descreva DETALHADAMENTE a ideia da imagem (composição, cores, elementos, texto na arte) para que o designer possa produzir
   - 🎬 **Se for vídeo**: descreva o roteiro do vídeo (duração sugerida, cenas, texto/legenda)
   - 🎙️ **Se for áudio**: escreva o roteiro do áudio (tom de voz, o que falar)
   - 📊 **Se for enquete**: escreva a pergunta e as opções de resposta, indique se permite múltiplas respostas
3. Varie os tipos de conteúdo (não envie só texto!)
4. Inclua no mínimo: 2 enquetes, 2 sugestões de imagem, 1 vídeo e 1 áudio
5. No final, adicione uma seção "🎯 GUIA DE PRODUÇÃO DE CONTEÚDO" explicando como produzir cada tipo de material

Responda em português brasileiro, com emojis. Seja específico, prático e ACIONÁVEL.`;

    let systemPrompt = '';
    if (type === 'general') {
      systemPrompt = `Você é um estrategista de marketing especializado em grupos VIP de WhatsApp para uma marca de moda feminina chamada Banana Brasil.

O usuário vai descrever a estratégia geral do mês para os grupos VIP. Gere um ROTEIRO COMPLETO de mensagens contendo:

1. **Resumo da Estratégia** - Objetivo, tom de comunicação, público
2. **Cronograma de Mensagens** - Todas as ${msgCount} mensagens detalhadas

${commonInstructions}`;
    } else {
      systemPrompt = `Você é um estrategista de marketing especializado em campanhas para grupos VIP de WhatsApp de uma marca de moda feminina chamada Banana Brasil.

Nome da campanha: ${campaignName || 'Campanha'}

O usuário vai descrever o objetivo da campanha. Gere um ROTEIRO COMPLETO de mensagens contendo:

1. **Objetivo da Campanha** - O que queremos alcançar
2. **Tom de Comunicação** - Como as mensagens devem soar
3. **Cronograma de Mensagens** - Todas as ${msgCount} mensagens detalhadas com data, horário e conteúdo
4. **Gatilhos de Urgência** - Como criar senso de urgência
5. **Métricas de Sucesso** - Como medir o resultado

${commonInstructions}`;
    }

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded, tente novamente em alguns segundos.' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: 'Créditos insuficientes.' }), {
          status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const t = await response.text();
      console.error('AI gateway error:', response.status, t);
      return new Response(JSON.stringify({ error: 'AI gateway error' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    return new Response(JSON.stringify({ strategy: content }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in ai-vip-strategy:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
