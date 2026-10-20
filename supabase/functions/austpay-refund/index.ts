// DESATIVADA (Fase E1): estorno solto na Rinne furava as travas (permissão
// "estornos", registro em gateway_refunds, aprovação). A Rinne entra no fluxo
// unificado de estornos (mp-refund) numa fase futura.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return new Response(JSON.stringify({ error: "Use o fluxo de estornos do sistema" }), {
    status: 410,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
