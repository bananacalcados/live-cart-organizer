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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    let whatsappNumberId = url.searchParams.get('whatsappNumberId');

    // Also check request body for whatsappNumberId (used by supabase.functions.invoke)
    if (!whatsappNumberId && req.method === 'POST') {
      try {
        const body = await req.json();
        whatsappNumberId = body.whatsappNumberId || null;
      } catch { /* no body */ }
    }

    // Get credentials
    let accessToken = '';
    let businessAccountId = '';

    if (whatsappNumberId) {
      const { data } = await supabase
        .from('whatsapp_numbers')
        .select('access_token, business_account_id')
        .eq('id', whatsappNumberId)
        .eq('is_active', true)
        .maybeSingle();
      if (data) {
        accessToken = data.access_token;
        businessAccountId = data.business_account_id;
      }
    }

    if (!accessToken || !businessAccountId) {
      // Fallback to default
      const { data } = await supabase
        .from('whatsapp_numbers')
        .select('access_token, business_account_id')
        .eq('is_default', true)
        .eq('is_active', true)
        .maybeSingle();
      if (data) {
        accessToken = data.access_token;
        businessAccountId = data.business_account_id;
      }
    }

    if (!accessToken || !businessAccountId) {
      return new Response(
        JSON.stringify({ error: 'WhatsApp credentials not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch templates from Meta Graph API
    const statusFilter = url.searchParams.get('status') || '';
    let nextUrl: string | null = statusFilter
      ? `https://graph.facebook.com/v21.0/${businessAccountId}/message_templates?status=${statusFilter}&limit=200`
      : `https://graph.facebook.com/v21.0/${businessAccountId}/message_templates?limit=200`;

    // Meta paginates message templates. Follow paging.next until exhausted so
    // ALL templates of the account are returned (not just the first page).
    const templates: Record<string, unknown>[] = [];
    let lastError: unknown = null;
    let lastStatus = 200;
    let pages = 0;
    while (nextUrl && pages < 25) {
      pages++;
      const response = await fetch(nextUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });
      const data = await response.json();
      if (!response.ok) {
        console.error('Meta API error fetching templates:', data);
        lastError = data;
        lastStatus = response.status;
        break;
      }
      if (Array.isArray(data.data)) templates.push(...data.data);
      nextUrl = data?.paging?.next || null;
    }

    if (templates.length === 0 && lastError) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch templates', details: lastError }),
        { status: lastStatus, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }



    // Enrich with rejected_reason: prefer Meta's own field, fallback to the webhook status log.
    let logMap: Record<string, string> = {};
    try {
      const { data: logs } = await supabase
        .from('meta_template_status_log')
        .select('template_id, rejected_reason');
      if (logs) {
        logMap = Object.fromEntries(
          logs
            .filter((l: { rejected_reason?: string }) => l.rejected_reason)
            .map((l: { template_id: string; rejected_reason: string }) => [l.template_id, l.rejected_reason]),
        );
      }
    } catch (e) {
      console.error('Error loading template status log:', (e as Error).message);
    }

    const enriched = templates.map((t: Record<string, unknown>) => ({
      ...t,
      rejected_reason:
        (t.rejected_reason as string | undefined) || logMap[String(t.id)] || null,
    }));

    return new Response(
      JSON.stringify({ success: true, templates: enriched }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error fetching templates:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
