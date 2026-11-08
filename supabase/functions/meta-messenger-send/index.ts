import { withAccessLog } from "../_shared/withAccessLog.ts";
import { requireStaffOrInternal } from "../_shared/staff-or-internal.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveIgAccountByNumberId, globalIgToken, preferredIgToken } from "../_shared/instagram-account.ts";
import { internalCallHeaders } from '../_shared/requireAuth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-force-instance, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};


interface SendMessengerRequest {
  recipientId: string;
  message?: string;
  channel?: 'messenger' | 'instagram';
  type?: 'text' | 'image' | 'video' | 'audio' | 'file';
  mediaUrl?: string;
  whatsapp_number_id?: string;
}

serve(withAccessLog("meta-messenger-send", async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
// Fase 4 auth: funcionário com módulo ou chamada interna (service_role + x-internal-call).
{ const denied = await requireStaffOrInternal(req, ["chat","pos","events","marketing","expedition"], false); if (denied) return denied; }

  try {
    const { recipientId, message, channel = 'instagram', type = 'text', mediaUrl, whatsapp_number_id }: SendMessengerRequest = await req.json();

    if (!recipientId) {
      return new Response(
        JSON.stringify({ error: 'recipientId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    // All Instagram callers share the same genuine-DM/private-reply validation.
    if(channel==='instagram') {
      const sb=createClient(Deno.env.get('SUPABASE_URL') || '',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '');
      const {data:link,error}=await sb.from('instagram_user_links').select('username').eq('ig_user_id',recipientId).limit(1).maybeSingle();
      if(error)throw error;
      if(!link?.username)return new Response(JSON.stringify({success:false,error:'Perfil não identificado. Aguarde ela mandar mensagem.'}),{headers:{...corsHeaders,'Content-Type':'application/json'}});
      const r=await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/instagram-dm-send`,{method:'POST',headers:{...(await internalCallHeaders()),authorization:req.headers.get('authorization') || '', 'Content-Type':'application/json'},body:JSON.stringify({username:link.username,message,mediaUrl,mediaType:type==='text'?undefined:type,whatsapp_number_id,manual:true})});
      const data=await r.json();
      return new Response(JSON.stringify({...data,success:r.ok&&!data.error,error:data.error?(data.message || data.error):undefined}),{status:r.status,headers:{...corsHeaders,'Content-Type':'application/json'}});
    }

    // Token por conta: quando a conversa está vinculada a uma instância de
    // Instagram (whatsapp_number_id), usamos o token daquela conta específica.
    // Fallback: token de uma conta de IG ativa; o secret global é último recurso.
    let pageAccessToken = "";
    if (channel === 'instagram' && whatsapp_number_id) {
      try {
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        );
        const acct = await resolveIgAccountByNumberId(supabase, whatsapp_number_id);
        if (acct.accessToken) pageAccessToken = acct.accessToken;
      } catch (e) {
        console.error('Error resolving IG account token:', e);
      }
    }
    if (!pageAccessToken && channel === 'instagram') {
      try {
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        );
        pageAccessToken = await preferredIgToken(supabase);
      } catch { /* ignora */ }
    }
    if (!pageAccessToken) pageAccessToken = globalIgToken();

    if (!pageAccessToken) {
      return new Response(
        JSON.stringify({ error: 'META_PAGE_ACCESS_TOKEN not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Sending ${channel} message to ${recipientId}, type=${type}`);

    // Build message payload
    let messagePayload: Record<string, unknown>;

    if (type === 'text') {
      messagePayload = { text: message || '' };
    } else if (mediaUrl) {
      const attachmentType = type === 'file' ? 'file' : type;
      messagePayload = {
        attachment: {
          type: attachmentType,
          payload: { url: mediaUrl, is_reusable: true },
        },
      };
    } else {
      return new Response(
        JSON.stringify({ error: 'Message or mediaUrl required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Instagram uses graph.instagram.com; Messenger uses graph.facebook.com
    const apiUrl = channel === 'instagram'
      ? `https://graph.instagram.com/v21.0/me/messages`
      : `https://graph.facebook.com/v21.0/me/messages`;

    console.log(`API URL: ${apiUrl}`);

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${pageAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: messagePayload,
        messaging_type: 'RESPONSE',
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('Messenger send error:', data);
      const code = data?.error?.code;
      const friendly = code === 190
        ? 'Acesso do Instagram vencido. Renove o token em Admin > Contas do Instagram.'
        : (data?.error?.message || 'Failed to send');
      return new Response(
        JSON.stringify({ error: friendly, code, details: data }),
        { status: res.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Message sent successfully to ${recipientId}:`, data.message_id);

    return new Response(
      JSON.stringify({ success: true, messageId: data.message_id, data }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error sending messenger message:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}));
