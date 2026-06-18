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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    console.log('Recalculating RFM scores (legacy zoppy_customers)...');
    const { data, error } = await supabase.rpc('calculate_rfm_scores');
    if (error) {
      console.error('RFM (zoppy) calculation error:', error);
      throw error;
    }

    // New source of truth: customers_unified
    console.log('Recalculating RFM scores (customers_unified)...');
    const { data: unified, error: unifiedError } = await supabase.rpc('calculate_rfm_scores_unified');
    if (unifiedError) {
      console.error('RFM (unified) calculation error:', unifiedError);
      throw unifiedError;
    }

    return new Response(JSON.stringify({
      success: true,
      count: unified?.updated || 0,
      segments: unified?.segments || {},
      legacy: { count: data?.updated || 0, segments: data?.segments || {} },
      message: `RFM recalculado: ${unified?.updated || 0} clientes (matriz unificada), ${data?.updated || 0} (legado)`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
