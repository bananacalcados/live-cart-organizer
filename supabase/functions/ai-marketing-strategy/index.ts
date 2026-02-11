import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { objective, audience, instructions, customer_stats } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    if (!objective?.trim()) {
      return new Response(
        JSON.stringify({ error: "Informe o objetivo da campanha" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const statsContext = customer_stats
      ? `\nDados da base de clientes disponível:
- Total de clientes: ${customer_stats.total}
- Clientes loja física: ${customer_stats.local}
- Clientes online: ${customer_stats.online}
- Faturamento total: R$ ${customer_stats.revenue?.toLocaleString('pt-BR') || '0'}
- Segmentos RFM disponíveis: ${customer_stats.segments?.join(', ') || 'N/A'}`
      : '';

    const systemPrompt = `Você é um estrategista sênior de marketing digital especializado em varejo de calçados/moda, campanhas omnichannel 360° e marketing integrado.

Seu papel é criar ESTRATÉGIAS 360° COMPLETAS que cobrem TODOS os canais de comunicação. Pense como um diretor de marketing que planeja cada detalhe.

Contexto do negócio: Loja de calçados ortopédicos e moda que opera em lojas físicas (Governador Valadares, MG - Jardim Pérola e Centro) e online. Usa WhatsApp Business API (Meta) para comunicação direta. Tem base segmentada por RFM. Tem presença no Instagram, e-mail marketing, site e ações presenciais.

CANAIS DISPONÍVEIS (use TODOS que fizerem sentido):
1. **whatsapp** - Disparos em massa via Meta API, grupos VIP, atendimento 1:1
2. **instagram** - Posts, Reels, Stories, Lives, Anúncios
3. **email** - Sequência de e-mails marketing
4. **loja_fisica** - Banners, vitrine, ambientação, promotores, carro de som, panfletos, convites impressos
5. **site** - Banners no site, landing pages de captação, pop-ups
6. **outros** - Parcerias com influenciadores, indicações, ações criativas
${statsContext}

IMPORTANTE: Para cada canal, defina a estratégia específica, tom de voz, cronograma dia-a-dia e tarefas de execução (checklist).`;

    const userPrompt = `Crie uma estratégia 360° completa para a seguinte campanha:

**Objetivo:** ${objective}
**Público-alvo:** ${audience || "A definir com base na análise"}
${instructions ? `**Instruções adicionais:** ${instructions}` : ""}

Responda OBRIGATORIAMENTE usando a ferramenta generate_360_strategy.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "generate_360_strategy",
              description: "Gera uma estratégia 360° completa de campanha de marketing multicanal",
              parameters: {
                type: "object",
                properties: {
                  campaign_name: { type: "string", description: "Nome criativo e impactante para a campanha" },
                  summary: { type: "string", description: "Resumo executivo da estratégia em 2-3 frases" },
                  start_date_suggestion: { type: "string", description: "Data sugerida para início (formato YYYY-MM-DD)" },
                  end_date_suggestion: { type: "string", description: "Data sugerida para término (formato YYYY-MM-DD)" },
                  estimated_budget: { type: "number", description: "Estimativa de orçamento em R$" },
                  target_analysis: { type: "string", description: "Análise do público-alvo ideal, quais segmentos RFM priorizar e por quê" },
                  lead_capture: {
                    type: "object",
                    properties: {
                      strategy: { type: "string" },
                      channels: { type: "array", items: { type: "string" } },
                      tips: { type: "array", items: { type: "string" } },
                      landing_page_suggestion: { type: "string", description: "Sugestão de título e campos para landing page de captação" }
                    },
                    required: ["strategy", "channels", "tips"]
                  },
                  channel_strategies: {
                    type: "array",
                    description: "Estratégia detalhada para cada canal de comunicação",
                    items: {
                      type: "object",
                      properties: {
                        channel_type: { type: "string", description: "whatsapp, instagram, email, loja_fisica, site, outros" },
                        strategy: { type: "string", description: "Estratégia geral para esse canal" },
                        tone_of_voice: { type: "string", description: "Tom de voz específico para esse canal" },
                        content_plan: {
                          type: "array",
                          description: "Plano de conteúdo detalhado (posts, mensagens, ações)",
                          items: {
                            type: "object",
                            properties: {
                              day_offset: { type: "number", description: "Dia relativo ao início da campanha (0 = primeiro dia)" },
                              title: { type: "string" },
                              description: { type: "string" },
                              content_type: { type: "string", description: "Ex: post, story, reels, email, template_whatsapp, banner, acao_presencial" },
                              content_suggestion: { type: "string", description: "Sugestão detalhada do conteúdo" }
                            },
                            required: ["day_offset", "title", "description", "content_type"]
                          }
                        },
                        tasks: {
                          type: "array",
                          description: "Checklist de tarefas de execução para esse canal",
                          items: {
                            type: "object",
                            properties: {
                              title: { type: "string" },
                              description: { type: "string" },
                              due_day_offset: { type: "number", description: "Dia relativo ao início da campanha para conclusão" }
                            },
                            required: ["title"]
                          }
                        }
                      },
                      required: ["channel_type", "strategy", "tone_of_voice", "content_plan", "tasks"]
                    }
                  },
                  success_metrics: { type: "array", items: { type: "string" } },
                  additional_tips: { type: "array", items: { type: "string" } }
                },
                required: ["campaign_name", "summary", "target_analysis", "lead_capture", "channel_strategies", "success_metrics", "additional_tips"],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "generate_360_strategy" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Limite de requisições atingido. Tente novamente em alguns segundos." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos insuficientes para IA." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const result = await response.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    
    if (!toolCall?.function?.arguments) {
      throw new Error("AI did not return structured strategy");
    }

    const strategy = JSON.parse(toolCall.function.arguments);

    return new Response(
      JSON.stringify({ success: true, strategy }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (e) {
    console.error("ai-marketing-strategy error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
