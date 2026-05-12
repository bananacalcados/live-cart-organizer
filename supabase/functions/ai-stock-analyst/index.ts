import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SYSTEM_PROMPT = `Você é o analista de estoque e vendas da Banana Calçados, uma rede de calçados com três canais: Loja Pérola, Loja Centro e E-commerce.

IDENTIDADE DO NEGÓCIO:
- Ticket médio: R$200
- Foco principal: feminino. Masculino apenas nas lojas físicas (prioritário no Centro). E-commerce: tênis feminino como carro-chefe
- Infantil: categoria secundária, manter mínimo sem expansão

CATEGORIAS: Tênis Casual, Tênis Esportivo, Saltos, Papetes, Rasteirinhas, Chinelos, Babuches, Sapato Social (masc.), Tamancos, Botas, Bolsas

REGRAS DE GIRO:
- Alto: vende em até 30 dias → nunca deixar em ruptura
- Médio: 31 a 60 dias → monitorar cobertura
- Baixo: 61 a 90 dias → atenção
- Encalhe: mais de 90 dias → protocolo de queima

REGRAS DE COBERTURA:
- Crítico: menos de 30 dias → reposição urgente (prazo do fornecedor = 30 dias)
- Atenção: 30 a 45 dias → planejar compra
- Saudável: 45 a 60 dias → monitorar
- Excesso: mais de 60 dias em produto de baixo giro → avaliar queima

REGRAS DE GRADE:
- Nenhum fornecedor vende numeração avulsa — sempre grade fechada
- NUNCA recomendar compra de nova grade se há grade anterior encalhada do mesmo modelo
- Grade incompleta = capital imobilizado sem liquidez
- Antes de qualquer reposição, verificar se os tamanhos restantes têm giro realista
- Se não têm: recomendar queima primeiro para liberar capital

FAIXA DE PREÇO:
- Entrada (até R$80): função de atração de fluxo — presença obrigatória na vitrine. Não recomendar queima por margem baixa
- Intermediária (R$80-R$150): motor de faturamento do dia a dia
- Premium (acima de R$150): margem e percepção — giro naturalmente menor, não confundir com encalhe

SAZONALIDADE:
- Valadares é quente o ano todo → abertos (chinelos, papetes, rasteirinhas, babuches) vendem sempre
- Abril a Julho: frio + eventos → botas têm alta esperada
- E-commerce: tênis sem sazonalidade marcada

PRESENÇA OBRIGATÓRIA (não avaliar só pelo giro):
- Chinelos: sempre em todas as lojas físicas
- Masculino: sempre no Centro
- Produtos de faixa entrada: sempre na vitrine

REGRAS DE COMPRA — sinal verde apenas quando:
✓ Cobertura abaixo de 30 dias
✓ Produto tem histórico de giro comprovado
✓ Não há grade anterior encalhada do mesmo modelo
✓ Capital recuperável antes do prazo de entrega

REGRAS DE COMPRA — sinal vermelho:
✗ Grade anterior ainda encalhada
✗ Categoria em queda nos últimos 2-3 meses
✗ Sazonalidade desfavorável sem histórico de giro no período

CANAL CENTRO: atende cidades vizinhas — cliente que vem de longe não volta amanhã. Ruptura aqui tem impacto maior. Cobertura mínima do masculino deve ser maior que na Pérola.

CANAL E-COMMERCE: ruptura online = produto invisível = venda zero. Cobertura mínima de 45 dias.

Ao analisar, sempre considere:
1. O papel estratégico do produto além do giro (fluxo, mix, presença)
2. A situação completa da grade antes de recomendar compra
3. A sazonalidade do período atual
4. As diferenças entre os canais

Responda sempre em português brasileiro. Seja direto e prático. Priorize os alertas mais críticos primeiro.`;

const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const LOVABLE_FALLBACK_MODEL = 'google/gemini-2.5-pro';
const LOVABLE_AI_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const CACHE_HOURS = 4;

