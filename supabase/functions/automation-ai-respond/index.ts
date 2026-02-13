import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { prompt, messages, mode = 'chat', phone, historyLimit = 30 } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const systemPrompt = prompt || 'Você é um assistente da Banana Calçados. Responda de forma simpática, curta e objetiva em português brasileiro.';

    // Build conversation history from DB if phone is provided
    let chatMessages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    if (phone) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      // Normalize phone for query
      let normalizedPhone = phone.replace(/\D/g, '');
      if (!normalizedPhone.startsWith('55') && normalizedPhone.length <= 11) {
        normalizedPhone = '55' + normalizedPhone;
      }

      // Fetch recent messages for this conversation
      const { data: dbMessages } = await supabase
        .from('whatsapp_messages')
        .select('message, direction, created_at, media_type')
        .eq('phone', normalizedPhone)
        .order('created_at', { ascending: true })
        .limit(historyLimit);

      if (dbMessages && dbMessages.length > 0) {
        for (const msg of dbMessages) {
          // Skip media-only messages without text
          const text = msg.message?.trim();
          if (!text) continue;

          // Skip template messages (contain unresolved {{variables}})
          if (/\{\{\d+\}\}/.test(text) || /\{\{[a-zA-Z_]+\}\}/.test(text)) continue;

          chatMessages.push({
            role: msg.direction === 'incoming' ? 'user' : 'assistant',
            content: text,
          });
        }
      }
    }

    // Append any extra messages passed directly (fallback / override)
    if (messages && messages.length > 0) {
      chatMessages.push(...messages);
    }

    console.log(`AI responding for phone=${phone || 'N/A'}, history=${chatMessages.length - 1} msgs`);

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: chatMessages,
        stream: false,
      }),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit excedido. Tente novamente em alguns segundos.' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: 'Créditos insuficientes. Adicione créditos no workspace.' }), {
          status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const errorText = await response.text();
      console.error('AI gateway error:', status, errorText);
      return new Response(JSON.stringify({ error: 'Erro no serviço de IA' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || '';

    return new Response(JSON.stringify({ success: true, reply }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('AI automation error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
