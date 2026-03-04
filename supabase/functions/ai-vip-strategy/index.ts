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

    const { prompt, type, campaignName, monthYear } = await req.json();

    if (!prompt) {
      return new Response(JSON.stringify({ error: 'prompt is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let systemPrompt = '';
    if (type === 'general') {
      systemPrompt = `Você é um estrategista de marketing especializado em grupos VIP de WhatsApp para uma marca de moda feminina chamada Banana Brasil.

O usuário vai descrever a estratégia geral do mês para os grupos VIP. Gere um documento completo de estratégia contendo:

1. **Objetivo do Mês** - Qual o foco principal
2. **Tom de Comunicação** - Como as mensagens devem soar
3. **Frequência de Envio** - Quantas mensagens por dia/semana
4. **Tipos de Conteúdo** - Mix ideal (texto, enquetes, fotos, vídeos, áudios)
5. **Temas Semanais** - Sugestão de temas para cada semana do mês
6. **Horários Recomendados** - Melhores horários para envio
7. **Dicas de Engajamento** - Estratégias para manter o grupo ativo

Mês/Ano de referência: ${monthYear || 'atual'}

Responda em português brasileiro, com emojis para facilitar a leitura. Seja específico e prático.`;
    } else {
      systemPrompt = `Você é um estrategista de marketing especializado em campanhas para grupos VIP de WhatsApp de uma marca de moda feminina chamada Banana Brasil.

Nome da campanha: ${campaignName || 'Campanha'}

O usuário vai descrever o objetivo da campanha. Gere um plano detalhado contendo:

1. **Objetivo da Campanha** - O que queremos alcançar
2. **Cronograma de Mensagens** - Dia a dia com horários sugeridos
3. **Roteiro de Mensagens** - Exemplos prontos para cada dia (texto, enquetes, mídias)
4. **Gatilhos de Urgência** - Como criar senso de urgência
5. **Métricas de Sucesso** - Como medir o resultado

Cada mensagem sugerida deve ser prática e pronta para copiar/enviar.
Responda em português brasileiro, com emojis. Seja específico e acionável.`;
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
