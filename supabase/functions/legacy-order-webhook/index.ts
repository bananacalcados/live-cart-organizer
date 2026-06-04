import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALLOWED_WEBHOOK_HOSTS = new Set([
  'api.bananacalcados.com.br',
]);

async function requireStaffUser(req: Request) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return { ok: false as const, status: 401, error: 'Unauthorized' };

  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const token = authHeader.replace('Bearer ', '');
  const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token);
  const userId = claimsData?.claims?.sub;
  if (claimsError || !userId) return { ok: false as const, status: 401, error: 'Unauthorized' };

  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  const { data: isAdmin, error: roleError } = await serviceClient.rpc('has_role', { _user_id: userId, _role: 'admin' });
  if (roleError || !isAdmin) return { ok: false as const, status: 403, error: 'Forbidden' };

  return { ok: true as const, serviceClient };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const auth = await requireStaffUser(req);
    if (!auth.ok) {
      return new Response(JSON.stringify({ error: auth.error }), {
        status: auth.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = auth.serviceClient;

    const { payload, whatsapp_number_id, webhook_url } = await req.json();
    if (!payload || typeof payload !== 'object') {
      return new Response(JSON.stringify({ error: 'payload required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const url = new URL(webhook_url || 'https://api.bananacalcados.com.br/webhook/novo-pedido');
    if (url.protocol !== 'https:' || !ALLOWED_WEBHOOK_HOSTS.has(url.hostname)) {
      return new Response(JSON.stringify({ error: 'webhook_url not allowed' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let whatsapp = { reference_id: whatsapp_number_id || null };
    if (whatsapp_number_id) {
      const { data: num } = await supabase
        .from('whatsapp_numbers')
        .select('id')
        .eq('id', whatsapp_number_id)
        .maybeSingle();
      if (num) {
        whatsapp = { reference_id: (num as any).id || whatsapp_number_id };
      }
    }

    const resp = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, whatsapp }),
    });
    const body = await resp.text();

    return new Response(JSON.stringify({ ok: resp.ok, status: resp.status, body }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
