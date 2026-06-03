import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { phone, code } = await req.json();
    const cleanPhone = String(phone || '').replace(/\D/g, '');
    const cleanCode = String(code || '').replace(/\D/g, '');
    if (!cleanPhone || cleanCode.length < 4) {
      return new Response(JSON.stringify({ success: false, error: 'Dados inválidos' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data, error } = await supabase
      .from('live_phone_verifications')
      .select('id, code, expires_at')
      .eq('phone', cleanPhone)
      .eq('verified', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return new Response(JSON.stringify({ success: false, error: 'Código não encontrado. Solicite um novo.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (new Date(data.expires_at) < new Date()) {
      return new Response(JSON.stringify({ success: false, error: 'Código expirado. Solicite um novo.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (data.code !== cleanCode) {
      return new Response(JSON.stringify({ success: false, error: 'Código incorreto. Tente novamente.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    await supabase.from('live_phone_verifications').update({ verified: true }).eq('id', data.id);

    return new Response(JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
