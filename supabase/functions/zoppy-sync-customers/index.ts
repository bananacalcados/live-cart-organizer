import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const ZOPPY_BASE_URL = "https://api-partners.zoppy.com.br";
const LOCAL_DDD = "33"; // Governador Valadares, MG

// RFM Segment mapping based on R, F, M scores (1-5 each)
function getRfmSegment(r: number, f: number, m: number): string {
  const score = r * 100 + f * 10 + m;
  
  // Champions: high R, high F, high M
  if (r >= 4 && f >= 4 && m >= 4) return "Campeões";
  // Loyal: high F
  if (f >= 4 && r >= 3) return "Leais";
  // Potential Loyalist: high R, medium F
  if (r >= 4 && f >= 2 && f <= 3) return "Potenciais Leais";
  // Recent: high R, low F
  if (r >= 4 && f <= 2) return "Novos Clientes";
  // Promising: medium R, low F
  if (r >= 3 && r <= 4 && f <= 2) return "Promissores";
  // Need Attention: medium all
  if (r >= 2 && r <= 3 && f >= 2 && f <= 3 && m >= 2 && m <= 3) return "Precisam Atenção";
  // About to Sleep: below medium R
  if (r === 2 && f <= 3) return "Quase Dormindo";
  // At Risk: low R, high F
  if (r <= 2 && f >= 3) return "Em Risco";
  // Can't Lose: low R, very high F and M
  if (r <= 2 && f >= 4 && m >= 4) return "Não Pode Perder";
  // Hibernating: low R, low F
  if (r <= 2 && f <= 2) return "Hibernando";
  // Lost: very low everything
  if (r === 1 && f === 1) return "Perdidos";
  
  return "Outros";
}

