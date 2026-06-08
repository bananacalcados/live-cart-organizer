// Envia um template Meta WhatsApp (Cloud API) para um número.
// Parâmetros vêm já resolvidos pelo caller (ex.: livete-start-order).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SendTemplateRequest {
  phone: string;                   // E.164 sem '+' (ex.: 553399999999)
  whatsappNumberId?: string;       // id em whatsapp_numbers
  templateName: string;
  language?: string;               // ex.: pt_BR
  bodyParameters?: string[];       // valores ordenados de {{1}}..{{N}}
  headerParameter?: string;        // valor para {{1}} do header (text-only nesta v1)
}

function sanitizeParam(v: string): string {
  // WhatsApp template params: sem \n, \t, e sem 4+ espaços
  return String(v ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{4,}/g, '   ')
    .slice(0, 1024);
}

async function getCredentials(supabase: any, whatsappNumberId?: string) {
  if (whatsappNumberId) {
    const { data } = await supabase
      .from('whatsapp_numbers')
      .select('phone_number_id, access_token')
      .eq('id', whatsappNumberId)
      .eq('is_active', true)
      .maybeSingle();
    if (data) return { phoneNumberId: data.phone_number_id, accessToken: data.access_token };
    // Explicit instance requested but inactive/not found → fail instead of using default.
    throw new Error(`Instância ${whatsappNumberId} não encontrada ou inativa — envio cancelado para evitar número errado.`);
  }

  const { data } = await supabase
    .from('whatsapp_numbers')
    .select('phone_number_id, access_token')
    .eq('is_default', true)
    .eq('is_active', true)
    .maybeSingle();
  if (data) return { phoneNumberId: data.phone_number_id, accessToken: data.access_token };
  return {
    phoneNumberId: Deno.env.get('META_WHATSAPP_PHONE_NUMBER_ID') || '',
    accessToken: Deno.env.get('META_WHATSAPP_ACCESS_TOKEN') || '',
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = (await req.json()) as SendTemplateRequest;
    const { phone, whatsappNumberId, templateName, language = 'pt_BR', bodyParameters = [], headerParameter } = body;

    if (!phone || !templateName) {
      return new Response(JSON.stringify({ error: 'phone and templateName are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { phoneNumberId, accessToken } = await getCredentials(supabase, whatsappNumberId);
    if (!phoneNumberId || !accessToken) {
      return new Response(JSON.stringify({ error: 'Meta credentials missing' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const components: any[] = [];
    if (headerParameter) {
      components.push({
        type: 'header',
        parameters: [{ type: 'text', text: sanitizeParam(headerParameter) }],
      });
    }
    if (bodyParameters.length > 0) {
      components.push({
        type: 'body',
        parameters: bodyParameters.map((v) => ({ type: 'text', text: sanitizeParam(v) })),
      });
    }

    const payload = {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'template',
      template: {
        name: templateName,
        language: { code: language },
        ...(components.length > 0 ? { components } : {}),
      },
    };

    console.log('[meta-template-send] payload:', JSON.stringify(payload));

    const resp = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();
    if (!resp.ok) {
      console.error('[meta-template-send] Meta error:', data);
      return new Response(JSON.stringify({ error: 'Meta API error', details: data }), {
        status: resp.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const messageId = data?.messages?.[0]?.id;

    // Log outgoing message — message text = template name + params (para histórico)
    const logText = `[template:${templateName}] ${bodyParameters.join(' | ')}`.slice(0, 2000);
    await supabase.from('whatsapp_messages').insert({
      phone,
      message: logText,
      direction: 'outgoing',
      status: 'sent',
      whatsapp_number_id: whatsappNumberId || null,
      message_id: messageId || null,
    });

    return new Response(JSON.stringify({ success: true, messageId, templateName }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[meta-template-send] error:', e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
