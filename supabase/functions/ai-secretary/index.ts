import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveZApiCredentials, normalizePhone } from "../_shared/zapi-credentials.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { messages, userId } = await req.json();
    if (!messages || !userId) throw new Error('messages and userId required');

    // Build system prompt with current date context
    const now = new Date();
    const brDate = now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const brTime = now.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

    // Fetch user settings
    const { data: settings } = await supabase
      .from('secretary_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    const systemPrompt = `Você é a Secretária Virtual da Banana Calçados, uma assistente de IA inteligente e proativa.
Hoje é ${brDate}, ${brTime} (horário de Brasília).

Seu papel:
1. REGISTRAR contas a pagar no sistema quando solicitado
2. AGENDAR lembretes via WhatsApp para o gestor
3. CONSULTAR dados do sistema (vendas, expedição, estoque, contas a pagar)
4. Ser clara, organizada e confirmar ações realizadas

Regras:
- Sempre confirme o que entendeu antes de executar uma ação
- Após registrar algo, mostre um resumo do que foi feito
- Formate valores em R$ e datas em DD/MM/AAAA
- Seja concisa e profissional, mas simpática
- Use emojis moderadamente para organização visual
- Quando consultar dados, apresente em formato organizado`;

    // Define tools
    const tools = [
      {
        name: "create_account_payable",
        description: "Registra uma nova conta a pagar no sistema. Use quando o usuário pedir para agendar/registrar um boleto, pagamento ou conta de fornecedor.",
        input_schema: {
          type: "object",
          properties: {
            nome_fornecedor: { type: "string", description: "Nome do fornecedor" },
            valor: { type: "number", description: "Valor da conta em reais" },
            data_vencimento: { type: "string", description: "Data de vencimento no formato YYYY-MM-DD" },
            categoria: { type: "string", description: "Categoria da despesa (ex: Material, Serviço, Aluguel)" },
            observacoes: { type: "string", description: "Observações adicionais" },
            store_id: { type: "string", description: "ID da loja (opcional, usar padrão se não especificado)" },
          },
          required: ["nome_fornecedor", "valor", "data_vencimento"],
        },
      },
      {
        name: "create_reminder",
        description: "Cria um lembrete que será enviado via WhatsApp para o gestor.",
        input_schema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Título do lembrete" },
            description: { type: "string", description: "Descrição detalhada" },
            remind_at: { type: "string", description: "Data e hora do lembrete no formato YYYY-MM-DDTHH:mm:ss" },
            reminder_type: { type: "string", enum: ["one_time", "weekly", "daily"], description: "Tipo do lembrete" },
          },
          required: ["title", "remind_at"],
        },
      },
      {
        name: "query_accounts_payable",
        description: "Consulta contas a pagar no sistema. Use para verificar pagamentos pendentes, vencidos ou futuros.",
        input_schema: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["pendente", "pago", "vencido", "todos"], description: "Filtrar por status" },
            date_from: { type: "string", description: "Data início (YYYY-MM-DD)" },
            date_to: { type: "string", description: "Data fim (YYYY-MM-DD)" },
            fornecedor: { type: "string", description: "Nome do fornecedor para filtrar" },
          },
        },
      },
      {
        name: "query_sales",
        description: "Consulta dados de vendas da loja. Retorna resumo de vendas por período.",
        input_schema: {
          type: "object",
          properties: {
            date_from: { type: "string", description: "Data início (YYYY-MM-DD)" },
            date_to: { type: "string", description: "Data fim (YYYY-MM-DD)" },
            store_id: { type: "string", description: "ID da loja (opcional)" },
          },
        },
      },
      {
        name: "query_expedition",
        description: "Consulta dados de expedição/envios. Retorna pedidos pendentes de envio, enviados, etc.",
        input_schema: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["pending", "shipped", "delivered", "all"], description: "Status dos envios" },
            date_from: { type: "string", description: "Data início (YYYY-MM-DD)" },
            date_to: { type: "string", description: "Data fim (YYYY-MM-DD)" },
          },
        },
      },
      {
        name: "send_whatsapp_now",
        description: "Envia uma mensagem WhatsApp imediata para um número específico.",
        input_schema: {
          type: "object",
          properties: {
            phone: { type: "string", description: "Número do telefone com DDD" },
            message: { type: "string", description: "Mensagem a enviar" },
          },
          required: ["phone", "message"],
        },
      },
    ];

    // Call Claude with tools
    const claudeMessages = messages.map((m: any) => ({
      role: m.role,
      content: m.content,
    }));

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: claudeMessages,
        tools,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Claude error:', response.status, errText);
      throw new Error(`Claude API error: ${response.status}`);
    }

    const claudeData = await response.json();

    // Process tool calls
    const toolResults: any[] = [];
    let finalText = '';

    for (const block of claudeData.content) {
      if (block.type === 'text') {
        finalText += block.text;
      } else if (block.type === 'tool_use') {
        const result = await executeToolCall(supabase, block.name, block.input, userId, settings);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }
    }

    // If there were tool calls, send results back to Claude for final response
    if (toolResults.length > 0) {
      const followUpMessages = [
        ...claudeMessages,
        { role: 'assistant', content: claudeData.content },
        { role: 'user', content: toolResults },
      ];

      const followUp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          system: systemPrompt,
          messages: followUpMessages,
          tools,
        }),
      });

      if (followUp.ok) {
        const followUpData = await followUp.json();
        finalText = '';
        for (const block of followUpData.content) {
          if (block.type === 'text') finalText += block.text;
        }
      }
    }

    return new Response(JSON.stringify({ reply: finalText, toolCalls: toolResults.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Secretary error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function executeToolCall(supabase: any, toolName: string, input: any, userId: string, settings: any) {
  switch (toolName) {
    case 'create_account_payable': {
      // Get default store
      let storeId = input.store_id;
      if (!storeId) {
        const { data: stores } = await supabase.from('pos_stores').select('id').limit(1);
        storeId = stores?.[0]?.id;
      }
      if (!storeId) return { error: 'Nenhuma loja encontrada no sistema' };

      const tinyContaId = `manual_${Date.now()}`;
      const { error } = await supabase.from('tiny_accounts_payable').insert({
        tiny_conta_id: tinyContaId,
        store_id: storeId,
        nome_fornecedor: input.nome_fornecedor,
        valor: input.valor,
        saldo: input.valor,
        data_vencimento: input.data_vencimento,
        categoria: input.categoria || 'Outros',
        observacoes: input.observacoes || `Registrado pela Secretária Virtual`,
        situacao: 'aberto',
        data_emissao: new Date().toISOString().split('T')[0],
      });

      if (error) return { error: `Erro ao registrar: ${error.message}` };

      // Auto-create reminder for the due date
      if (settings?.reminder_phone) {
        const dueDate = new Date(input.data_vencimento);
        dueDate.setHours(8, 0, 0, 0);
        await supabase.from('secretary_reminders').insert({
          user_id: userId,
          title: `💰 Pagamento: ${input.nome_fornecedor}`,
          description: `Conta de R$ ${input.valor.toFixed(2)} vence hoje`,
          remind_at: dueDate.toISOString(),
          phone: settings.reminder_phone,
          whatsapp_number_id: settings.whatsapp_number_id,
          reminder_type: 'one_time',
        });
      }

      return { success: true, fornecedor: input.nome_fornecedor, valor: input.valor, vencimento: input.data_vencimento };
    }

    case 'create_reminder': {
      const phone = settings?.reminder_phone;
      if (!phone) return { error: 'Configure seu telefone nas configurações da Secretária primeiro' };

      const { error } = await supabase.from('secretary_reminders').insert({
        user_id: userId,
        title: input.title,
        description: input.description || '',
        remind_at: input.remind_at,
        phone,
        whatsapp_number_id: settings?.whatsapp_number_id,
        reminder_type: input.reminder_type || 'one_time',
      });

      if (error) return { error: `Erro ao criar lembrete: ${error.message}` };
      return { success: true, title: input.title, remind_at: input.remind_at };
    }

    case 'query_accounts_payable': {
      let query = supabase.from('tiny_accounts_payable')
        .select('nome_fornecedor, valor, saldo, data_vencimento, situacao, categoria, observacoes')
        .order('data_vencimento', { ascending: true })
        .limit(20);

      if (input.status === 'pendente') query = query.eq('situacao', 'aberto');
      else if (input.status === 'pago') query = query.eq('situacao', 'pago');
      else if (input.status === 'vencido') {
        query = query.eq('situacao', 'aberto').lt('data_vencimento', new Date().toISOString().split('T')[0]);
      }
      if (input.date_from) query = query.gte('data_vencimento', input.date_from);
      if (input.date_to) query = query.lte('data_vencimento', input.date_to);
      if (input.fornecedor) query = query.ilike('nome_fornecedor', `%${input.fornecedor}%`);

      const { data, error } = await query;
      if (error) return { error: error.message };
      return { contas: data, total: data?.length || 0 };
    }

    case 'query_sales': {
      let query = supabase.from('pos_sales')
        .select('id, total, payment_method, created_at, customer_id, store_id, seller_id')
        .order('created_at', { ascending: false })
        .limit(50);

      if (input.date_from) query = query.gte('created_at', input.date_from);
      if (input.date_to) query = query.lte('created_at', input.date_to + 'T23:59:59');
      if (input.store_id) query = query.eq('store_id', input.store_id);

      const { data, error } = await query;
      if (error) return { error: error.message };

      const totalSales = data?.reduce((s: number, sale: any) => s + (sale.total || 0), 0) || 0;
      return {
        vendas: data?.length || 0,
        faturamento_total: totalSales,
        ticket_medio: data?.length ? totalSales / data.length : 0,
      };
    }

    case 'query_expedition': {
      let query = supabase.from('expedition_orders')
        .select('shopify_order_name, customer_name, expedition_status, freight_tracking_code, freight_carrier, total_price, created_at')
        .order('created_at', { ascending: false })
        .limit(30);

      if (input.status === 'pending') query = query.in('expedition_status', ['pending', 'picking', 'packing']);
      else if (input.status === 'shipped') query = query.eq('expedition_status', 'shipped');
      else if (input.status === 'delivered') query = query.eq('expedition_status', 'delivered');
      if (input.date_from) query = query.gte('created_at', input.date_from);
      if (input.date_to) query = query.lte('created_at', input.date_to + 'T23:59:59');

      const { data, error } = await query;
      if (error) return { error: error.message };
      return { envios: data, total: data?.length || 0 };
    }

    case 'send_whatsapp_now': {
      try {
        const creds = await resolveZApiCredentials(settings?.whatsapp_number_id);
        const phone = normalizePhone(input.phone);

        const res = await fetch(`https://api.z-api.io/instances/${creds.instanceId}/token/${creds.token}/send-text`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Client-Token': creds.clientToken },
          body: JSON.stringify({ phone, message: input.message }),
        });

        if (!res.ok) {
          const errText = await res.text();
          return { error: `Erro ao enviar WhatsApp: ${errText}` };
        }
        return { success: true, phone: input.phone };
      } catch (e) {
        return { error: `Erro ao enviar: ${e.message}` };
      }
    }

    default:
      return { error: `Tool desconhecida: ${toolName}` };
  }
}