function classificarGiro(d: number | null): string {
  if (d === null) return 'sem_venda';
  if (d <= 30) return 'alto';
  if (d <= 60) return 'medio';
  if (d <= 90) return 'baixo';
  return 'encalhe';
}
function classificarFaixaPreco(p: number): string {
  if (p <= 80) return 'entrada';
  if (p <= 150) return 'intermediario';
  return 'premium';
}
function diasEntre(a: Date, b: Date) {
  return Math.floor((a.getTime() - b.getTime()) / 86400000);
}
function inferirCategoria(nome: string): string {
  const n = (nome || '').toLowerCase();
  if (n.includes('tênis') || n.includes('tenis')) return 'Tênis';
  if (n.includes('sandália') || n.includes('sandalia')) return 'Sandália';
  if (n.includes('rasteira') || n.includes('rasteirinha')) return 'Rasteirinha';
  if (n.includes('bota')) return 'Bota';
  if (n.includes('chinelo')) return 'Chinelo';
  if (n.includes('papete')) return 'Papete';
  if (n.includes('babuche')) return 'Babuche';
  if (n.includes('salto') || n.includes('scarpin') || n.includes('anabela')) return 'Salto';
  if (n.includes('tamanco')) return 'Tamanco';
  if (n.includes('social')) return 'Sapato Social';
  if (n.includes('bolsa')) return 'Bolsa';
  if (n.includes('infantil') || n.includes('baby') || n.includes('kids')) return 'Infantil';
  return 'Outros';
}
function normalizeModelName(name: string, size?: string | null): string {
  let n = (name || '').trim().toLowerCase();
  if (size) {
    const s = String(size).trim().toLowerCase();
    n = n.replace(new RegExp(`\\b(tam|tamanho|n[º°o.]?)?\\s*${s}\\b`, 'gi'), '');
    n = n.replace(new RegExp(`\\s${s}$`), '');
  }
  return n.replace(/\s+/g, ' ').trim();
}

