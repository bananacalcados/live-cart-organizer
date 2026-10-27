// Desativada: transferências agora passam pelo motor atômico pos-stock-transfer-v2.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  return new Response(JSON.stringify({ success: false, error: 'Rotina desativada: use pos-stock-transfer-v2' }), {
    status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
