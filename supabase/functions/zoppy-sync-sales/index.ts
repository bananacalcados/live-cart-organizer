import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const ZOPPY_BASE_URL = "https://api-partners.zoppy.com.br";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const zoppyToken = Deno.env.get('ZOPPY_API_TOKEN');
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!zoppyToken) {
      return new Response(
        JSON.stringify({ error: 'ZOPPY_API_TOKEN not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const startPage = body.start_page || 1;
    const maxPages = body.max_pages || 50;
    // For historical sync, use a very old after date
    const afterDate = body.after_date || '2022-01-01T00:00:00.000Z';

    let page = startPage;
    let totalSynced = 0;
    let hasMore = true;
    let pagesProcessed = 0;

    console.log(`Syncing sales from page ${startPage}, after ${afterDate}, max ${maxPages} pages...`);

    while (hasMore && pagesProcessed < maxPages) {
      // Try with after param first, fallback without it
      const afterParam = afterDate ? `&after=${afterDate}` : '';
      const url = `${ZOPPY_BASE_URL}/orders?page=${page}&limit=100${afterParam}`;

      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${zoppyToken}`, 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        const text = await res.text();
        console.error(`Zoppy API error: ${res.status} ${text}`);
        if (totalSynced > 0) {
          return new Response(
            JSON.stringify({
              success: true, partial: true, count: totalSynced, next_page: page,
              message: `${totalSynced} vendas sincronizadas (erro na página ${page})`
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        throw new Error(`Zoppy API error: ${res.status} - ${text}`);
      }

      const data = await res.json();
      const orders = Array.isArray(data) ? data : (data.data || data.results || []);

      if (orders.length === 0) {
        hasMore = false;
        break;
      }

      const batch = orders.map((o: any) => {
        const customer = o.customer || {};
        return {
          zoppy_order_id: o.id,
          external_id: o.externalId || null,
          status: o.status || 'unknown',
          total: o.total || 0,
          subtotal: o.subtotal || null,
          discount: o.discount || null,
          shipping: o.shipping || null,
          coupon_code: o.couponCode || null,
          customer_name: customer.firstName ? `${customer.firstName} ${customer.lastName || ''}`.trim() : (o.customerName || null),
          customer_email: customer.email || o.customerEmail || null,
          customer_phone: customer.phone || o.customerPhone || null,
          customer_data: customer.id ? customer : null,
          line_items: o.lineItems || o.items || null,
          completed_at: o.completedAt || null,
          zoppy_created_at: o.createdAt || null,
          zoppy_updated_at: o.updatedAt || null,
        };
      });

      const { error } = await supabase
        .from('zoppy_sales')
        .upsert(batch, { onConflict: 'zoppy_order_id' });

      if (error) {
        console.error('Upsert error:', error);
        throw error;
      }

      totalSynced += batch.length;
      page++;
      pagesProcessed++;

      if (orders.length < 100) hasMore = false;
    }

    const completed = !hasMore;
    console.log(`Sales sync done: ${totalSynced} orders, completed: ${completed}`);

    return new Response(
      JSON.stringify({
        success: true,
        completed,
        count: totalSynced,
        next_page: completed ? null : page,
        message: completed
          ? `✅ ${totalSynced} vendas sincronizadas!`
          : `⏳ ${totalSynced} vendas sincronizadas. Próxima página: ${page}. Execute novamente para continuar.`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
