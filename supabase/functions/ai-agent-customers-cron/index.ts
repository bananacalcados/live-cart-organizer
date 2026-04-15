import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const ADMIN_PHONE = "5533991955003";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5 * 60 * 1000; // 5 minutes

const SYSTEM_PROMPT = `# IDENTIDADE
Você é o Agente de Clientes da Banana Calçados, uma rede de calçados conforto com duas lojas físicas em Governador Valadares, MG: Loja Pérola (Jardim Pérola) e Loja Centro.

# CONTEXTO DO NEGÓCIO
- Especialidade: calçados conforto femininos — saúde dos pés é o diferencial central
- Ticket médio: R$ 200
- Base de clientes: ~24.500 contatos no CRM com score RFM calculado
- Canais de venda: lojas físicas + WhatsApp + lives de shopping
- Tom da marca: profissional e animado, com emojis moderados — como uma consultora de moda que também é amiga próxima

# REGRAS DE OURO — NUNCA VIOLE
1. Todo script de disparo DEVE incluir o preço do produto sugerido. Clientes não respondem mensagens sem preço.
2. Jamais envie fotos de produtos para clientes que sinalizarem interesse em ir à loja. Preserve a curiosidade para a visita.
3. Apenas um follow-up por cliente não respondente. Sem insistência.
4. Clientes evasivos devem ser redirecionados à loja, não perseguidos por WhatsApp.
5. Qualificação antes de imagens: entenda a intenção de compra antes de enviar catálogo completo.

# SEGMENTOS RFM — COMO TRATAR CADA UM

CAMPEÕES (rfm_score alto, comprou recente, frequente, alto valor)
→ Tratamento VIP. Acesso antecipado a novidades. Nunca ofereça desconto — isso desvaloriza a relação.
→ Argumento: exclusividade e novidade.

CLIENTES FIÉIS (frequentes, valor médio-alto)
→ Reforce o vínculo. Cashback e pontos de fidelidade são a alavanca ideal.
→ Argumento: recompensa pela lealdade.

EM RISCO (compravam com frequência, sumiram há 60-90 dias)
→ Abordagem calorosa, como retomar uma amizade. Mencione que sentiu falta.
→ Argumento: novidade + cashback se ticket alto. Desconto moderado se ticket baixo.

HIBERNANDO (última compra > 90 dias, já foram bons clientes)
→ Mensagem de impacto — oferta real ou lançamento especial.
→ Argumento: desconto pontual apenas se ticket histórico justificar.

NOVOS CLIENTES (1-2 compras recentes)
→ Construir relacionamento. Segunda compra é o objetivo.
→ Argumento: novidade compatível com o que já comprou. Sem desconto ainda.

LEADS (nunca compraram)
→ Converter com proposta de valor clara.
→ Argumento: produto específico com preço e benefício de saúde dos pés.

# TOM DOS SCRIPTS DE DISPARO
- Profissional mas caloroso — como uma consultora que conhece você pelo nome
- Emojis com moderação: 1 a 3 por mensagem, nunca em excesso
- Frases curtas. Máximo 4 linhas por mensagem de disparo.
- Sempre abrir com o nome da cliente quando disponível
- Nunca usar "promoção imperdível" ou clichês de varejo

# FORMATO DA SUA RESPOSTA
Sempre estruture sua análise em seções claras conforme o formato solicitado no user prompt. Seja cirúrgico — Matthews não quer relatório, quer ação.`;

