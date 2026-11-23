import { withAccessLog } from "../_shared/withAccessLog.ts";
import { requireStaffOrInternal } from "../_shared/staff-or-internal.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/**
 * DESATIVADA (23/11/2026): a loja Site/Live fica sempre com saldo zero e a venda
 * online/live baixa direto da Loja Pérola no banco. Esta função não fala mais com
 * o Tiny e não lê/grava estoque; responde sucesso sem fazer nada.
 */
Deno.serve(withAccessLog("expedition-transfer-stock", async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  { const denied = await requireStaffOrInternal(req, ["expedition","pos"], false); if (denied) return denied; }
  return new Response(
    JSON.stringify({ success: true, skipped: 'transferência desativada: venda online baixa direto da Loja Pérola' }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}));
