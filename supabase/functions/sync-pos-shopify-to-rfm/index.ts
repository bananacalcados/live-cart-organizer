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

    const body = await req.json().catch(() => ({}));
    const mode = body.mode || 'all'; // 'pos', 'shopify', 'all'

    let posCount = 0;
    let shopifyCount = 0;
    let cancelledCount = 0;

    // ── 1. Sync POS completed sales ──
    if (mode === 'pos' || mode === 'all') {
      // Get all completed POS sales with customer data
      let allSales: any[] = [];
      let salesFrom = 0;
      const salesBatch = 1000;
      while (true) {
        const { data, error: salesErr } = await supabase
          .from('pos_sales')
          .select('id, customer_id, total, created_at, status, store_id')
          .in('status', ['completed', 'paid'])
          .range(salesFrom, salesFrom + salesBatch - 1);
        if (salesErr) throw salesErr;
        if (!data || data.length === 0) break;
        allSales = allSales.concat(data);
        if (data.length < salesBatch) break;
        salesFrom += salesBatch;
      }
      const sales = allSales;
      console.log(`POS: fetched ${sales.length} sales`);

      if (sales && sales.length > 0) {
        // Get unique customer IDs
        const customerIds = [...new Set(sales.filter(s => s.customer_id).map(s => s.customer_id))];
        console.log(`POS: ${customerIds.length} unique customers from sales`);

        // Fetch customer details in batches (avoid URL length limit with .in())
        let allCustomers: any[] = [];
        for (let ci = 0; ci < customerIds.length; ci += 50) {
          const idChunk = customerIds.slice(ci, ci + 50);
          const { data: custChunk } = await supabase
            .from('pos_customers')
            .select('id, name, email, whatsapp, city, state, gender, cpf, shoe_size, preferred_style, age_range')
            .in('id', idChunk);
          if (custChunk) allCustomers = allCustomers.concat(custChunk);
        }
        console.log(`POS: fetched ${allCustomers.length} customer records`);

        const customerMap = new Map(allCustomers.map(c => [c.id, c]));

        // Aggregate sales per customer
        const customerSales = new Map<string, { total: number; count: number; first: string; last: string; storeId: string | null }>();
        for (const sale of sales) {
          if (!sale.customer_id) continue;
          const existing = customerSales.get(sale.customer_id);
          if (existing) {
            existing.total += Number(sale.total || 0);
            existing.count += 1;
            if (sale.created_at < existing.first) existing.first = sale.created_at;
            if (sale.created_at > existing.last) { existing.last = sale.created_at; existing.storeId = sale.store_id || existing.storeId; }
          } else {
            customerSales.set(sale.customer_id, {
              total: Number(sale.total || 0),
              count: 1,
              first: sale.created_at,
              last: sale.created_at,
              storeId: sale.store_id || null,
            });
          }
        }

        // Upsert into zoppy_customers
        const batch: any[] = [];
        for (const [custId, stats] of customerSales) {
          const cust = customerMap.get(custId);
          if (!cust) continue;

          const phone = (cust.whatsapp || '').replace(/\D/g, '');
          if (!phone && !cust.email) continue;

          const nameParts = (cust.name || '').split(' ');
          const firstName = nameParts[0] || '';
          const lastName = nameParts.slice(1).join(' ') || '';
          const ddd = phone.length >= 10 ? phone.slice(phone.startsWith('55') ? 2 : 0, phone.startsWith('55') ? 4 : 2) : null;

          batch.push({
            zoppy_id: `pos-${custId}`,
            external_id: custId,
            first_name: firstName,
            last_name: lastName,
            phone: phone || null,
            email: cust.email || null,
            city: cust.city || null,
            state: cust.state || null,
            gender: cust.gender || null,
            region_type: 'local',
            ddd,
            total_orders: stats.count,
            total_spent: stats.total,
            avg_ticket: stats.count > 0 ? stats.total / stats.count : 0,
            first_purchase_at: stats.first,
            last_purchase_at: stats.last,
          });
        }

        // Upsert in chunks
        for (let i = 0; i < batch.length; i += 100) {
          const chunk = batch.slice(i, i + 100);
          const { error } = await supabase
            .from('zoppy_customers')
            .upsert(chunk, { onConflict: 'zoppy_id' });
          if (error) {
            console.error('POS upsert error:', error);
          } else {
            posCount += chunk.length;
          }
        }
      }
      console.log(`POS sync: ${posCount} customers upserted`);
    }

    // ── 2. Sync Shopify orders (from zoppy_sales) ──
    if (mode === 'shopify' || mode === 'all') {
      // zoppy_sales contains Shopify orders synced via Zoppy
      const { data: zoppySales, error: zsErr } = await supabase
        .from('zoppy_sales')
        .select('zoppy_order_id, external_id, status, total, customer_name, customer_email, customer_phone, customer_data, completed_at, zoppy_created_at');

      if (zsErr) throw zsErr;

      if (zoppySales && zoppySales.length > 0) {
        // Handle cancelled orders: mark customers with reduced order counts
        const cancelledOrders = zoppySales.filter(s => 
          s.status === 'cancelled' || s.status === 'refunded'
        );
        cancelledCount = cancelledOrders.length;

        // Aggregate by customer phone/email
        const custAgg = new Map<string, { 
          name: string; email: string | null; phone: string | null;
          total: number; count: number; first: string; last: string; custData: any;
        }>();

        for (const sale of zoppySales) {
          if (sale.status === 'cancelled' || sale.status === 'refunded') continue;

          const phone = (sale.customer_phone || '').replace(/\D/g, '');
          const key = phone || sale.customer_email || sale.zoppy_order_id;
          if (!key) continue;

          const date = sale.completed_at || sale.zoppy_created_at || new Date().toISOString();
          const existing = custAgg.get(key);
          if (existing) {
            existing.total += Number(sale.total || 0);
            existing.count += 1;
            if (date < existing.first) existing.first = date;
            if (date > existing.last) existing.last = date;
          } else {
            custAgg.set(key, {
              name: sale.customer_name || '',
              email: sale.customer_email,
              phone: phone || null,
              total: Number(sale.total || 0),
              count: 1,
              first: date,
              last: date,
              custData: sale.customer_data,
            });
          }
        }

        const batch: any[] = [];
        for (const [key, stats] of custAgg) {
          const phone = stats.phone || '';
          const nameParts = (stats.name || '').split(' ');
          const ddd = phone.length >= 10 ? phone.slice(phone.startsWith('55') ? 2 : 0, phone.startsWith('55') ? 4 : 2) : null;
          const isLocal = ddd === '33';

          batch.push({
            zoppy_id: `shopify-${key}`,
            first_name: nameParts[0] || '',
            last_name: nameParts.slice(1).join(' ') || '',
            phone: phone || null,
            email: stats.email || null,
            city: stats.custData?.city || null,
            state: stats.custData?.state || null,
            region_type: isLocal ? 'local' : 'online',
            ddd,
            total_orders: stats.count,
            total_spent: stats.total,
            avg_ticket: stats.count > 0 ? stats.total / stats.count : 0,
            first_purchase_at: stats.first,
            last_purchase_at: stats.last,
          });
        }

        for (let i = 0; i < batch.length; i += 100) {
          const chunk = batch.slice(i, i + 100);
          const { error } = await supabase
            .from('zoppy_customers')
            .upsert(chunk, { onConflict: 'zoppy_id' });
          if (error) {
            console.error('Shopify upsert error:', error);
          } else {
            shopifyCount += chunk.length;
          }
        }
      }
      console.log(`Shopify sync: ${shopifyCount} customers, ${cancelledCount} cancelled orders excluded`);
    }

    // ── 3. Recalculate RFM ──
    if (body.recalculate_rfm !== false) {
      try {
        const rfmRes = await fetch(`${supabaseUrl}/functions/v1/zoppy-sync-customers`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ mode: 'calculate_rfm' }),
        });
        const rfmData = await rfmRes.json();
        console.log('RFM recalculated:', rfmData.message || rfmData);
      } catch (rfmErr) {
        console.warn('RFM recalc failed:', rfmErr);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        pos_customers_synced: posCount,
        shopify_customers_synced: shopifyCount,
        cancelled_orders_excluded: cancelledCount,
        message: `✅ POS: ${posCount} clientes, Shopify: ${shopifyCount} clientes sincronizados ao RFM`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Sync error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