async function buildContexto(supabase: any) {
  const agora = new Date();
  const noventaDiasAtras = new Date(agora.getTime() - 90 * 86400000).toISOString();
  const trintaDiasAtras = new Date(agora.getTime() - 30 * 86400000);

  const vendas: any[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('pos_sale_items')
      .select(`sku, product_name, size, category, unit_price, quantity, total_price, created_at,
        sale:pos_sales!inner ( id, store_id, status, created_at )`)
      .eq('sale.status', 'completed')
      .gte('sale.created_at', noventaDiasAtras)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    vendas.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  const { data: lojas } = await supabase.from('pos_stores').select('id, name').eq('is_active', true);
  const lojaMap = new Map((lojas || []).map((l: any) => [l.id, l.name]));

  const produtos: any[] = [];
  from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('pos_products')
      .select('sku, name, size, category, price, cost_price, stock, store_id, synced_at')
      .eq('is_active', true)
      .gte('stock', 0)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    produtos.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  const aggVendas = new Map<string, any>();
  for (const v of vendas) {
    const sale = v.sale;
    if (!sale) continue;
    const key = `${v.sku || ''}|${v.size || ''}|${sale.store_id}`;
    const dt = new Date(sale.created_at);
    let cur = aggVendas.get(key);
    if (!cur) {
      cur = {
        total_vendido: 0,
        num_vendas: new Set<string>(),
        faturamento: 0,
        primeira_venda: dt,
        ultima_venda: dt,
        vendido_30d: 0,
      };
      aggVendas.set(key, cur);
    }
    cur.total_vendido += Number(v.quantity) || 0;
    cur.num_vendas.add(sale.id);
    cur.faturamento += Number(v.total_price) || 0;
    if (dt < cur.primeira_venda) cur.primeira_venda = dt;
    if (dt > cur.ultima_venda) cur.ultima_venda = dt;
    if (dt >= trintaDiasAtras) cur.vendido_30d += Number(v.quantity) || 0;
  }

  const agoraMs = agora.getTime();
  const seteDiasMs = 7 * 86400000;
  const todosProdutos = produtos.map((p: any) => {
    const key = `${p.sku || ''}|${p.size || ''}|${p.store_id}`;
    const v = aggVendas.get(key);
    const dias_desde_ultima_venda = v ? diasEntre(agora, v.ultima_venda) : null;
    const ritmo_vendas_30d = v ? +(v.vendido_30d / 30).toFixed(3) : 0;
    const cobertura_dias = ritmo_vendas_30d > 0 ? +(Number(p.stock) / ritmo_vendas_30d).toFixed(1) : null;
    const syncedAt = p.synced_at ? new Date(p.synced_at) : null;
    const sync_recente = syncedAt ? (agoraMs - syncedAt.getTime()) <= seteDiasMs : false;
    const categoriaFinal = (p.category && String(p.category).trim()) || inferirCategoria(p.name);
    return {
      sku: p.sku,
      nome: p.name,
      modelo_norm: normalizeModelName(p.name, p.size),
      size: p.size,
      categoria: categoriaFinal,
      preco: Number(p.price) || 0,
      custo: Number(p.cost_price) || 0,
      estoque: Number(p.stock) || 0,
      store_id: p.store_id,
      loja: lojaMap.get(p.store_id) || 'Desconhecida',
      synced_at: p.synced_at,
      sync_recente,
      dias_desde_ultima_venda,
      vendido_90d: v?.total_vendido || 0,
      vendido_30d: v?.vendido_30d || 0,
      faturamento_90d: v ? +v.faturamento.toFixed(2) : 0,
      ritmo_vendas_30d,
      cobertura_dias,
      classificacao_giro: classificarGiro(dias_desde_ultima_venda),
      faixa_preco: classificarFaixaPreco(Number(p.price) || 0),
    };
  });

  const resumo_lojas: Record<string, { faturamento: number; unidades: number }> = {};
  for (const v of vendas) {
    const sale = v.sale;
    if (!sale) continue;
    if (new Date(sale.created_at) < trintaDiasAtras) continue;
    const nome = (lojaMap.get(sale.store_id) as string) || 'Desconhecida';
    if (!resumo_lojas[nome]) resumo_lojas[nome] = { faturamento: 0, unidades: 0 };
    resumo_lojas[nome].faturamento += Number(v.total_price) || 0;
    resumo_lojas[nome].unidades += Number(v.quantity) || 0;
  }

  const catAgg: Record<string, any> = {};
  for (const v of vendas) {
    const c = v.category || inferirCategoria(v.product_name) || 'Sem categoria';
    if (!catAgg[c]) catAgg[c] = { faturamento: 0, unidades: 0, skus: new Set<string>() };
    catAgg[c].faturamento += Number(v.total_price) || 0;
    catAgg[c].unidades += Number(v.quantity) || 0;
    if (v.sku) catAgg[c].skus.add(v.sku);
  }
  const categorias = Object.entries(catAgg)
    .map(([nome, d]: [string, any]) => ({
      categoria: nome,
      faturamento_90d: +d.faturamento.toFixed(2),
      unidades_90d: d.unidades,
      skus_distintos: d.skus.size,
    }))
    .sort((a, b) => b.faturamento_90d - a.faturamento_90d);

  const alertas_ruptura = todosProdutos.filter(
    (p) => p.cobertura_dias !== null && p.cobertura_dias < 30 &&
      (p.classificacao_giro === 'alto' || p.classificacao_giro === 'medio')
  );

  const alertas_encalhe = todosProdutos.filter(
    (p) => p.estoque > 0 && (p.classificacao_giro === 'encalhe' || p.classificacao_giro === 'sem_venda')
  );

  const gradeMap = new Map<string, any[]>();
  for (const p of todosProdutos) {
    const k = `${p.modelo_norm}|${p.store_id}`;
    if (!gradeMap.has(k)) gradeMap.set(k, []);
    gradeMap.get(k)!.push(p);
  }
  const grade_incompleta: any[] = [];
  for (const items of gradeMap.values()) {
    if (items.length < 2) continue;
    const temZero = items.some((i: any) => i.estoque === 0);
    const temPos = items.some((i: any) => i.estoque > 0);
    if (temZero && temPos) {
      grade_incompleta.push({
        modelo: items[0].nome,
        loja: items[0].loja,
        categoria: items[0].categoria,
        tamanhos: items.map((i: any) => ({ size: i.size, estoque: i.estoque, giro: i.classificacao_giro })),
      });
    }
  }

  const produtos_sem_venda_recente = todosProdutos.filter(
    (p) => p.estoque > 0 && (p.dias_desde_ultima_venda === null || p.dias_desde_ultima_venda > 60)
  );

  const top20_faturamento_30d = [...todosProdutos]
    .filter((p) => p.vendido_30d > 0)
    .sort((a, b) => b.vendido_30d * b.preco - a.vendido_30d * a.preco)
    .slice(0, 20);

  return {
    gerado_em: agora.toISOString(),
    janela_vendas_dias: 90,
    resumo_lojas,
    categorias,
    alertas_ruptura,
    alertas_encalhe,
    grade_incompleta,
    produtos_sem_venda_recente,
    top20_faturamento_30d,
    todos_produtos: todosProdutos,
    totais: {
      total_skus: todosProdutos.length,
      total_alertas_ruptura: alertas_ruptura.length,
      total_alertas_encalhe: alertas_encalhe.length,
      total_grade_incompleta: grade_incompleta.length,
      total_sem_venda_60d: produtos_sem_venda_recente.length,
    },
  };
}

function contextoFiltradoParaAnalise(c: any) {
  return {
    gerado_em: c.gerado_em,
    janela_vendas_dias: c.janela_vendas_dias,
    resumo_lojas: c.resumo_lojas,
    categorias: c.categorias,
    totais: c.totais,
    alertas_ruptura: c.alertas_ruptura,
    alertas_encalhe: c.alertas_encalhe,
    grade_incompleta: c.grade_incompleta,
    produtos_sem_venda_recente: c.produtos_sem_venda_recente,
    top20_faturamento_30d: c.top20_faturamento_30d,
  };
}

function parseJsonText(text: string) {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : JSON.parse(text);
  } catch {
    return { raw: text, parse_error: true };
  }
}

