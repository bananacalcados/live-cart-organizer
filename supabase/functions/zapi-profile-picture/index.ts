import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { phones } = await req.json();
    if (!phones || !Array.isArray(phones) || phones.length === 0) {
      return new Response(JSON.stringify({ error: 'phones array required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const instanceId = Deno.env.get('ZAPI_INSTANCE_ID');
    const token = Deno.env.get('ZAPI_TOKEN');
    const clientToken = Deno.env.get('ZAPI_CLIENT_TOKEN');

    if (!instanceId || !token) {
      return new Response(JSON.stringify({ error: 'Z-API not configured' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const results: Record<string, string> = {};
    
    // Process up to 20 phones per call to avoid timeout
    const batch = phones.slice(0, 20);
    
    for (const phone of batch) {
      try {
        const cleanPhone = phone.replace(/\D/g, '');
        const url = `https://api.z-api.io/instances/${instanceId}/token/${token}/profile-picture/${cleanPhone}`;
        
        const headers: Record<string, string> = {};
        if (clientToken) headers['Client-Token'] = clientToken;

        const resp = await fetch(url, { headers });
        
        if (resp.ok) {
          const data = await resp.json();
          const picUrl = data?.link || data?.profilePictureUrl || data?.url || null;
          
          if (picUrl) {
            results[phone] = picUrl;
            
            // Save to chat_contacts
            await supabase
              .from('chat_contacts')
              .upsert(
                { phone, profile_pic_url: picUrl },
                { onConflict: 'phone', ignoreDuplicates: false }
              );
          }
        }
        
        // Rate limit
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
