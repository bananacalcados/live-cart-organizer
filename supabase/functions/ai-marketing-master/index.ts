import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ALLOWED_ORIGINS = [
  "https://www.bananacalcados.com.br",
  "https://bananacalcados.com.br",
  "https://live-cart-organizer.lovable.app",
  "https://checkout.bananacalcados.com.br",
  "https://tqxhcyuxgqbzqwoidpie.supabase.co",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: getCorsHeaders(req) });

  try {
    const { objective, audience, instructions, customer_stats } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    if (!objective?.trim()) {
      return new Response(
        JSON.stringify({ error: "Informe o objetivo da campanha" }),
        { status: 400, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
      );
    }

    const statsContext = customer_stats
      ? `\nDados da base de clientes:
- Total: ${customer_stats.total}
- Loja física: ${customer_stats.local}
- Online: ${customer_stats.online}
- Faturamento: R$ ${customer_stats.revenue?.toLocaleString('pt-BR') || '0'}
- Segmentos RFM: ${customer_stats.segments?.join(', ') || 'N/A'}`
      : '';

    const systemPrompt = `Você é um diretor de marketing sênior especializado em varejo de calçados/moda omnichannel.

Seu papel é criar a DIRETRIZ ESTRATÉGICA GERAL (Diretriz Matriz) de uma campanha. Você NÃO gera planos detalhados por canal — isso será feito por IAs especialistas depois.

## Contexto do Negócio
- Loja de calçados ortopédicos e moda em Governador Valadares, MG (Jardim Pérola e Centro)
- Opera online (site + WhatsApp) e presencialmente
- WhatsApp Business API (Meta) para comunicação
- Base segmentada por RFM
- Presença no Instagram, email e site
${statsContext}

## O QUE VOCÊ DEVE GERAR
Uma diretriz estratégica que servirá de base para IAs especialistas de cada canal. Foque em:
1. Nome criativo e impactante para a campanha
2. Conceito central / Big Idea
3. Tom de voz e diretrizes de comunicação
4. Mensagens-chave que devem permear TODOS os canais
5. Público-alvo prioritário com análise de segmentos
6. Metas gerais da campanha
7. Período sugerido
8. Orçamento estimado

NÃO detalhe ações específicas por canal. Apenas a diretriz macro.`;

    const userPrompt = `Crie a Diretriz Matriz para:

**Objetivo:** ${objective}
**Público-alvo:** ${audience || "A definir com base nos segmentos RFM"}
${instructions ? `**Instruções adicionais:** ${instructions}` : ""}

Use a ferramenta generate_master_directive para responder.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "generate_master_directive",
              description: "Gera a diretriz estratégica matriz de uma campanha de marketing",
              parameters: {
                type: "object",
                properties: {
                  campaign_name: { type: "string", description: "Nome criativo e impactante" },
                  concept: { type: "string", description: "Conceito central / Big Idea da campanha em 2-3 frases" },
                  tone_of_voice: { type: "string", description: "Tom de voz e diretrizes de comunicação com exemplos" },
                  key_messages: {
                    type: "array",
                    items: { type: "string" },
                    description: "3-5 mensagens-chave que devem permear todos os canais"
                  },
                  target_audience: { type: "string", description: "Análise do público-alvo e segmentos prioritários" },
                  goals: {
                    type: "array",
                    items: { type: "string" },
                    description: "Metas gerais mensuráveis da campanha"
                  },
                  start_date_suggestion: { type: "string", description: "Data sugerida início YYYY-MM-DD" },
                  end_date_suggestion: { type: "string", description: "Data sugerida término YYYY-MM-DD" },
                  estimated_budget: { type: "number", description: "Orçamento estimado em R$" },
                  summary: { type: "string", description: "Resumo executivo em 3-5 frases" },
                  recommended_channels: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        channel_type: { type: "string", description: "grupo_vip, whatsapp_marketing, instagram, loja_fisica, email, site" },
                        priority: { type: "string", enum: ["alta", "media", "baixa"] },
                        rationale: { type: "string", description: "Por que este canal é relevante para esta campanha" }
                      },
                      required: ["channel_type", "priority", "rationale"]
                    },
                    description: "Canais recomendados com prioridade"
                  }
                },
                required: ["campaign_name", "concept", "tone_of_voice", "key_messages", "target_audience", "goals", "summary", "recommended_channels"],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "generate_master_directive" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit. Tente novamente em alguns segundos." }), {
          status: 429, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos de IA insuficientes." }), {
          status: 402, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const result = await response.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      throw new Error("AI did not return structured directive");
    }

    const directive = JSON.parse(toolCall.function.arguments);

    return new Response(
      JSON.stringify({ success: true, directive }),
      { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );

  } catch (e) {
    console.error("ai-marketing-master error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erro interno" }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  }
});