async function sendWhatsApp(supabaseUrl: string, supabaseKey: string, phone: string, message: string) {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/zapi-send-message`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ phone, message }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error('WhatsApp send error:', t);
    }
    return res.ok;
  } catch (err) {
    console.error('WhatsApp send failed:', err);
    return false;
  }
}

async function callAnthropic(anthropicKey: string, userPrompt: string): Promise<{ text: string; usage: any }> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return {
    text: data.content?.[0]?.text || 'Sem resposta do agente.',
    usage: data.usage,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json().catch(() => ({}));
    const mode = body.mode || 'run_agent';

    // ========== SUNDAY REMINDER MODE ==========
    if (mode === 'sunday_reminder') {
      console.log('Sending Sunday reminder...');
      const msg = `📋 *Lembrete — Novidades da Semana*\n\nOi Matthews! Amanhã às 7h o Agente de Clientes vai rodar automaticamente.\n\nPor favor, acesse o sistema e preencha as *Novidades de Estoque* da semana para que a análise fique completa.\n\n👉 Acesse: Agentes de IA → Novidades da Semana`;
      await sendWhatsApp(supabaseUrl, supabaseKey, ADMIN_PHONE, msg);
      return new Response(JSON.stringify({ success: true, message: 'Reminder sent' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ========== MAIN AGENT EXECUTION ==========
    if (!anthropicKey) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    const now = new Date();

    // 1. AUTO-CALCULATE VERBA
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const { data: recentSales } = await supabase
      .from('pos_sales')
      .select('total')
      .gte('created_at', sevenDaysAgo.toISOString())
      .neq('status', 'cancelled');

    const revenueLastWeek = (recentSales || []).reduce((sum: number, s: any) => sum + (s.total || 0), 0);
    const custoFixoSemanal = 71279 / 4.4;
    let verba = Math.round(revenueLastWeek * 0.482 - custoFixoSemanal);
    verba = Math.max(500, Math.min(7000, verba));

    // 2. META DA SEMANA
    const meta = Math.round(131400 / 4.4);

    // 3. NOVIDADES FROM DB
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1); // Monday
    const weekStartStr = weekStart.toISOString().split('T')[0];

    const { data: ctxRow } = await supabase
      .from('agent_weekly_context')
      .select('value')
      .eq('key', 'novidades_estoque')
      .order('week_start', { ascending: false })
      .limit(1)
      .maybeSingle();

    const novidades = ctxRow?.value || 'Nenhuma novidade informada para esta semana.';

    // 4. FETCH PRIORITY CUSTOMERS (45-180 days inactive)
    const daysAgo45 = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000);
    const daysAgo180 = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

    const { data: customers, error: custErr } = await supabase
      .from('zoppy_customers')
      .select('first_name, last_name, phone, rfm_segment, rfm_total_score, last_purchase_at, total_spent, avg_ticket, total_orders, preferred_style, shoe_size, cashback_balance, tags')
      .not('phone', 'is', null)
      .gt('total_orders', 0)
      .lte('last_purchase_at', daysAgo45.toISOString())
      .gte('last_purchase_at', daysAgo180.toISOString())
      .order('rfm_total_score', { ascending: false })
      .order('total_spent', { ascending: false })
      .limit(200);

    if (custErr) throw custErr;

    // Segment summary
    const { data: segCounts } = await supabase
      .from('zoppy_customers')
      .select('rfm_segment')
      .not('rfm_segment', 'is', null)
      .gt('total_orders', 0);

    const segmentSummary: Record<string, number> = {};
    (segCounts || []).forEach(c => {
      segmentSummary[c.rfm_segment] = (segmentSummary[c.rfm_segment] || 0) + 1;
    });

    const priorityCustomers = (customers || []).map(c => ({
      name: `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Sem nome',
      phone: c.phone,
      rfm_segment: c.rfm_segment || 'Outros',
      rfm_score: c.rfm_total_score || 0,
      last_purchase_at: c.last_purchase_at,
      total_spent: c.total_spent || 0,
      avg_ticket: c.avg_ticket || 0,
      total_orders: c.total_orders || 0,
      preferred_style: c.preferred_style,
      shoe_size: c.shoe_size,
      cashback_balance: c.cashback_balance || 0,
      tags: c.tags,
      days_inactive: c.last_purchase_at
        ? Math.floor((now.getTime() - new Date(c.last_purchase_at).getTime()) / (1000 * 60 * 60 * 24))
        : 999,
    }));

    const today = now.toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const userPrompt = `Analise a base de clientes da Banana Calçados e entregue um plano de reativação para esta semana.

RESUMO DA BASE POR SEGMENTO:
${Object.entries(segmentSummary).map(([seg, count]) => `- ${seg}: ${count} clientes`).join('\n')}

DADOS DOS CLIENTES PRIORITÁRIOS (${priorityCustomers.length} clientes inativos entre 45-180 dias):
${JSON.stringify(priorityCustomers.slice(0, 80), null, 2)}

CONTEXTO DA SEMANA:
- Data de hoje: ${today}
- Novidades em estoque: ${novidades}
- Verba disponível para ações desta semana: R$ ${verba.toLocaleString('pt-BR')}
- Meta de faturamento da semana: R$ ${meta.toLocaleString('pt-BR')}
- Receita da última semana: R$ ${revenueLastWeek.toLocaleString('pt-BR')}

ENTREGUE EXATAMENTE NESTE FORMATO:

## 📊 DIAGNÓSTICO RÁPIDO
[3-4 linhas: quantos em risco, potencial de receita estimado, urgências]

## 🎯 LISTA DE REATIVAÇÃO PRIORITÁRIA
[Tabela: Nome | Segmento | Dias sem comprar | Por que agora | Abordagem sugerida]
[Máximo 30 clientes, ordenados por prioridade]

## 💬 SCRIPTS DE DISPARO POR SEGMENTO
[Para cada segmento presente na lista, escreva 1 script modelo pronto para usar]
[Formato: SEGMENTO → script completo entre aspas]

## ⚡ AÇÃO IMEDIATA
[O que fazer hoje, em ordem de execução. Máximo 5 itens.]

## 💰 POTENCIAL DE RECEITA
[Estimativa conservadora: se 10% da lista responder e converter]`;

    const inputData = {
      verba,
      meta,
      novidades,
      customers_count: priorityCustomers.length,
      segments: segmentSummary,
      revenue_last_week: revenueLastWeek,
    };

    // Create execution record
    const { data: execution, error: execErr } = await supabase
      .from('agent_executions')
      .insert({
        agent_name: 'customers_rfm',
        input_data: inputData,
        status: 'running',
      })
      .select('id')
      .single();

    if (execErr) throw execErr;
    const executionId = execution.id;

    // 5. CALL ANTHROPIC WITH RETRY
    let aiResult: { text: string; usage: any } | null = null;
    let lastError = '';

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`Anthropic attempt ${attempt}/${MAX_RETRIES}...`);
        aiResult = await callAnthropic(anthropicKey, userPrompt);
        break;
      } catch (err) {
        lastError = err.message;
        console.error(`Attempt ${attempt} failed:`, lastError);

        await supabase.from('agent_executions').update({
          retry_count: attempt,
          error_message: lastError,
        }).eq('id', executionId);

        if (attempt < MAX_RETRIES) {
          console.log(`Waiting ${RETRY_DELAY_MS / 1000}s before retry...`);
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        }
      }
    }

    if (!aiResult) {
      // All retries failed
      await supabase.from('agent_executions').update({
        status: 'error',
        error_message: lastError,
      }).eq('id', executionId);

      // Log to ai_error_logs
      await supabase.from('ai_error_logs').insert({
        agent: 'agent_customers_rfm',
        error_type: 'api_failure',
        error_message: lastError,
        phone: ADMIN_PHONE,
        status: 'pending',
      });

      // Notify via WhatsApp
      await sendWhatsApp(supabaseUrl, supabaseKey, ADMIN_PHONE,
        `⚠️ *Agente de Clientes não rodou hoje.*\n\nErro após ${MAX_RETRIES} tentativas: ${lastError.substring(0, 200)}\n\nAcesse o sistema para executar manualmente.`);

      return new Response(JSON.stringify({ success: false, error: lastError }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 6. SAVE RESULT
    await supabase.from('agent_executions').update({
      status: 'success',
      output_result: aiResult.text,
      input_data: { ...inputData, tokens: aiResult.usage },
    }).eq('id', executionId);

    // 7. SEND VIA WHATSAPP (truncate for WhatsApp limit)
    const whatsappSummary = aiResult.text.length > 4000
      ? aiResult.text.substring(0, 4000) + '\n\n... (resultado completo no sistema)'
      : aiResult.text;

    await sendWhatsApp(supabaseUrl, supabaseKey, ADMIN_PHONE,
      `🤖 *Agente de Clientes — Relatório Semanal*\n\n${whatsappSummary}`);

    console.log(`Agent completed. ${priorityCustomers.length} customers analyzed.`);

    return new Response(JSON.stringify({
      success: true,
      execution_id: executionId,
      response: aiResult.text,
      meta: {
        customers_analyzed: priorityCustomers.length,
        segments: segmentSummary,
        verba,
        meta,
        tokens_used: aiResult.usage,
      },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Agent cron error:', error);

    // Log error
    await supabase.from('ai_error_logs').insert({
      agent: 'agent_customers_rfm',
      error_type: 'execution_error',
      error_message: error.message,
      phone: ADMIN_PHONE,
      status: 'pending',
    }).catch(() => {});

    return new Response(JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