async function callAnthropic(userContent: string, asJson: boolean) {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada');

  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Anthropic ${resp.status}: ${t}`);
  }
  const data = await resp.json();
  const text = data.content?.[0]?.text || '';
  if (!asJson) return { text, usage: data.usage, model: ANTHROPIC_MODEL, provider: 'anthropic' };
  return { json: parseJsonText(text), usage: data.usage, model: ANTHROPIC_MODEL, provider: 'anthropic' };
}

async function callLovableAI(userContent: string, asJson: boolean) {
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey) throw new Error('LOVABLE_API_KEY não configurada');

  const resp = await fetch(LOVABLE_AI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: LOVABLE_FALLBACK_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      ...(asJson ? { response_format: { type: 'json_object' } } : {}),
    }),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`LovableAI ${resp.status}: ${t}`);
  }
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || '';
  if (!asJson) return { text, usage: data.usage, model: LOVABLE_FALLBACK_MODEL, provider: 'lovable_ai' };
  return { json: parseJsonText(text), usage: data.usage, model: LOVABLE_FALLBACK_MODEL, provider: 'lovable_ai' };
}

async function callAI(userContent: string, asJson: boolean) {
  try {
    return await callAnthropic(userContent, asJson);
  } catch (err) {
    console.warn('Anthropic falhou, fallback Lovable AI:', err instanceof Error ? err.message : err);
    const result = await callLovableAI(userContent, asJson);
    return { ...result, fallback_reason: err instanceof Error ? err.message : String(err) };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const mode = body.mode || (body.mensagem ? 'chat' : 'analise');
    const force = body.force === true;

    if (mode === 'chat') {
      const { mensagem, historico_conversa } = body;
      if (!mensagem) {
        return new Response(JSON.stringify({ error: 'mensagem é obrigatória' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const contexto = await buildContexto(supabase);
      const historicoTxt = (historico_conversa || [])
        .map((m: any) => `${m.role === 'user' ? 'Usuário' : 'Analista'}: ${m.content}`)
        .join('\n');

      const userContent = `CONTEXTO COMPLETO DO ESTOQUE/VENDAS (JSON, inclui todos_produtos para consultas específicas):
\`\`\`json
${JSON.stringify(contexto, null, 2)}
\`\`\`

HISTÓRICO DA CONVERSA:
${historicoTxt}

NOVA PERGUNTA DO USUÁRIO:
${mensagem}`;

      const { text, usage, model, provider, fallback_reason } = await callAI(userContent, false);
      return new Response(
        JSON.stringify({ resposta: text, usage, model, provider, fallback_reason, contexto_resumo: contexto.totais }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Modo análise
    if (!force) {
      const cutoff = new Date(Date.now() - CACHE_HOURS * 3600 * 1000).toISOString();
      const { data: cached } = await supabase
        .from('ai_stock_analyses')
        .select('id, analise, contexto_resumo, created_at, model')
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cached) {
        return new Response(
          JSON.stringify({
            analise: cached.analise,
            contexto_resumo: cached.contexto_resumo,
            gerado_em: cached.created_at,
            model: cached.model,
            cached: true,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const contexto = await buildContexto(supabase);
    const filtrado = contextoFiltradoParaAnalise(contexto);

    const userContent = `Analise o estado atual do estoque e vendas e retorne SOMENTE um JSON válido (sem texto antes ou depois) seguindo este schema:

{
  "insights_proativos": [
    {
      "tipo": "ruptura|encalhe|grade_incompleta|oportunidade|queima|compra",
      "prioridade": "alta|media|baixa",
      "titulo": "string curta",
      "descricao": "string detalhada",
      "produtos_afetados": [{"sku":"","nome":"","loja":"","size":"","estoque":0,"cobertura_dias":0}],
      "acao_recomendada": "string"
    }
  ],
  "resumo_executivo": "parágrafo curto",
  "score_saude_estoque": 0
}

DADOS (já filtrados — apenas alertas, grade incompleta, sem-venda 60d e top 20 do mês):
\`\`\`json
${JSON.stringify(filtrado, null, 2)}
\`\`\``;

    const { json, usage, model, provider, fallback_reason } = await callAI(userContent, true);

    await supabase.from('ai_stock_analyses').insert({
      analise: json,
      contexto_resumo: contexto.totais,
      usage,
      model,
    });

    return new Response(
      JSON.stringify({
        analise: json,
        usage,
        contexto_resumo: contexto.totais,
        gerado_em: contexto.gerado_em,
        model,
        provider,
        fallback_reason,
        cached: false,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('ai-stock-analyst error:', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
