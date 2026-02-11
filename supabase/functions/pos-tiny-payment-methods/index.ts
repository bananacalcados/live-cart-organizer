import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { store_id } = await req.json();
    if (!store_id) throw new Error('store_id is required');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: store } = await supabase
      .from('pos_stores')
      .select('tiny_token')
      .eq('id', store_id)
      .single();

    if (!store?.tiny_token) throw new Error('Store token not configured');

    const resp = await fetch('https://api.tiny.com.br/api2/formas.recebimento.pesquisa.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${store.tiny_token}&formato=json`,
    });

    const data = await resp.json();
    console.log('Tiny payment methods full response:', JSON.stringify(data.retorno));

    const rawMethods = data.retorno?.formas_recebimento || data.retorno?.formasPagamento || data.retorno?.formasRecebimento || [];
    const methods = rawMethods.map((item: any, idx: number) => {
      const inner = item.forma_recebimento || item.formaRecebimento || item.formaPagamento || item;
      const name = inner.descricao || inner.nome || item.descricao || item.nome || 'Sem nome';
      const id = String(inner.id || item.id || name.toLowerCase().replace(/\s+/g, '_'));
      return { id, name };
    });

    return new Response(JSON.stringify({ success: true, methods }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message, methods: [] }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
