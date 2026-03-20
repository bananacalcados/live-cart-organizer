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
      ? `\nDados da base de clientes disponível:
- Total de clientes: ${customer_stats.total}
- Clientes loja física: ${customer_stats.local}
- Clientes online: ${customer_stats.online}
- Faturamento total: R$ ${customer_stats.revenue?.toLocaleString('pt-BR') || '0'}
- Segmentos RFM disponíveis: ${customer_stats.segments?.join(', ') || 'N/A'}`
      : '';

    const systemPrompt = `Você é um diretor de marketing sênior especializado em varejo de calçados/moda, com experiência profunda em campanhas omnichannel 360° e estratégias de vendas integradas.

Seu papel é criar PLANOS OPERACIONAIS DETALHADOS E ACIONÁVEIS — não apenas resumos. Cada canal deve ter um plano tão completo que a equipe consiga executar sem perguntas adicionais.

## Contexto do Negócio
- Loja de calçados ortopédicos e moda em Governador Valadares, MG (lojas no Jardim Pérola e Centro)
- Opera online (site + WhatsApp) e presencialmente
- Usa WhatsApp Business API (Meta) para comunicação direta e em massa
- Base de clientes segmentada por RFM (Recência, Frequência, Monetário)
- Presença ativa no Instagram, email marketing e site
${statsContext}

## REGRAS CRÍTICAS PARA A ESTRATÉGIA

### WhatsApp (canal principal de conversão):
- Defina QUANTOS disparos serão feitos no período e QUANDO (dia e horário ideal)
- Especifique se haverá GRUPO VIP: nome do grupo, regras, conteúdo exclusivo, periodicidade de posts
- Escreva as MENSAGENS COMPLETAS (copy real, não placeholder) para cada disparo
- Defina a SEGMENTAÇÃO: quais segmentos RFM recebem qual mensagem
- Inclua estratégia de FOLLOW-UP para quem não respondeu
- Defina METAS mensuráveis: taxa de resposta esperada, conversões

### Instagram:
- Defina o CALENDÁRIO EDITORIAL completo: quantos posts, stories, reels por semana
- Escreva COPIES COMPLETAS para cada peça (legendas, CTAs)
- Especifique FORMATOS: carrossel, vídeo, foto, before/after, depoimento
- Defina se haverá investimento em ADS: valor, público, objetivo do anúncio
- Inclua PARCERIAS com influenciadores: perfil ideal, tipo de conteúdo, entregáveis

### Email:
- Defina QUANTOS emails serão enviados e com qual FREQUÊNCIA
- Escreva o ASSUNTO e COPY COMPLETA de cada email
- Especifique o LAYOUT: hero image, CTA, estrutura visual
- Defina SEGMENTAÇÃO de lista: quem recebe o quê
- Inclua AUTOMAÇÕES: welcome series, abandoned cart, post-purchase

### Loja Física:
- Defina METAS ESPECÍFICAS para as vendedoras (ex: X vendas/dia, Y cadastros)
- Inclua PREMIAÇÃO/GAMIFICAÇÃO para a equipe (comissão extra, bônus por meta)
- Especifique AÇÕES PRESENCIAIS: carro de som (roteiro, bairros, horários), panfletos (quantidade, pontos de distribuição)
- Defina AMBIENTAÇÃO da loja: vitrine, cheiro, música, decoração temática
- Inclua SCRIPTS de atendimento para as vendedoras (pitch de venda)
- Defina ações de CAPTAÇÃO na loja: QR code para grupo VIP, cadastro para sorteio

### Site:
- Especifique BANNERS (copy + posição), POP-UPS de captação, LANDING PAGES
- Defina OFERTAS EXCLUSIVAS para o canal (cupom, frete grátis)

### Outros:
- Parcerias locais, ações de guerrilha, carro de som, indicações, sorteios

## FORMATO DE RESPOSTA
Seja EXTENSO e DETALHADO. Cada content_plan item deve ter uma content_suggestion com o TEXTO REAL da mensagem/copy/roteiro, não apenas uma descrição genérica.
Cada tarefa deve ser ACIONÁVEL e ESPECÍFICA (não "fazer post", mas "criar carrossel 4 slides sobre benefícios ortopédicos com CTA para WhatsApp").`;

    const userPrompt = `Crie uma estratégia 360° OPERACIONAL E DETALHADA para:

**Objetivo:** ${objective}
**Público-alvo:** ${audience || "A definir com base na análise dos segmentos RFM"}
${instructions ? `**Instruções adicionais:** ${instructions}` : ""}

IMPORTANTE:
- Gere pelo menos 5-8 itens no cronograma de cada canal principal (WhatsApp, Instagram, Email)
- Cada item do cronograma DEVE ter content_suggestion com o TEXTO REAL (copy completa)
- Gere pelo menos 4-6 tarefas específicas por canal
- Inclua metas numéricas sempre que possível
- Para WhatsApp: inclua as mensagens completas que serão enviadas
- Para Email: inclua assunto + corpo resumido de cada email
- Para Loja Física: inclua metas de vendas e premiação da equipe
- Para Instagram: inclua legendas completas dos posts

Responda OBRIGATORIAMENTE usando a ferramenta generate_360_strategy.`;

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
              name: "generate_360_strategy",
              description: "Gera uma estratégia 360° operacional e detalhada de campanha de marketing multicanal",
              parameters: {
                type: "object",
                properties: {
                  campaign_name: { type: "string", description: "Nome criativo e impactante para a campanha" },
                  summary: { type: "string", description: "Resumo executivo da estratégia em 3-5 frases, incluindo a big idea" },
                  start_date_suggestion: { type: "string", description: "Data sugerida para início (formato YYYY-MM-DD)" },
                  end_date_suggestion: { type: "string", description: "Data sugerida para término (formato YYYY-MM-DD)" },
                  estimated_budget: { type: "number", description: "Estimativa de orçamento total em R$" },
                  target_analysis: { type: "string", description: "Análise profunda do público-alvo: segmentos RFM prioritários, comportamento de compra, objeções comuns e como quebrá-las" },
                  lead_capture: {
                    type: "object",
                    properties: {
                      strategy: { type: "string", description: "Estratégia completa de captação de leads com metas numéricas" },
                      channels: { type: "array", items: { type: "string" } },
                      tips: { type: "array", items: { type: "string" } },
                      landing_page_suggestion: { type: "string", description: "Descrição detalhada da landing page: título, campos, oferta, copy do CTA" }
                    },
                    required: ["strategy", "channels", "tips"]
                  },
                  channel_strategies: {
                    type: "array",
                    description: "Estratégia OPERACIONAL detalhada para cada canal",
                    items: {
                      type: "object",
                      properties: {
                        channel_type: { type: "string", description: "whatsapp, instagram, email, loja_fisica, site, outros" },
                        strategy: { type: "string", description: "Estratégia completa para o canal, incluindo objetivos, metas numéricas e KPIs" },
                        tone_of_voice: { type: "string", description: "Tom de voz com exemplos concretos de como falar" },
                        key_messages: {
                          type: "array",
                          description: "Mensagens-chave / copies completas que serão usadas nesse canal",
                          items: { type: "string" }
                        },
                        goals: {
                          type: "array",
                          description: "Metas numéricas e KPIs específicos do canal",
                          items: { type: "string" }
                        },
                        team_instructions: {
                          type: "string",
                          description: "Instruções para a equipe responsável (vendedoras, social media, etc). Inclua scripts, premiações, gamificação se aplicável."
                        },
                        content_plan: {
                          type: "array",
                          description: "Cronograma DETALHADO com cada ação/peça/disparo. Mínimo 5 itens para canais principais.",
                          items: {
                            type: "object",
                            properties: {
                              day_offset: { type: "number", description: "Dia relativo ao início (0 = primeiro dia)" },
                              title: { type: "string", description: "Título da ação" },
                              description: { type: "string", description: "O que fazer nesse dia" },
                              content_type: { type: "string", description: "Ex: disparo_whatsapp, post_feed, story, reels, email, banner, acao_presencial, carro_de_som, grupo_vip" },
                              content_suggestion: { type: "string", description: "COPY COMPLETA / TEXTO REAL da mensagem, legenda, email ou roteiro. Não escreva 'sugestão de texto', escreva o TEXTO PRONTO." },
                              target_segment: { type: "string", description: "Segmento alvo desta ação específica (ex: Campeões, Em Risco, Todos)" },
                              expected_result: { type: "string", description: "Resultado esperado (ex: 30% taxa de abertura, 50 cadastros)" }
                            },
                            required: ["day_offset", "title", "description", "content_type", "content_suggestion"]
                          }
                        },
                        tasks: {
                          type: "array",
                          description: "Checklist ACIONÁVEL com tarefas específicas. Mínimo 4 tarefas por canal principal.",
                          items: {
                            type: "object",
                            properties: {
                              title: { type: "string", description: "Tarefa específica e acionável (não genérica)" },
                              description: { type: "string", description: "Detalhes de como executar" },
                              due_day_offset: { type: "number" },
                              responsible: { type: "string", description: "Quem deve executar (ex: Social Media, Vendedora, Gerente)" }
                            },
                            required: ["title"]
                          }
                        }
                      },
                      required: ["channel_type", "strategy", "tone_of_voice", "content_plan", "tasks"]
                    }
                  },
                  success_metrics: { type: "array", items: { type: "string" }, description: "KPIs mensuráveis com valores-alvo" },
                  additional_tips: { type: "array", items: { type: "string" } },
                  risk_mitigation: { type: "array", items: { type: "string" }, description: "Riscos potenciais e planos B" }
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
          status: 429, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos insuficientes para IA." }), {
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
      throw new Error("AI did not return structured strategy");
    }

    const strategy = JSON.parse(toolCall.function.arguments);

    return new Response(
      JSON.stringify({ success: true, strategy }),
      { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );

  } catch (e) {
    console.error("ai-marketing-strategy error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erro interno" }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  }
});
