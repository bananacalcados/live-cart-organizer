import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableKey = Deno.env.get('LOVABLE_API_KEY');
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');

    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await req.json();
    const { novidades: novidadesOverride } = body;

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

    // 2. META
    const meta = Math.round(131400 / 4.4);

    // 3. NOVIDADES
    let novidades = novidadesOverride;
    if (!novidades) {
      const { data: ctxRow } = await supabase
        .from('agent_weekly_context')
        .select('value')
        .eq('key', 'novidades_estoque')
        .order('week_start', { ascending: false })
        .limit(1)
        .maybeSingle();
      novidades = ctxRow?.value || 'Nenhuma novidade informada para esta semana.';
    }

    // 4. FETCH CUSTOMERS WITH COOLDOWN FILTERING
    console.log('Calling get_reactivation_candidates...');
    const { data: filterResult, error: filterErr } = await supabase.rpc('get_reactivation_candidates', { p_limit: 200 });

    if (filterErr) throw filterErr;

    const filterSummary = filterResult?.filter_summary || {};
    const filteredCustomers = filterResult?.customers || [];

    console.log('Filter summary:', JSON.stringify(filterSummary));
    console.log(`Eligible customers: ${filteredCustomers.length}`);

    // Build priority customer list
    const priorityCustomers = filteredCustomers.map((c: any) => ({
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

    // Segment summary from eligible customers
    const segmentSummary: Record<string, number> = {};
    priorityCustomers.forEach((c: any) => {
      segmentSummary[c.rfm_segment] = (segmentSummary[c.rfm_segment] || 0) + 1;
    });

    const today = now.toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const userPrompt = `Analise a base de clientes da Banana Calçados e entregue um plano de reativação para esta semana.

IMPORTANTE: Todos os clientes abaixo já passaram por filtragem automática de cooldown. Nenhum deles recebeu mensagem recente, está em atendimento ativo ou comprou nos últimos 30 dias. Você pode incluir todos na sua análise sem preocupação de spam.

RESUMO DA FILTRAGEM AUTOMÁTICA:
- Total de candidatos (inativos 45-180 dias): ${filterSummary.total_candidates || 0}
- Bloqueados por cooldown de disparo: ${filterSummary.bloqueados_cooldown || 0}
- Bloqueados por atendimento ativo: ${filterSummary.bloqueados_atendimento_ativo || 0}
- Bloqueados por compra recente: ${filterSummary.bloqueados_compra_recente || 0}
- Clientes elegíveis para reativação: ${filterSummary.clientes_elegiveis || 0}

SEGMENTOS DOS CLIENTES ELEGÍVEIS:
${Object.entries(segmentSummary).map(([seg, count]) => `- ${seg}: ${count} clientes`).join('\n')}

DADOS DOS CLIENTES PRIORITÁRIOS (${priorityCustomers.length} clientes elegíveis):
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

    // 5. CALL AI (Lovable AI Gateway preferred, Anthropic as fallback)
    let aiResponse: string;
    let tokensUsed: any = null;

    if (lovableKey) {
      console.log(`Calling Lovable AI Gateway with ${priorityCustomers.length} priority customers...`);
      const aiRes = await fetch('https://ai-gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${lovableKey}`,
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 8000,
        }),
      });

      if (!aiRes.ok) {
        const errText = await aiRes.text();
        throw new Error(`Lovable AI Gateway ${aiRes.status}: ${errText}`);
      }

      const aiData = await aiRes.json();
      aiResponse = aiData.choices?.[0]?.message?.content || 'Sem resposta do agente.';
      tokensUsed = aiData.usage;
    } else if (anthropicKey) {
      console.log(`Calling Anthropic with ${priorityCustomers.length} priority customers...`);
      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
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

      if (!anthropicRes.ok) {
        const errText = await anthropicRes.text();
        throw new Error(`Anthropic API ${anthropicRes.status}: ${errText}`);
      }

      const anthropicData = await anthropicRes.json();
      aiResponse = anthropicData.content?.[0]?.text || 'Sem resposta do agente.';
      tokensUsed = anthropicData.usage;
    } else {
      throw new Error('No AI API key configured (LOVABLE_API_KEY or ANTHROPIC_API_KEY)');
    }

    // 6. SAVE EXECUTION
    const inputData = {
      verba,
      meta,
      novidades,
      customers_count: priorityCustomers.length,
      segments: segmentSummary,
      revenue_last_week: revenueLastWeek,
      tokens: tokensUsed,
      filter_summary: filterSummary,
    };

    await supabase.from('agent_executions').insert({
      agent_name: 'customers_rfm',
      input_data: inputData,
      output_result: aiResponse,
      status: 'success',
    });

    return new Response(JSON.stringify({
      success: true,
      response: aiResponse,
      meta: {
        customers_analyzed: priorityCustomers.length,
        segments: segmentSummary,
        verba,
        meta,
        revenue_last_week: revenueLastWeek,
        tokens_used: tokensUsed,
        filter_summary: filterSummary,
      },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Agent error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
