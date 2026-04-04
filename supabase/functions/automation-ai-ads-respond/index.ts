import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { adsTools, executeAdsToolCall } from "../_shared/ads-tools.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── Situation Detection ─────────────────────────────────────────────────────

type Situation =
  | 'info_qualificacao'   // Present product + ask size (first contact)
  | 'duvidas'             // Answer questions only when asked
  | 'objecoes'            // Client shows resistance or delays purchase
  | 'followup_1'          // Client not responding
  | 'coleta_dados'        // Collect address, name, CPF, email
  | 'pagamento'           // Generate or resend transparent checkout link
  | 'followup_2'          // Post-payment or post-ghosting → pivot to Live
  | 'checkout_abandonado' // Client opened link but didn't pay
  | 'requalificacao';     // Client asks about different product

interface SituationContext {
  situation: Situation;
  lead: any;
  campaign: any;
  event: any | null;
  messageText: string;
  collectedData: Record<string, any>;
  missingFields: string[];
  isFromGV: boolean;
}

function detectSituation(ctx: {
  lead: any;
  messageText: string;
  campaign: any;
  isFirstMessage: boolean;
  collectedData: Record<string, any>;
  hasAllRequiredData: boolean;
}): Situation {
  const { lead, messageText, campaign, isFirstMessage, collectedData, hasAllRequiredData } = ctx;
  const msgLower = (messageText || '').toLowerCase().trim();
  const currentStage = lead?.conversation_stage || 'info_qualificacao';
  const normalizedMessage = (messageText || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  const paymentRecoveryRequested = /(link|checkout|pagamento|pagar|cartao|pix|visa|mastercard|elo|hipercard|mercado pago|transparente|manda de novo|me manda de novo|reenvia|reenvia|novo link|link certo|link correto|link de pagamento|nao veio|nao abriu|nao funcionou|link errado|link antigo)/i.test(normalizedMessage);

  // Check if client asks about a DIFFERENT product (requalificacao)
  if (!isFirstMessage && currentStage !== 'info_qualificacao') {
    const catalogProducts = campaign.product_info?.catalogo || [];
    if (catalogProducts.length > 1) {
      const currentKeywords = lead?.interested_product_keywords || [];
      const mentionsDifferent = catalogProducts.some((p: any) =>
        (p.keywords || []).some((kw: string) =>
          msgLower.includes(kw.toLowerCase()) && !currentKeywords.includes(kw.toLowerCase())
        )
      );
      if (mentionsDifferent) return 'requalificacao';
    }
  }

  // Detect objections (before first-message check, so it works on any stage)
  if (!isFirstMessage) {
    const objectionPatterns = {
      objecao_financeira: /(caro|cart[aã]o.*vir|n[aã]o tenho|sem dinheiro|apertado|dia \d|vira dia|s[oó] (no|dia)|pr[oó]ximo m[eê]s|sal[aá]rio|pagamento|n[aã]o posso agora|muito caro|tá caro|ta caro|valor alto)/i,
      objecao_consulta: /(marido|esposa|m[aã]e|pai|irm[aã]|filho|amig|ver com|falar com|consultar|perguntar pr|familia|parente)/i,
      objecao_pensar: /(pensar|pensando|avaliar|analisar|ver depois|ainda n[aã]o|n[aã]o sei|vou ver|deixa eu ver|preciso ver|talvez|quem sabe)/i,
      objecao_recusa: /(n[aã]o quero|n[aã]o preciso|obrigad[oa]|n[aã]o.*interesse|hoje n[aã]o|agora n[aã]o|dispenso|n[aã]o.*momento|desculpa mas|passa dessa)/i,
    };

    for (const [key, pattern] of Object.entries(objectionPatterns)) {
      if (pattern.test(normalizedMessage)) {
        return 'objecoes';
      }
    }
  }

  // First message → info + qualification
  if (isFirstMessage) return 'info_qualificacao';

  // If the client asks for the payment link again, always re-enter payment flow.
  // This is critical for old conversations that still carry a legacy Mercado Pago link.
  if (lead?.payment_link_sent && paymentRecoveryRequested) return 'pagamento';

  // If payment was already sent and we're following up
  if (lead?.payment_link_sent && currentStage === 'pagamento') return 'followup_2';

  // If all data collected → payment
  if (hasAllRequiredData && currentStage !== 'pagamento' && !lead?.payment_link_sent) return 'pagamento';

  // If we already presented the product and client is responding → check if it's a question
  if (currentStage === 'info_qualificacao' || currentStage === 'duvidas') {
    // Check if the message contains data (name, size, city, etc.) → might be moving to coleta
    const dataFields = campaign.data_to_collect || [];
    const hasEnoughQualification = collectedData.tamanho || collectedData.calcado;
    if (hasEnoughQualification && !hasAllRequiredData) return 'coleta_dados';
    
    // Otherwise treat as potential question/response
    return 'duvidas';
  }

  // If in coleta_dados stage, stay there until all data collected
  if (currentStage === 'coleta_dados' && !hasAllRequiredData) return 'coleta_dados';

  // Default: stay in current stage
  return currentStage as Situation;
}

// ─── Situation-Specific Prompts ──────────────────────────────────────────────

function getInfoQualificacaoPrompt(ctx: SituationContext): string {
  const product = getMatchedProduct(ctx.campaign, ctx.messageText);
  const productInfo = product
    ? `Produto: ${product.nome} — R$ ${product.preco}${product.detalhes ? ` (${product.detalhes})` : ''}`
    : formatProductList(ctx.campaign);

  return `SITUAÇÃO: PRIMEIRO CONTATO — INFORMAÇÃO + QUALIFICAÇÃO

O cliente chegou pelo anúncio e quer saber sobre o produto. Sua missão:
1. Cumprimentar brevemente (Oii! / Oi, tudo bem?)
2. Apresentar o produto com preço e benefício principal em UMA frase
3. Perguntar o tamanho/número do calçado

${productInfo}

FORMATO DA RESPOSTA: Máximo 2 linhas + pergunta do tamanho. Exemplo:
"Oii! O tênis Jess é ortopédico e está saindo a R$ 279,99 com frete grátis 😍 Qual número você calça?"`;
}

function getDuvidasPrompt(ctx: SituationContext): string {
  return `SITUAÇÃO: RESPONDER DÚVIDA DO CLIENTE

O cliente está perguntando algo. Responda APENAS o que foi perguntado, de forma direta.

GUIA DE RESPOSTAS POR TIPO DE DÚVIDA:

📏 TAMANHO: "Vai do 34 ao 39! Qual é o seu?" (adapte ao catálogo real)

🎨 CORES: Descreva as cores disponíveis brevemente. Se não souber as cores exatas, diga "Temos algumas opções lindas! Posso te mostrar?"

🚚 ENTREGA/FRETE: Regra de frete: ${getShippingRuleText(ctx.campaign)}
${ctx.isFromGV ? '- Cliente de Valadares: "Entregamos aí em Valadares! Pode ser pagamento na entrega também 😉"' : ''}

📍 DE ONDE SOMOS: "Somos de Governador Valadares - MG!"

💰 FORMA DE PAGAMENTO: "Aceitamos PIX com ${ctx.campaign.pix_discount_percent || 5}% de desconto, cartão em até 6x sem juros${ctx.isFromGV ? ' e pagamento na entrega pra quem é de Valadares' : ''}!"

🏷️ DESCONTO: Mencione apenas descontos reais da campanha. Nunca invente.

📸 FOTOS: "Vou verificar e te mando! 😊" (não invente que tem fotos se não tiver)

REGRA: Responda a dúvida em NO MÁXIMO 2 linhas. Depois, se ainda não coletou tamanho, pergunte. Se já tem tamanho, avance para coleta de dados.

Dados já coletados: ${JSON.stringify(ctx.collectedData)}
Dados faltando: ${ctx.missingFields.join(', ') || 'Nenhum'}`;
}

function getFollowup1Prompt(ctx: SituationContext): string {
  const stage = ctx.lead?.conversation_stage || 'info_qualificacao';
  const followupCount = ctx.lead?.followup_count || 0;

  let contextualFollowup = '';
  if (stage === 'info_qualificacao') {
    contextualFollowup = 'O cliente recebeu info do produto mas não respondeu. Pergunte se ficou com alguma dúvida sobre o produto.';
  } else if (stage === 'duvidas') {
    contextualFollowup = 'O cliente estava tirando dúvidas e parou de responder. Retome de forma leve.';
  } else if (stage === 'coleta_dados') {
    contextualFollowup = 'O cliente estava passando os dados e parou. Pergunte se está tudo bem e se pode continuar.';
  } else if (stage === 'pagamento') {
    contextualFollowup = 'O cliente recebeu as formas de pagamento e não respondeu. Pergunte se precisa de ajuda.';
  }

  return `SITUAÇÃO: FOLLOW-UP (tentativa ${followupCount + 1})

${contextualFollowup}

REGRAS:
- Mensagem SUPER curta (1 linha apenas)
- Tom casual e leve, sem pressão
- Não repita informações já ditas
- Exemplos: "E aí, conseguiu ver? 😊", "Oi! Ficou com alguma dúvida?", "Oi! Ainda com interesse? 💛"`;
}

function getColetaDadosPrompt(ctx: SituationContext): string {
  const missing = ctx.missingFields;
  const nextField = missing[0]; // Collect one at a time

  const fieldPrompts: Record<string, string> = {
    cep: 'Peça o CEP. Ex: "Qual seu CEP pra eu calcular o frete?"',
    endereco: 'Peça o endereço completo com número. Ex: "Me passa o endereço completo com número pra entrega?"',
    nome: 'Pergunte o nome completo. Ex: "Qual seu nome completo?"',
    cpf: 'Peça o CPF. Ex: "E o CPF?"',
    email: 'Peça o e-mail (OPCIONAL). Ex: "Tem um email pra nota fiscal? Se não tiver, sem problemas!"',
    cidade: 'Pergunte a cidade. Ex: "De qual cidade você é?"',
    tamanho: 'Pergunte o tamanho/número. Ex: "Qual número você calça?"',
    calcado: 'Pergunte o tamanho/número. Ex: "Qual número você calça?"',
  };

  return `SITUAÇÃO: COLETA DE DADOS

Colete UM dado por vez de forma natural. Não faça interrogatório.

ORDEM DE COLETA: CEP > Endereço completo > Nome completo > CPF > Email (opcional)

PRÓXIMO DADO A COLETAR: ${nextField}
${fieldPrompts[nextField] || `Pergunte: "${nextField}"`}

Dados já coletados: ${JSON.stringify(ctx.collectedData)}
Dados faltando: ${missing.join(', ')}

REGRAS:
- UMA pergunta por mensagem. Máximo 1 linha.
- O email NÃO é obrigatório. Se o cliente não quiser, pule.
- NÃO mencione live, evento ou qualquer outro assunto. Foco TOTAL na coleta de dados.
- Se o cliente informar vários dados de uma vez, extraia todos e pergunte o próximo faltante.`;
}

function getPagamentoPrompt(ctx: SituationContext): string {
  const paymentConditions = ctx.campaign.payment_conditions || 'até 6x sem juros';
  const shippingRule = getShippingRuleText(ctx.campaign);
  const pixDiscount = ctx.campaign.pix_discount_percent || 5;

  return `SITUAÇÃO: PAGAMENTO

Todos os dados foram coletados! Agora gere o link de checkout usando a tool generate_checkout_link.

O checkout transparente aceita PIX (com ${pixDiscount}% de desconto automático) e cartão (${paymentConditions}).

REGRA DE FRETE: ${shippingRule}

FORMATO DA RESPOSTA após gerar o link:
"Prontinho! Aqui está o link pra você finalizar a compra:
[LINK]
Lá você escolhe entre PIX com ${pixDiscount}% de desconto ou cartão ${paymentConditions} 😊
${shippingRule.includes('GRÁTIS') ? 'Frete grátis! 🎉' : ''}"

IMPORTANTE: 
- Use generate_checkout_link para gerar o link. NÃO invente links.
- O cliente escolhe a forma de pagamento direto no checkout.
- NÃO pergunte a forma de pagamento. Envie o link diretamente.`;}


function getFollowup2Prompt(ctx: SituationContext): string {
  const hasEvent = !!ctx.event;
  const liveInviteSent = ctx.lead?.live_invite_sent;

  let liveContext = '';
  if (hasEvent && !liveInviteSent) {
    const eventDate = new Date(ctx.event.starts_at);
    liveContext = `
MUDE DE ASSUNTO para a LIVE:
- Nome: ${ctx.event.name}
- Data: ${eventDate.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })} às ${eventDate.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}
- PERGUNTE se o cliente quer ser LEMBRADO quando a live começar
- Exemplo: "A propósito, sábado teremos uma Live com ofertas incríveis! Quer que eu te avise quando começar? 😍"`;
  } else if (hasEvent && liveInviteSent) {
    liveContext = 'Já convidou para a live. Apenas faça um follow-up leve e final.';
  }

  return `SITUAÇÃO: FOLLOW-UP 2 (mudança de assunto)

O cliente não avançou no pagamento ou não respondeu os follow-ups anteriores.
É hora de mudar de assunto e tentar engajar de outra forma.

${liveContext || 'Não há evento programado. Faça um follow-up final amigável e se despida.'}

REGRA IMPORTANTE: PERGUNTE se o cliente quer participar/ser lembrado. Não apenas informe.
Máximo 2 linhas.`;
}

function getRequalificacaoPrompt(ctx: SituationContext): string {
  const catalog = ctx.campaign.product_info?.catalogo || [];

  return `SITUAÇÃO: REQUALIFICAÇÃO — CLIENTE PERGUNTOU SOBRE OUTRO PRODUTO

O cliente demonstrou interesse em algo diferente do produto inicial.

CATÁLOGO DISPONÍVEL:
${catalog.map((p: any, i: number) => `${i + 1}. ${p.nome} — R$ ${p.preco}${p.detalhes ? ` (${p.detalhes})` : ''}`).join('\n')}

MISSÃO:
1. Entenda o que o cliente procura (preço diferente? estilo diferente?)
2. Apresente as opções relevantes do catálogo
3. Pergunte qual interessou

Máximo 2 linhas + pergunta.`;
}

function getObjecoesPrompt(ctx: SituationContext, subSituation: string | null): string {
  const hasEvent = !!ctx.event;
  const eventInfo = hasEvent
    ? `\n\nEVENTO DISPONÍVEL: ${ctx.event.name} em ${new Date(ctx.event.starts_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })} às ${new Date(ctx.event.starts_at).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}`
    : '';

  const today = new Date().toISOString().split('T')[0];

  const subPrompts: Record<string, string> = {
    objecao_financeira: `SITUAÇÃO: OBJEÇÃO FINANCEIRA
O cliente mencionou questão de dinheiro/cartão.

1. Acolha: "Entendo perfeitamente!"
2. Se mencionou DATA (ex: "cartão vira dia 15"): "Quer que eu te mande uma mensagem no dia [data]?" → Use schedule_followup com a data informada
3. Se disse "tá caro": destaque parcelamento 6x sem juros, custo-benefício
4. Se possível, busque alternativas mais acessíveis (use search_product)

HOJE É: ${today}
Use a tool schedule_followup para agendar quando o cliente informar uma data.
Máximo 2 linhas.`,

    objecao_consulta: `SITUAÇÃO: CLIENTE VAI CONSULTAR ALGUÉM
O cliente quer falar com marido/mãe/amigo antes de decidir.

1. Valide: "Claro! É sempre bom decidir junto 😊"
2. Pergunte: "Qual o melhor horário pra eu voltar a falar com você?"
3. Se informar horário → Use schedule_followup com data e hora
4. Se NÃO informar → Use schedule_followup para o próximo dia útil às 09:00
5. Reforce que o preço/oferta pode mudar

HOJE É: ${today}
Máximo 2 linhas + pergunta do horário.`,

    objecao_pensar: `SITUAÇÃO: "VOU PENSAR"
O cliente quer tempo pra decidir. Descubra o motivo REAL de forma sutil.

1. Acolha: "Claro, sem pressa! 😊"
2. Sonde: "Posso te ajudar com alguma informação pra facilitar a decisão?"
3. Se o motivo for preço → ofereça parcelamento ou alternativas
4. Se for dúvida → responda
5. Se realmente quiser tempo: "Quer que eu te mande uma mensagem amanhã?" → Use schedule_followup

HOJE É: ${today}
Tom leve. NUNCA insistir. Máximo 2 linhas.`,

    objecao_recusa: `SITUAÇÃO: CLIENTE NÃO QUER
O cliente disse claramente que não quer.

1. Respeite: "Tudo bem! Agradeço seu tempo 😊"
${hasEvent ? `2. PIVOTE para o evento: "Ah, mas antes de ir... ${ctx.event?.name || 'teremos uma Live'} com promoções exclusivas! Quer que eu te avise quando começar?"
3. Se aceitar → use register_live_reminder
4. Se recusar → agradeça e encerre com elegância` : '2. Agradeça e encerre com elegância.'}
${eventInfo}

Máximo 2 linhas.`,
  };

  return subPrompts[subSituation || 'objecao_pensar'] || subPrompts.objecao_pensar;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getShippingRuleText(campaign: any): string {
  const rule = campaign.shipping_rule;
  if (!rule) return 'Calcular frete pelo CEP do cliente';
  switch (rule.type) {
    case 'free': return 'FRETE GRÁTIS para esta campanha';
    case 'fixed': return `Frete fixo de R$ ${rule.value || '0,00'}`;
    case 'calculate':
    default: return 'Calcular frete pelo CEP do cliente';
  }
}

function getMatchedProduct(campaign: any, messageText: string): any | null {
  const catalog = campaign.product_info?.catalogo;
  if (!catalog || !Array.isArray(catalog)) return null;
  const msgLower = (messageText || '').toLowerCase();
  return catalog.find((p: any) =>
    (p.keywords || []).some((kw: string) => msgLower.includes(kw.toLowerCase()))
  ) || catalog[0]; // Default to first product
}

function formatProductList(campaign: any): string {
  const catalog = campaign.product_info?.catalogo;
  if (!catalog || !Array.isArray(catalog)) {
    return campaign.product_info ? `Produto: ${JSON.stringify(campaign.product_info)}` : '';
  }
  return 'CATÁLOGO:\n' + catalog.map((p: any, i: number) =>
    `${i + 1}. ${p.nome} — R$ ${p.preco}${p.detalhes ? ` (${p.detalhes})` : ''}`
  ).join('\n');
}

function isFromGV(collectedData: Record<string, any>): boolean {
  const city = (collectedData.cidade || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return city.includes('valadares') || city.includes('gv') || city === 'gov valadares';
}

// ─── Main Handler ────────────────────────────────────────────────────────────

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
      isFollowup = false,
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

    // 1. Load campaign
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

    const isFirstMessage = !existingLead;

    if (!existingLead) {
      // Detect product keywords from first message
      const matchedProduct = getMatchedProduct(campaign, messageText);
      const productKeywords = matchedProduct?.keywords || [];

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
          conversation_stage: 'info_qualificacao',
          interested_product_keywords: productKeywords,
        })
        .select()
        .single();
      existingLead = newLead;
    }

    const collectedData = (existingLead?.collected_data as Record<string, any>) || {};
    const requiredFields = campaign.data_to_collect || [];
    const missingFields = requiredFields.filter((f: string) => !collectedData[f]);
    const hasAllRequiredData = missingFields.length === 0;
    const clientIsFromGV = isFromGV(collectedData);

    // 3. Detect situation
    let situation: Situation;
    if (isFollowup) {
      const followupCount = existingLead?.followup_count || 0;
      situation = followupCount >= 3 ? 'followup_2' : 'followup_1';
    } else {
      situation = detectSituation({
        lead: existingLead,
        messageText,
        campaign,
        isFirstMessage,
        collectedData,
        hasAllRequiredData,
      });
    }

    // 4. Load event context
    let eventData: any = null;
    if (campaign.event_id) {
      const { data: event } = await supabase
        .from('events')
        .select('id, name, starts_at, status, description')
        .eq('id', campaign.event_id)
        .maybeSingle();
      eventData = event;
    }

    // 5. Load DB prompts (campaign-specific override OR global default)
    const sitCtx: SituationContext = {
      situation,
      lead: existingLead,
      campaign,
      event: eventData,
      messageText,
      collectedData,
      missingFields,
      isFromGV: clientIsFromGV,
    };

    // Detect sub-situation for "duvidas" and "objecoes"
    let subSituation: string | null = null;
    if (situation === 'duvidas') {
      const ml = (messageText || '').toLowerCase();
      if (/taman|numer|n[uú]mero|calç/i.test(ml)) subSituation = 'tamanho';
      else if (/cor|cores|colorid/i.test(ml)) subSituation = 'cores';
      else if (/frete|entreg|envi|ship/i.test(ml)) subSituation = 'frete';
      else if (/onde|localiz|endere[çc]o da loja|cidade|valadares/i.test(ml)) subSituation = 'localizacao';
      else if (/pag|pix|cart[aã]o|boleto|parcela/i.test(ml)) subSituation = 'pagamento';
      else if (/foto|imag|ver|mostr/i.test(ml)) subSituation = 'fotos';
      else if (/descont|promo|cupon|oferta|barato|mais barato/i.test(ml)) subSituation = 'desconto';
      else subSituation = 'geral';
    } else if (situation === 'objecoes') {
      const ml = (messageText || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (/(caro|cartao.*vir|nao tenho|sem dinheiro|apertado|dia \d|vira dia|so (no|dia)|proximo mes|salario|nao posso agora|muito caro|ta caro|valor alto)/i.test(ml)) {
        subSituation = 'objecao_financeira';
      } else if (/(marido|esposa|mae|pai|irma|filho|amig|ver com|falar com|consultar|perguntar pr|familia|parente)/i.test(ml)) {
        subSituation = 'objecao_consulta';
      } else if (/(nao quero|nao preciso|obrigad|nao.*interesse|hoje nao|agora nao|dispenso|nao.*momento|desculpa mas|passa dessa)/i.test(ml)) {
        subSituation = 'objecao_recusa';
      } else {
        subSituation = 'objecao_pensar';
      }
    }

    // Try to load from DB: campaign-specific first, then global
    let dbPromptText: string | null = null;
    const promptQueries = [];

    // Query 1: campaign-specific for this situation+sub
    promptQueries.push(
      supabase.from('ad_campaign_situation_prompts')
        .select('prompt_text')
        .eq('campaign_id', campaign.id)
        .eq('situation', situation)
        .eq('is_active', true)
        .then(({ data }) => {
          if (data && data.length > 0) {
            const match = subSituation
              ? data.find((d: any) => d.sub_situation === subSituation) || data.find((d: any) => !d.sub_situation)
              : data.find((d: any) => !d.sub_situation) || data[0];
            if (match) return (match as any).prompt_text as string;
          }
          return null;
        })
    );

    // Query 2: global default
    promptQueries.push(
      supabase.from('ad_campaign_situation_prompts')
        .select('prompt_text, sub_situation')
        .is('campaign_id', null)
        .eq('situation', situation)
        .eq('is_active', true)
        .then(({ data }) => {
          if (data && data.length > 0) {
            const match = subSituation
              ? data.find((d: any) => d.sub_situation === subSituation) || data.find((d: any) => !d.sub_situation)
              : data.find((d: any) => !d.sub_situation) || data[0];
            if (match) return (match as any).prompt_text as string;
          }
          return null;
        })
    );

    const [campaignPrompt, globalPrompt] = await Promise.all(promptQueries);
    dbPromptText = campaignPrompt || globalPrompt;

    // Build the final situation prompt — use DB text if available, fallback to hardcoded
    let situationPrompt = '';
    if (dbPromptText) {
      // Inject dynamic variables into the DB prompt template
      situationPrompt = dbPromptText
        .replace(/\{\{produto_info\}\}/gi, formatProductList(campaign))
        .replace(/\{\{produto_match\}\}/gi, (() => {
          const p = getMatchedProduct(campaign, messageText);
          return p ? `${p.nome} — R$ ${p.preco}${p.detalhes ? ` (${p.detalhes})` : ''}` : '';
        })())
        .replace(/\{\{dados_coletados\}\}/gi, JSON.stringify(collectedData))
        .replace(/\{\{dados_faltando\}\}/gi, missingFields.join(', ') || 'Nenhum')
        .replace(/\{\{proximo_campo\}\}/gi, missingFields[0] || '')
        .replace(/\{\{eh_gv\}\}/gi, clientIsFromGV ? 'SIM - Cliente de Governador Valadares' : 'NÃO')
        .replace(/\{\{condicoes_pagamento\}\}/gi, campaign.payment_conditions || 'até 6x sem juros')
        .replace(/\{\{regra_frete\}\}/gi, getShippingRuleText(campaign))
        .replace(/\{\{pix_desconto\}\}/gi, String(campaign.pix_discount_percent || 5))
        .replace(/\{\{nome_cliente\}\}/gi, collectedData.nome || 'não informado')
        .replace(/\{\{followup_count\}\}/gi, String(existingLead?.followup_count || 0))
        .replace(/\{\{evento_nome\}\}/gi, eventData?.name || '')
        .replace(/\{\{evento_data\}\}/gi, eventData?.starts_at ? new Date(eventData.starts_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '')
        .replace(/\{\{evento_hora\}\}/gi, eventData?.starts_at ? new Date(eventData.starts_at).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : '');

      console.log(`[ads-ai] Using DB prompt for ${situation}${subSituation ? '/' + subSituation : ''} (${campaignPrompt ? 'campaign' : 'global'})`);
    } else {
      // Fallback to hardcoded prompts
      switch (situation) {
        case 'info_qualificacao': situationPrompt = getInfoQualificacaoPrompt(sitCtx); break;
        case 'duvidas': situationPrompt = getDuvidasPrompt(sitCtx); break;
        case 'objecoes': situationPrompt = getObjecoesPrompt(sitCtx, subSituation); break;
        case 'followup_1': situationPrompt = getFollowup1Prompt(sitCtx); break;
        case 'coleta_dados': situationPrompt = getColetaDadosPrompt(sitCtx); break;
        case 'pagamento': situationPrompt = getPagamentoPrompt(sitCtx); break;
        case 'followup_2': situationPrompt = getFollowup2Prompt(sitCtx); break;
        case 'requalificacao': situationPrompt = getRequalificacaoPrompt(sitCtx); break;
      }
      console.log(`[ads-ai] Using hardcoded prompt for ${situation}`);
    }

    // 6. Load knowledge base for ads agent
    let knowledgeContext = '';
    const { data: kbEntries } = await supabase
      .from('ai_knowledge_base')
      .select('title, content, category')
      .contains('agents', ['ads'])
      .eq('is_active', true)
      .order('sort_order');
    if (kbEntries && kbEntries.length > 0) {
      knowledgeContext = '\n\nBASE DE CONHECIMENTO:\n' + kbEntries.map((e: any) => `[${e.category}] ${e.title}: ${e.content}`).join('\n');
    }

    // 7. Base persona prompt
    const basePrompt = campaign.prompt || 'Você é uma atendente simpática e consultora de vendas.';

    const systemPrompt = `${basePrompt}

${situationPrompt}
${knowledgeContext}

REGRAS OBRIGATÓRIAS:
- Mensagens ULTRA CURTAS: máximo 2 linhas. Parece WhatsApp real.
- NÃO repita informações já ditas nas mensagens anteriores.
- Use o nome do cliente se já souber: ${collectedData.nome || 'ainda não sabe'}
- Fuso: America/Sao_Paulo
- Quando o cliente informar dados (nome, tamanho, cidade, etc), use a tool save_lead_data para salvar.
- Quando o cliente perguntar sobre detalhes do produto (cores, tamanhos disponíveis), use search_product.
- Quando o cliente pedir fotos ou quiser ver o produto, use send_product_image para enviar a foto direto pelo WhatsApp.
- Após apresentar o produto na primeira mensagem, use send_product_image para enviar a foto junto (reforço visual).
- Quando gerar PIX, envie o código copia-e-cola em uma mensagem SEPARADA (apenas o código, sem texto).
- Quando o cliente apresentar objeção (não quer, vou pensar, tá caro, vou falar com alguém), use schedule_followup para agendar um retorno. A data de hoje é ${new Date().toISOString().split('T')[0]}.

REGRA ANTI-ALUCINAÇÃO (CRÍTICA):
- NUNCA invente informações sobre materiais, composição, características técnicas ou detalhes do produto.
- Use SOMENTE informações que vieram do resultado da ferramenta search_product (campo "description") ou que estão explicitamente escritas no prompt da campanha.
- Se o cliente perguntar sobre material, composição, caimento ou qualquer detalhe que você NÃO tem certeza, use a ferramenta open_support_ticket para abrir um chamado e diga: "Vou verificar com a equipe e te retorno!"
- O termo correto é "ortopédico" (pés/saúde), NUNCA "ortodôntico" (dentes).
- NUNCA diga que um produto é de couro, camurça, tecido ou qualquer material se essa informação não vier da descrição do produto na Shopify.
- Se a ferramenta send_product_image falhar, NÃO diga que a foto foi enviada, NÃO culpe "instabilidade" genérica e NÃO descreva o produto visualmente.
- Se a Shopify não tiver imagem do produto/cor pedido, explique isso com clareza e abra open_support_ticket para a equipe humana.
- NUNCA invente informações sobre a loja, endereço, horários ou produtos. Use APENAS as informações da BASE DE CONHECIMENTO e do catálogo.`;


    // 7. Build chat history
    const chatMessages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    const historyWindowCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: dbMessages } = await supabase
      .from('whatsapp_messages')
      .select('message, direction, created_at')
      .eq('phone', normalizedPhone)
      .gt('created_at', historyWindowCutoff)
      .order('created_at', { ascending: false })
      .limit(historyLimit);

    const chronologicalMessages = (dbMessages || []).reverse();

    for (const msg of chronologicalMessages) {
      const text = msg.message?.trim();
      if (!text) continue;
      if (/\{\{\d+\}\}/.test(text)) continue;
      if (text.startsWith('[IA]') || text.startsWith('[IA-CONCIERGE]') || text.startsWith('[IA-LIVETE]')) continue;
      if (text.length > 500) continue;
      chatMessages.push({
        role: msg.direction === 'incoming' ? 'user' : 'assistant',
        content: text.replace(/^\[IA-ADS\]\s*/i, ''),
      });
    }

    if (messageText) {
      const last = chatMessages[chatMessages.length - 1];
      if (!last || last.role !== 'user' || last.content !== messageText) {
        chatMessages.push({ role: 'user', content: messageText });
      }
    }

    console.log(`[ads-ai] phone=${normalizedPhone}, campaign=${campaign.name}, situation=${situation}, stage=${existingLead?.conversation_stage}, temp=${existingLead?.temperature || 'frio'}`);

    // 8. Tool calling context
    const toolCtx = {
      supabase,
      supabaseUrl,
      supabaseKey,
      phone: normalizedPhone,
      leadId: existingLead?.id || '',
      lead: existingLead,
      campaign,
      collectedData,
      whatsappNumberId: whatsappNumberId || existingLead?.whatsapp_number_id || null,
      channel: channel || existingLead?.channel || 'zapi',
    };

    // Determine which tools to offer based on situation
    const situationTools = adsTools.filter(t => {
      const name = t.function.name;
      // Always offer save_lead_data, search_product, and send_product_image
      if (name === 'save_lead_data' || name === 'search_product' || name === 'send_product_image' || name === 'open_support_ticket') return true;
      // Schedule followup in objections, followup_1, followup_2, or duvidas
      if (name === 'schedule_followup') {
        return ['objecoes', 'followup_1', 'followup_2', 'duvidas', 'checkout_abandonado'].includes(situation);
      }
      // Checkout link only in payment situation
      if (name === 'generate_checkout_link') {
        return situation === 'pagamento' || situation === 'duvidas';
      }
      // Delivery payment only in payment for GV clients
      if (name === 'confirm_delivery_payment') {
        return (situation === 'pagamento' || situation === 'duvidas') && clientIsFromGV;
      }
      // CEP lookup in coleta or duvidas
      if (name === 'lookup_cep') return situation === 'coleta_dados' || situation === 'duvidas';
      // Live reminder in followup_2 or objecoes (recusa pivot)
      if (name === 'register_live_reminder') return situation === 'followup_2' || situation === 'objecoes';
      return true;
    });

    // 9. AI call with tool calling loop (max 3 turns)
    let reply = '';
    const allToolCalls: string[] = [];
    let currentMessages = [...chatMessages];
    let checkoutToolResult: { success: boolean; data?: any; error?: string } | null = null;

    for (let turn = 0; turn < 3; turn++) {
      const aiBody: any = {
        model: 'google/gemini-3-flash-preview',
        messages: currentMessages,
        max_tokens: 250,
        stream: false,
      };

      // Add tools on first turn or when continuing tool calls
      if (situationTools.length > 0) {
        aiBody.tools = situationTools;
        aiBody.tool_choice = 'auto';
      }

      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(aiBody),
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
      const choice = data.choices?.[0];

      // Check if AI wants to call tools
      if (choice?.finish_reason === 'tool_calls' || choice?.message?.tool_calls?.length > 0) {
        const toolCalls = choice.message.tool_calls || [];

        // Add assistant message with tool calls to history
        currentMessages.push(choice.message);

        for (const tc of toolCalls) {
          const toolName = tc.function.name;
          let toolArgs: Record<string, any> = {};
          try {
            toolArgs = JSON.parse(tc.function.arguments || '{}');
          } catch { toolArgs = {}; }

          console.log(`[ads-ai] Tool call: ${toolName}(${JSON.stringify(toolArgs)})`);
          allToolCalls.push(toolName);

          // Refresh collectedData before tool execution
          if (toolName !== 'save_lead_data') {
            const { data: freshLead } = await supabase
              .from('ad_leads')
              .select('collected_data')
              .eq('id', existingLead?.id)
              .maybeSingle();
            if (freshLead) {
              toolCtx.collectedData = (freshLead.collected_data as Record<string, any>) || {};
            }
          }

          const result = await executeAdsToolCall(toolName, toolArgs, toolCtx);

          if (toolName === 'generate_checkout_link') {
            checkoutToolResult = result;
          }

          // Add tool result to conversation
          currentMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(result),
          } as any);
        }

        // Continue loop for next AI response
        continue;
      }

      // No tool calls — we have the final text response
      reply = choice?.message?.content || '';
      break;
    }

    if (checkoutToolResult?.success && checkoutToolResult.data?.checkout_url) {
      const checkoutUrl = checkoutToolResult.data.checkout_url;
      const pixDiscount = campaign.pix_discount_percent || 5;
      const customerFirstName = ((toolCtx.collectedData?.nome || collectedData.nome || '').trim().split(' ')[0] || '').trim();
      reply = `${customerFirstName ? `${customerFirstName}, ` : ''}prontinho! Aqui está seu link para finalizar a compra:\n\n${checkoutUrl}\n\nLá você pode escolher PIX com ${pixDiscount}% de desconto ou cartão em até 6x sem juros 😊`;
    } else if (checkoutToolResult && !checkoutToolResult.success) {
      reply = `Perdão! Não consegui gerar o link do checkout transparente agora. ${checkoutToolResult.error || 'Tente novamente em instantes.'}`;
    }

    // 10. Clean up any remaining tags from reply
    let newTemperature: string | null = null;
    const tempMatch = reply.match(/\[TEMPERATURA:(\w+)\]/);
    if (tempMatch) {
      newTemperature = tempMatch[1];
      reply = reply.replace(tempMatch[0], '').trim();
    }

    const dataMatches = [...reply.matchAll(/\[DADOS:(\w+)=([^\]]+)\]/g)];
    const extractedData: Record<string, string> = {};
    for (const m of dataMatches) {
      extractedData[m[1]] = m[2].trim();
      reply = reply.replace(m[0], '').trim();
    }

    const actionMatches = [...reply.matchAll(/\[ACAO:(\w+)\]/g)];
    for (const m of actionMatches) {
      reply = reply.replace(m[0], '').trim();
    }

    // 11. Determine next stage
    let nextStage = situation as string;
    if (situation === 'info_qualificacao' && !isFirstMessage) nextStage = 'duvidas';
    if (situation === 'objecoes') nextStage = existingLead?.conversation_stage || 'duvidas'; // Stay in previous stage
    if (allToolCalls.includes('register_live_reminder')) nextStage = 'followup_2';
    if (allToolCalls.includes('generate_checkout_link') || allToolCalls.includes('confirm_delivery_payment')) {
      nextStage = 'pagamento';
    }

    // 11b. Register follow-up for ALL stages when client doesn't have an active followup
    // This ensures follow-ups happen at every funnel stage, not just payment
    if (!isFollowup && situation !== 'objecoes' && !allToolCalls.includes('schedule_followup')) {
      try {
        const { data: existingActive } = await supabase
          .from('chat_payment_followups')
          .select('id')
          .eq('phone', normalizedPhone)
          .eq('is_active', true)
          .maybeSingle();

        if (!existingActive) {
          // No active followup — create one for general funnel follow-up
          const firstReminder = new Date();
          firstReminder.setMinutes(firstReminder.getMinutes() + 30); // 30min inactivity trigger

          const { error: insertErr } = await supabase.from('chat_payment_followups').insert({
            phone: normalizedPhone,
            type: `ads_${nextStage}`,
            is_active: true,
            interval_minutes: 30,
            max_reminders: 3,
            reminder_count: 0,
            next_reminder_at: firstReminder.toISOString(),
            whatsapp_number_id: whatsappNumberId || null,
          });
          if (insertErr) {
            console.warn(`[ads-ai] Followup insert error:`, insertErr);
          } else {
            console.log(`[ads-ai] Funnel followup registered for ${normalizedPhone} at stage ${nextStage}`);
          }

          // Ensure chat_awaiting_payment exists
          await supabase.from('chat_awaiting_payment').upsert(
            { phone: normalizedPhone, type: `ads_${nextStage}` },
            { onConflict: 'phone' }
          );
        }
      } catch (fuErr) {
        console.warn('[ads-ai] Funnel followup error (non-blocking):', fuErr);
      }
    }

    // 12. Update lead
    if (existingLead) {
      const updates: Record<string, any> = {
        last_ai_contact_at: new Date().toISOString(),
        conversation_stage: nextStage,
      };

       if (whatsappNumberId) {
        updates.whatsapp_number_id = whatsappNumberId;
      }

      if (channel) {
        updates.channel = channel;
      }

      if (newTemperature && ['frio', 'morno', 'quente', 'super_quente', 'convertido'].includes(newTemperature)) {
        updates.temperature = newTemperature;
      }

      if (Object.keys(extractedData).length > 0) {
        // Refresh collected data as tools may have already saved
        const { data: freshLead } = await supabase.from('ad_leads').select('collected_data').eq('id', existingLead.id).maybeSingle();
        const latestData = (freshLead?.collected_data as Record<string, any>) || collectedData;
        updates.collected_data = { ...latestData, ...extractedData };
        if (extractedData.nome) updates.name = extractedData.nome;
      }

      if (isFollowup) {
        updates.followup_count = (existingLead.followup_count || 0) + 1;
        updates.last_followup_at = new Date().toISOString();
      } else {
        updates.followup_count = 0;
      }

      if (situation === 'requalificacao') {
        const matchedProduct = getMatchedProduct(campaign, messageText);
        if (matchedProduct?.keywords) {
          updates.interested_product_keywords = matchedProduct.keywords;
        }
      }

      await supabase.from('ad_leads').update(updates).eq('id', existingLead.id);
    }

    // 13. Log interaction
    await supabase.from('ai_conversation_logs').insert({
      phone: normalizedPhone,
      message_in: messageText,
      message_out: reply,
      stage: `ads_${situation}`,
      ai_decision: [
        newTemperature ? `temp:${newTemperature}` : null,
        allToolCalls.length > 0 ? `tools:${allToolCalls.join(',')}` : null,
      ].filter(Boolean).join('|') || null,
      provider: 'lovable',
      tool_called: allToolCalls.length > 0 ? allToolCalls.join(',') : null,
    });

    return new Response(JSON.stringify({
      success: true,
      reply,
      campaignId: campaign.id,
      campaignName: campaign.name,
      leadId: existingLead?.id,
      temperature: newTemperature || existingLead?.temperature || 'frio',
      situation,
      extractedData,
      toolsCalled: allToolCalls,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('[ads-ai] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