function classifyRegion(phone: string | null, address1: string | null, city: string | null, state: string | null): { regionType: string; ddd: string } {
  let ddd = "";
  if (phone) {
    // Extract DDD from phone (remove country code 55 if present)
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length >= 10) {
      ddd = cleaned.startsWith('55') ? cleaned.substring(2, 4) : cleaned.substring(0, 2);
    }
  }
  
  const hasAddress = !!(address1 && address1.trim() && address1.trim() !== ',' && city && city.trim());
  
  if (ddd === LOCAL_DDD && !hasAddress) {
    return { regionType: 'local', ddd };
  }
  if (hasAddress) {
    return { regionType: 'online', ddd };
  }
  if (ddd === LOCAL_DDD) {
    return { regionType: 'local', ddd };
  }
  
  return { regionType: 'unknown', ddd };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const zoppyToken = Deno.env.get('ZOPPY_API_TOKEN');
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const mode = body.mode || 'from_sales'; // 'from_sales' | 'from_api' | 'calculate_rfm'

    if (mode === 'calculate_rfm') {
      // Calculate RFM from zoppy_sales data
      console.log('Calculating RFM scores...');
      
      // Get aggregated purchase data per customer phone
      const { data: salesData, error: salesError } = await supabase
        .from('zoppy_sales')
        .select('customer_phone, customer_name, customer_email, total, zoppy_created_at, customer_data')
        .not('customer_phone', 'is', null)
        .order('zoppy_created_at', { ascending: false });

      if (salesError) throw salesError;

      // Aggregate by phone
      const customerMap = new Map<string, {
        phone: string;
        orders: number;
        totalSpent: number;
        lastPurchase: string;
        firstPurchase: string;
        name: string;
        email: string;
        customerData: any;
      }>();

      for (const sale of salesData || []) {
        const phone = sale.customer_phone;
        if (!phone) continue;
        
        const existing = customerMap.get(phone);
        if (existing) {
          existing.orders += 1;
          existing.totalSpent += (sale.total || 0);
          if (sale.zoppy_created_at > existing.lastPurchase) {
            existing.lastPurchase = sale.zoppy_created_at;
          }
          if (sale.zoppy_created_at < existing.firstPurchase) {
            existing.firstPurchase = sale.zoppy_created_at;
          }
        } else {
          customerMap.set(phone, {
            phone,
            orders: 1,
            totalSpent: sale.total || 0,
            lastPurchase: sale.zoppy_created_at || new Date().toISOString(),
            firstPurchase: sale.zoppy_created_at || new Date().toISOString(),
            name: sale.customer_name || '',
            email: sale.customer_email || '',
            customerData: sale.customer_data,
          });
        }
      }

      const customers = Array.from(customerMap.values());
      if (customers.length === 0) {
        return new Response(
          JSON.stringify({ success: true, message: 'No customers found', count: 0 }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Calculate quintiles for R, F, M
      const now = new Date();
      const recencies = customers.map(c => {
        const diff = (now.getTime() - new Date(c.lastPurchase).getTime()) / (1000 * 60 * 60 * 24);
        return diff;
      }).sort((a, b) => a - b);
      
      const frequencies = customers.map(c => c.orders).sort((a, b) => a - b);
      const monetaries = customers.map(c => c.totalSpent).sort((a, b) => a - b);

      function getQuintile(value: number, sortedValues: number[], inverse = false): number {
        const idx = sortedValues.findIndex(v => v >= value);
        const position = idx === -1 ? sortedValues.length : idx;
        const percentile = position / sortedValues.length;
        const score = Math.ceil(percentile * 5);
        const clamped = Math.max(1, Math.min(5, score));
        return inverse ? (6 - clamped) : clamped; // For recency, lower days = higher score
      }

      // Upsert customers with RFM scores
      const upsertBatch = [];
      for (const customer of customers) {
        const recencyDays = (now.getTime() - new Date(customer.lastPurchase).getTime()) / (1000 * 60 * 60 * 24);
        const rScore = getQuintile(recencyDays, recencies, true);
        const fScore = getQuintile(customer.orders, frequencies);
        const mScore = getQuintile(customer.totalSpent, monetaries);
        const totalScore = rScore + fScore + mScore;
        const segment = getRfmSegment(rScore, fScore, mScore);

        const cd = customer.customerData || {};
        const addr = cd.address || {};
        const { regionType, ddd } = classifyRegion(customer.phone, addr.address1, addr.city, addr.state);

        upsertBatch.push({
          zoppy_id: cd.id || `phone_${customer.phone}`,
          external_id: cd.externalId || null,
          first_name: cd.firstName || customer.name?.split(' ')[0] || null,
          last_name: cd.lastName || customer.name?.split(' ').slice(1).join(' ') || null,
          phone: customer.phone,
          email: customer.email || cd.email || null,
          gender: cd.gender || null,
          birth_date: cd.birthDate || null,
          address1: addr.address1 || null,
          address2: addr.address2 || null,
          city: addr.city || null,
          state: addr.state || null,
          postcode: addr.postcode || null,
          country: addr.country || null,
          zoppy_position: cd.position || null,
          rfm_recency_score: rScore,
          rfm_frequency_score: fScore,
          rfm_monetary_score: mScore,
          rfm_total_score: totalScore,
          rfm_segment: segment,
          rfm_calculated_at: now.toISOString(),
          region_type: regionType,
          ddd,
          total_orders: customer.orders,
          total_spent: customer.totalSpent,
          last_purchase_at: customer.lastPurchase,
          first_purchase_at: customer.firstPurchase,
          avg_ticket: customer.orders > 0 ? +(customer.totalSpent / customer.orders).toFixed(2) : 0,
          zoppy_created_at: cd.createdAt || null,
          zoppy_updated_at: cd.updatedAt || null,
        });
      }

      // Batch upsert in chunks of 100
      let upserted = 0;
      for (let i = 0; i < upsertBatch.length; i += 100) {
        const chunk = upsertBatch.slice(i, i + 100);
        const { error } = await supabase
          .from('zoppy_customers')
          .upsert(chunk, { onConflict: 'zoppy_id' });
        if (error) {
          console.error('Upsert error:', error);
          throw error;
        }
        upserted += chunk.length;
      }

      console.log(`RFM calculated for ${upserted} customers`);

      return new Response(
        JSON.stringify({ success: true, count: upserted, message: `RFM calculado para ${upserted} clientes` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (mode === 'from_api') {
      if (!zoppyToken) {
        return new Response(
          JSON.stringify({ error: 'ZOPPY_API_TOKEN not configured' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Support resumable sync: start from a given page
      const startPage = body.start_page || 1;
      const maxPages = body.max_pages || 50; // Process up to 50 pages per call (~5k customers)
      let page = startPage;
      let totalSynced = 0;
      let hasMore = true;
      let pagesProcessed = 0;

      console.log(`Starting sync from page ${startPage}, max ${maxPages} pages...`);

      while (hasMore && pagesProcessed < maxPages) {
        const url = `${ZOPPY_BASE_URL}/customers?page=${page}&limit=100&after=2020-01-01T00:00:00Z`;
        console.log(`Fetching customers page ${page}...`);
        
        const res = await fetch(url, {
          headers: { 'Authorization': `Bearer ${zoppyToken}`, 'Content-Type': 'application/json' },
        });

        if (!res.ok) {
          const text = await res.text();
          console.error(`Zoppy API error: ${res.status} ${text}`);
          // If we already synced some, return partial success with resume info
          if (totalSynced > 0) {
            return new Response(
              JSON.stringify({ 
                success: true, 
                partial: true,
                count: totalSynced, 
                next_page: page,
                message: `${totalSynced} clientes sincronizados (erro na página ${page}, reenvie para continuar)` 
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          throw new Error(`Zoppy API error: ${res.status}`);
        }

        const data = await res.json();
        const customers = Array.isArray(data) ? data : (data.data || data.results || []);

        if (customers.length === 0) {
          hasMore = false;
          break;
        }

        const batch = customers.map((c: any) => {
          const addr = c.address || {};
          const { regionType, ddd } = classifyRegion(c.phone, addr.address1, addr.city, addr.state);
          
          return {
            zoppy_id: c.id,
            external_id: c.externalId || null,
            first_name: c.firstName || null,
            last_name: c.lastName || null,
            phone: c.phone || null,
            email: c.email || null,
            gender: c.gender || null,
            birth_date: c.birthDate || null,
            address1: addr.address1 || null,
            address2: addr.address2 || null,
            city: addr.city || null,
            state: addr.state || null,
            postcode: addr.postcode || null,
            country: addr.country || null,
            zoppy_position: c.position || null,
            region_type: regionType,
            ddd,
            zoppy_created_at: c.createdAt || null,
            zoppy_updated_at: c.updatedAt || null,
          };
        });

        const { error } = await supabase
          .from('zoppy_customers')
          .upsert(batch, { onConflict: 'zoppy_id' });

        if (error) {
          console.error('Upsert error:', error);
          throw error;
        }

        totalSynced += batch.length;
        page++;
        pagesProcessed++;

        if (customers.length < 100) hasMore = false;
      }

      const completed = !hasMore;
      console.log(`Sync batch done: ${totalSynced} customers, completed: ${completed}, next page: ${page}`);

      return new Response(
        JSON.stringify({ 
          success: true, 
          completed,
          count: totalSynced, 
          next_page: completed ? null : page,
          message: completed 
            ? `✅ Sincronização completa! ${totalSynced} clientes sincronizados da Zoppy`
            : `⏳ ${totalSynced} clientes sincronizados. Ainda há mais páginas (próxima: ${page}). Clique novamente para continuar.`
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Invalid mode. Use "calculate_rfm" or "from_api"' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
