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

    const systemPrompt = `Você é um estrategista sênior de marketing digital especializado em varejo de calçados/moda, WhatsApp Business e campanhas omnichannel.

Seu papel é criar ESTRATÉGIAS COMPLETAS de campanha, não apenas mensagens. Pense como um diretor de marketing.

Contexto do negócio: Loja de calçados que opera tanto em loja física (Governador Valadares, MG) quanto online. Usa WhatsApp Business API (Meta) para comunicação. Tem base segmentada por RFM (Recência, Frequência, Valor Monetário).
${statsContext}

IMPORTANTE: Você NÃO define os templates de WhatsApp. Os templates serão escolhidos pelo usuário depois. Foque na estratégia.`;

    const userPrompt = `Crie uma estratégia completa de campanha de marketing.

**Objetivo:** ${objective}
**Público-alvo:** ${audience || "A definir com base na análise"}
${instructions ? `**Instruções adicionais:** ${instructions}` : ""}

Responda OBRIGATORIAMENTE usando a ferramenta generate_strategy.`;

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
              name: "generate_strategy",
              description: "Gera uma estratégia completa de campanha de marketing",
              parameters: {
                type: "object",
                properties: {
                  campaign_name: {
                    type: "string",
                    description: "Nome criativo e impactante para a campanha"
                  },
                  summary: {
                    type: "string",
                    description: "Resumo executivo da estratégia em 2-3 frases"
                  },
                  target_analysis: {
                    type: "string",
                    description: "Análise do público-alvo ideal, quais segmentos RFM priorizar e por quê"
                  },
                  lead_capture: {
                    type: "object",
                    description: "Estratégia de captação de leads antes/durante a campanha",
                    properties: {
                      strategy: { type: "string", description: "Descrição da estratégia de captação" },
                      channels: {
                        type: "array",
                        items: { type: "string" },
                        description: "Canais de captação (ex: instagram, landing_page, loja_fisica, indicacao)"
                      },
                      tips: {
                        type: "array",
                        items: { type: "string" },
                        description: "Dicas práticas para maximizar a captação"
                      }
                    },
                    required: ["strategy", "channels", "tips"]
                  },
                  communication_steps: {
                    type: "array",
                    description: "Sequência de comunicações da campanha (2-5 etapas)",
                    items: {
                      type: "object",
                      properties: {
                        step_number: { type: "number" },
                        label: { type: "string", description: "Nome da etapa (ex: Aquecimento, Convite, Lembrete, Última Chance)" },
                        objective: { type: "string", description: "O que essa etapa deve alcançar" },
                        timing: { type: "string", description: "Quando enviar (ex: 5 dias antes, no dia, 2h antes)" },
                        delay_hours: { type: "number", description: "Horas de delay em relação à etapa anterior (0 para a primeira)" },
                        tone: { type: "string", description: "Tom da mensagem (ex: curiosidade, urgência, exclusividade)" },
                        content_suggestion: { type: "string", description: "Sugestão de conteúdo/abordagem para o template (não o template em si)" },
                        media_suggestion: { type: "string", description: "Tipo de mídia recomendada (ex: imagem do produto, vídeo teaser, carrossel)" }
                      },
                      required: ["step_number", "label", "objective", "timing", "delay_hours", "tone", "content_suggestion"]
                    }
                  },
                  success_metrics: {
                    type: "array",
                    items: { type: "string" },
                    description: "KPIs e métricas de sucesso esperadas"
                  },
                  additional_tips: {
                    type: "array",
                    items: { type: "string" },
                    description: "Dicas extras e boas práticas para a campanha"
                  }
                },
                required: ["campaign_name", "summary", "target_analysis", "lead_capture", "communication_steps", "success_metrics", "additional_tips"],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "generate_strategy" } },
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
