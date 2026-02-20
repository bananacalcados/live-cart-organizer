import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CHANNEL_PROMPTS: Record<string, string> = {
  grupo_vip: `Você é especialista em gestão de Grupos VIP no WhatsApp para varejo de moda/calçados.

REGRAS:
- Gere MENSAGENS COMPLETAS (copy real) para cada etapa
- Cada etapa deve ter um propósito claro (aquecimento, revelação, oferta, urgência, encerramento)
- Inclua enquetes, interações e conteúdo exclusivo
- As mensagens devem criar senso de comunidade e exclusividade
- Considere horários ideais de envio (manhã cedo, almoço, noite)
- Inclua emojis de forma natural e moderada
- Sempre inclua CTA claro em cada mensagem`,

  whatsapp_marketing: `Você é especialista em campanhas de WhatsApp Marketing via API da Meta para varejo.

REGRAS:
- Gere TEMPLATES DE MENSAGEM compatíveis com a API da Meta (header, body, footer, botões)
- Respeite limites de caracteres da Meta (body: 1024 chars)
- Defina segmentação RFM para cada disparo
- Inclua estratégia de follow-up para não-respondentes
- Defina horários ideais de envio
- Calcule taxas esperadas de entrega, leitura e resposta
- Inclua variáveis personalizáveis ({{nome}}, {{produto}})`,

  instagram: `Você é especialista em marketing no Instagram para varejo de moda/calçados.

REGRAS:
- Gere LEGENDAS COMPLETAS para cada post (com hashtags)
- Especifique formato: Reels, Feed (carrossel/foto), Stories
- Para Reels: descreva roteiro, duração, música sugerida, hook dos primeiros 3s
- Para Stories: sequência de slides com CTAs (enquete, pergunta, link, countdown)
- Para Feed: descreva visual, quantidade de slides se carrossel
- Inclua estratégia de Ads se aplicável (público, orçamento, objetivo)
- Defina frequência de postagem e melhor horário
- Sugira parcerias com influenciadores locais se relevante`,

  loja_fisica: `Você é especialista em operações de loja física de varejo de calçados/moda.

REGRAS:
- Defina METAS NUMÉRICAS para vendedoras (vendas/dia, cadastros, ticket médio)
- Crie SCRIPTS DE ATENDIMENTO completos (pitch de abordagem, objeções, fechamento)
- Inclua GAMIFICAÇÃO/PREMIAÇÃO da equipe (comissão extra, bônus, ranking)
- Detalhe ambientação: vitrine, decoração, música, aroma
- Se carro de som: roteiro completo, bairros, horários
- Se panfletos: quantidade, pontos de distribuição, copy
- Ações de captação na loja: QR code grupo VIP, cadastro sorteio
- Defina organização de produtos e destaques`,

  email: `Você é especialista em Email Marketing para e-commerce de moda/calçados.

REGRAS:
- Gere ASSUNTO + PREVIEW TEXT + CORPO de cada email
- Assuntos com max 50 caracteres, impactantes
- Defina layout: hero image, CTA principal, seções
- Inclua segmentação de lista
- Defina automações: welcome, abandoned cart, post-purchase
- Frequência e horário ideal de envio
- Calcule taxas esperadas de abertura e clique
- Inclua A/B testing suggestions`,

  site: `Você é especialista em marketing digital e conversão de sites e-commerce.

REGRAS:
- Defina BANNERS com copy completa, posição e CTA
- Crie POP-UPS de captação com copy e regras de exibição
- Sugira LANDING PAGES com estrutura completa (hero, benefícios, prova social, CTA)
- Defina cupons exclusivos do canal
- Inclua melhorias de UX para a campanha
- SEO: meta titles, descriptions para páginas da campanha
- Defina urgência: countdown timers, estoque limitado`,
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { channel_type, directive, params } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    if (!channel_type || !directive) {
      return new Response(
        JSON.stringify({ error: "channel_type e directive são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const channelPrompt = CHANNEL_PROMPTS[channel_type] || CHANNEL_PROMPTS.site;

    const systemPrompt = `${channelPrompt}

## CONTEXTO DA CAMPANHA (Diretriz Matriz)
- **Campanha:** ${directive.campaign_name}
- **Conceito:** ${directive.concept}
- **Tom de voz:** ${directive.tone_of_voice}
- **Mensagens-chave:** ${directive.key_messages?.join(' | ')}
- **Público-alvo:** ${directive.target_audience}
- **Metas gerais:** ${directive.goals?.join('; ')}

## Contexto do Negócio
- Loja de calçados ortopédicos e moda em Governador Valadares, MG (Jardim Pérola e Centro)
- Opera online e presencialmente
- WhatsApp Business API (Meta)
- Base segmentada por RFM

IMPORTANTE: Toda a comunicação deve seguir o conceito e tom da Diretriz Matriz acima.`;

    const paramsDescription = params ? `\n\n## Parâmetros configurados pelo usuário:\n${JSON.stringify(params, null, 2)}` : '';

    const userPrompt = `Gere o plano OPERACIONAL DETALHADO para o canal "${channel_type}" da campanha "${directive.campaign_name}".${paramsDescription}

Use a ferramenta generate_channel_plan para responder. Cada item do content_plan DEVE ter content_suggestion com TEXTO REAL completo.`;

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
              name: "generate_channel_plan",
              description: "Gera plano operacional detalhado para um canal específico",
              parameters: {
                type: "object",
                properties: {
                  channel_type: { type: "string" },
                  strategy: { type: "string", description: "Estratégia completa do canal com objetivos e KPIs" },
                  tone_of_voice: { type: "string", description: "Tom adaptado ao canal" },
                  key_messages: { type: "array", items: { type: "string" }, description: "Copies/mensagens-chave adaptadas ao canal" },
                  goals: { type: "array", items: { type: "string" }, description: "Metas numéricas do canal" },
                  team_instructions: { type: "string", description: "Instruções para equipe, scripts, premiações" },
                  content_plan: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        day_offset: { type: "number" },
                        title: { type: "string" },
                        description: { type: "string" },
                        content_type: { type: "string" },
                        content_suggestion: { type: "string", description: "COPY/TEXTO COMPLETO da mensagem" },
                        target_segment: { type: "string" },
                        expected_result: { type: "string" },
                        send_time: { type: "string", description: "Horário sugerido ex: 09:00" }
                      },
                      required: ["day_offset", "title", "description", "content_type", "content_suggestion"]
                    }
                  },
                  tasks: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string" },
                        description: { type: "string" },
                        due_day_offset: { type: "number" },
                        responsible: { type: "string" }
                      },
                      required: ["title"]
                    }
                  }
                },
                required: ["channel_type", "strategy", "tone_of_voice", "content_plan", "tasks"],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "generate_channel_plan" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit. Tente novamente em alguns segundos." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos de IA insuficientes." }), {
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
      throw new Error("AI did not return structured channel plan");
    }

    const plan = JSON.parse(toolCall.function.arguments);

    return new Response(
      JSON.stringify({ success: true, plan }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (e) {
    console.error("ai-channel-specialist error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
