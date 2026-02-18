import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    const body = await req.json().catch(() => ({}));
    const { transaction_ids } = body;

    // Get categories
    const { data: categories } = await supabase
      .from('financial_categories').select('id, name, type, parent_id').eq('is_active', true);

    if (!categories?.length) {
      return new Response(JSON.stringify({ success: false, error: 'Nenhuma categoria cadastrada. Sincronize do Tiny primeiro.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build category hierarchy for better context
    const parentCats = categories.filter(c => !c.parent_id || categories.every(p => p.id !== c.parent_id));
    const childCats = categories.filter(c => c.parent_id && categories.some(p => p.id === c.parent_id));

    // Fetch confirmed transactions as learning examples (up to 200 most recent)
    const { data: confirmedTxs } = await supabase
      .from('bank_transactions')
      .select('description, memo, amount, type, category_id')
      .eq('classification_status', 'confirmed')
      .not('category_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(200);

    // Build examples grouped by category for the prompt
    let examplesBlock = '';
    if (confirmedTxs?.length) {
      const byCat: Record<string, { name: string; examples: string[] }> = {};
      for (const tx of confirmedTxs) {
        const cat = categories.find(c => c.id === tx.category_id);
        if (!cat) continue;
        if (!byCat[cat.id]) byCat[cat.id] = { name: cat.name, examples: [] };
        if (byCat[cat.id].examples.length < 8) {
          byCat[cat.id].examples.push(`"${tx.description}"${tx.memo ? ` (memo: "${tx.memo}")` : ''} R$${Math.abs(tx.amount)}`);
        }
      }
      const lines = Object.entries(byCat).map(([id, info]) =>
        `Categoria "${info.name}" (id: ${id}):\n${info.examples.map(e => `  - ${e}`).join('\n')}`
      );
      examplesBlock = `\n\nEXEMPLOS JÁ CONFIRMADOS PELO USUÁRIO (use como referência principal):\n${lines.join('\n\n')}`;
    }

    // Get pending transactions
    let allTransactions: any[] = [];
    if (transaction_ids?.length) {
      for (let i = 0; i < transaction_ids.length; i += 500) {
        const chunk = transaction_ids.slice(i, i + 500);
        const { data } = await supabase.from('bank_transactions')
          .select('id, description, memo, amount, type, transaction_date')
          .in('id', chunk);
        if (data) allTransactions.push(...data);
      }
    } else {
      let page = 0;
      const pageSize = 1000;
      let hasMore = true;
      while (hasMore) {
        const { data } = await supabase.from('bank_transactions')
          .select('id, description, memo, amount, type, transaction_date')
          .eq('classification_status', 'pending')
          .range(page * pageSize, (page + 1) * pageSize - 1);
        if (data && data.length > 0) {
          allTransactions.push(...data);
          if (data.length < pageSize) hasMore = false;
          page++;
        } else {
          hasMore = false;
        }
      }
    }
    const transactions = allTransactions;

    if (!transactions?.length) {
      return new Response(JSON.stringify({ success: true, classified: 0, message: 'Nenhuma transação pendente' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const categoryList = categories.map(c => {
      const parent = c.parent_id ? categories.find(p => p.id === c.parent_id) : null;
      return `- "${c.name}" (${c.type}${parent ? `, sub de "${parent.name}"` : ''}, id: ${c.id})`;
    }).join('\n');

    // Process in batches of 10
    let classified = 0;
    const batchSize = 10;

    for (let i = 0; i < transactions.length; i += batchSize) {
      const batch = transactions.slice(i, i + batchSize);
      const transactionDescriptions = batch.map((t, idx) => 
        `${idx + 1}. "${t.description}" | memo: "${t.memo || ''}" | valor: R$${Math.abs(t.amount)} | tipo: ${t.type} | data: ${t.transaction_date}`
      ).join('\n');

      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            {
              role: 'system',
              content: `Você é um classificador financeiro especialista. Classifique cada transação bancária na categoria mais adequada.

REGRAS IMPORTANTES:
1. Priorize os exemplos confirmados pelo usuário — se a descrição for similar a um exemplo, use a MESMA categoria.
2. Busque padrões: palavras-chave, prefixos, nomes de fornecedores, padrões de valor.
3. Para débitos/saídas, prefira categorias de "despesa". Para créditos/entradas, prefira categorias de "receita".
4. Se a descrição contém nome de banco, cartão, ou termos como "TAR", "IOF", "JUROS" → despesas bancárias/financeiras.
5. Transferências entre contas (PIX, TED, DOC) com mesmo titular → pode ser transferência interna.
6. Pagamentos recorrentes com valores similares → mesma categoria que exemplos anteriores.

CATEGORIAS DISPONÍVEIS:
${categoryList}
${examplesBlock}

Responda APENAS com o JSON via tool call. Para cada transação, retorne category_id e confidence (0-1). Use confidence alta (>0.85) quando a descrição for muito similar a exemplos confirmados.`
            },
            {
              role: 'user',
              content: `Classifique estas transações:\n${transactionDescriptions}`
            }
          ],
          tools: [{
            type: 'function',
            function: {
              name: 'classify_transactions',
              description: 'Classify bank transactions into financial categories',
              parameters: {
                type: 'object',
                properties: {
                  classifications: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        index: { type: 'number', description: '1-based index of the transaction' },
                        category_id: { type: 'string', description: 'UUID of the best matching category' },
                        confidence: { type: 'number', description: 'Confidence score 0 to 1' }
                      },
                      required: ['index', 'category_id', 'confidence'],
                      additionalProperties: false
                    }
                  }
                },
                required: ['classifications'],
                additionalProperties: false
              }
            }
          }],
          tool_choice: { type: 'function', function: { name: 'classify_transactions' } }
        }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          console.log('Rate limited, waiting...');
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }
        console.error('AI error:', response.status, await response.text());
        continue;
      }

      const aiData = await response.json();
      const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall) continue;

      try {
        const result = JSON.parse(toolCall.function.arguments);
        const classifications = result.classifications || [];

        for (const cls of classifications) {
          const txIndex = cls.index - 1;
          if (txIndex >= 0 && txIndex < batch.length) {
            const tx = batch[txIndex];
            await supabase.from('bank_transactions').update({
              ai_category_id: cls.category_id,
              ai_confidence: cls.confidence,
              classification_status: 'ai_suggested',
            }).eq('id', tx.id);
            classified++;
          }
        }
      } catch (e) {
        console.error('Parse error:', e);
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    return new Response(JSON.stringify({ 
      success: true, classified, total: transactions.length,
      examples_used: confirmedTxs?.length || 0
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, error: (error as Error).message }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
