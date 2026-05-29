import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveZApiCredentials } from "../_shared/zapi-credentials.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { phones, whatsapp_number_id } = await req.json();
    if (!phones || !Array.isArray(phones) || phones.length === 0) {
      return new Response(JSON.stringify({ error: 'phones array required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Profile pictures are non-critical: when no instance is provided and the
    // route is ambiguous (multiple active Z-API numbers), just fall back to the
    // first active Z-API number instead of failing the whole request.
    let resolvedNumberId = whatsapp_number_id ?? null;
    if (!resolvedNumberId) {
      const { data: firstActive } = await supabase
        .from('whatsapp_numbers')
        .select('id')
        .eq('provider', 'zapi')
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      resolvedNumberId = (firstActive as any)?.id ?? null;
    }

    let creds: { instanceId: string; token: string; clientToken: string };
    try {
      creds = await resolveZApiCredentials(resolvedNumberId);
    } catch (e) {
      console.warn('zapi-profile-picture: could not resolve credentials, skipping', e);
      return new Response(JSON.stringify({ success: true, photos: {} }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { instanceId, token, clientToken } = creds;

    const results: Record<string, string> = {};
    const batch = phones.slice(0, 20);
    
    for (const phone of batch) {
      try {
        const cleanPhone = phone.replace(/\D/g, '');
        const url = `https://api.z-api.io/instances/${instanceId}/token/${token}/profile-picture?phone=${cleanPhone}`;
        
        const headers: Record<string, string> = {};
        if (clientToken) headers['Client-Token'] = clientToken;

        const resp = await fetch(url, { headers });
        
        if (resp.ok) {
          const data = await resp.json();
          console.log(`Profile pic response for ${phone}:`, JSON.stringify(data));
          const rawLink = Array.isArray(data) ? data[0]?.link : (data?.link || data?.profilePictureUrl || data?.url || null);
          const picUrl = (rawLink && rawLink !== 'null' && rawLink !== null) ? rawLink : null;
          
          if (picUrl) {
            results[phone] = picUrl;
            await supabase
              .from('chat_contacts')
              .upsert(
                { phone, profile_pic_url: picUrl },
                { onConflict: 'phone', ignoreDuplicates: false }
              );
          }
        }
        
        await new Promise(r => setTimeout(r, 300));
      } catch (e) {
        console.error(`Error fetching pic for ${phone}:`, e);
      }
    }

    return new Response(JSON.stringify({ success: true, photos: results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
