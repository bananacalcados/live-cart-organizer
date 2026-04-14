import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const ZOPPY_BASE_URL = "https://api-partners.zoppy.com.br";
const LOCAL_DDD = "33";

function getRfmSegment(r: number, f: number, m: number): string {
  if (r >= 4 && f >= 4 && m >= 4) return "Campeões";
  if (f >= 4 && r >= 3) return "Leais";
  if (r >= 4 && f >= 2 && f <= 3) return "Potenciais Leais";
  if (r >= 4 && f <= 2) return "Novos Clientes";
  if (r >= 3 && r <= 4 && f <= 2) return "Promissores";
  if (r >= 2 && r <= 3 && f >= 2 && f <= 3 && m >= 2 && m <= 3) return "Precisam Atenção";
  if (r === 2 && f <= 3) return "Quase Dormindo";
  if (r <= 2 && f >= 4 && m >= 4) return "Não Pode Perder";
  if (r <= 2 && f >= 3) return "Em Risco";
  if (r <= 2 && f <= 2) return "Hibernando";
  if (r === 1 && f === 1) return "Perdidos";
  return "Outros";
}

function classifyRegion(phone: string | null, address1: string | null, city: string | null, _state: string | null): { regionType: string; ddd: string } {
  let ddd = "";
  if (phone) {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length >= 10) {
      ddd = cleaned.startsWith('55') ? cleaned.substring(2, 4) : cleaned.substring(0, 2);
    }
  }
  const hasAddress = !!(address1 && address1.trim() && address1.trim() !== ',' && city && city.trim());
  if (ddd === LOCAL_DDD && !hasAddress) return { regionType: 'local', ddd };
  if (hasAddress) return { regionType: 'online', ddd };
  if (ddd === LOCAL_DDD) return { regionType: 'local', ddd };
  // If DDD is known and not local, customer is from outside → online
  if (ddd && ddd !== LOCAL_DDD) return { regionType: 'online', ddd };
  return { regionType: 'unknown', ddd };
}

async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 500 || res.status === 502 || res.status === 503) {
        console.warn(`Zoppy API returned ${res.status}, attempt ${attempt + 1}/${maxRetries}`);
        if (attempt < maxRetries - 1) {
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
      }
      return res;
    } catch (err) {
      console.warn(`Fetch error attempt ${attempt + 1}/${maxRetries}:`, err);
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Max retries exceeded');
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
    const mode = body.mode || 'from_api';

    if (mode === 'calculate_rfm') {
      console.log('Calculating RFM scores directly from zoppy_customers...');

      // Fetch all customers with purchases directly from zoppy_customers (already aggregated)
      // Process in batches to avoid CPU timeout
      let allCustomers: any[] = [];
      let from = 0;
      const batchSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from('zoppy_customers')
          .select('zoppy_id, first_name, last_name, phone, email, total_orders, total_spent, last_purchase_at, first_purchase_at, city, state, gender, address1, ddd, region_type')
          .gt('total_orders', 0)
          .range(from, from + batchSize - 1);
        if (error) { console.error('Fetch error:', error); throw error; }
        if (!data || data.length === 0) break;
        allCustomers = allCustomers.concat(data);
        if (data.length < batchSize) break;
        from += batchSize;
      }

      console.log(`Found ${allCustomers.length} customers with purchases`);

      if (allCustomers.length === 0) {
        return new Response(JSON.stringify({ success: true, message: 'No customers found', count: 0 }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const now = new Date();

      // Pre-compute sorted arrays for quintile calculation
      const recencies: number[] = [];
      const frequencies: number[] = [];
      const monetaries: number[] = [];
      for (const c of allCustomers) {
        recencies.push((now.getTime() - new Date(c.last_purchase_at || now).getTime()) / (1000 * 60 * 60 * 24));
        frequencies.push(c.total_orders || 0);
        monetaries.push(c.total_spent || 0);
      }
      recencies.sort((a, b) => a - b);
      frequencies.sort((a, b) => a - b);
      monetaries.sort((a, b) => a - b);

      // Use binary search for quintile instead of findIndex (O(log n) vs O(n))
      function binarySearchInsert(arr: number[], val: number): number {
        let lo = 0, hi = arr.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (arr[mid] < val) lo = mid + 1;
          else hi = mid;
        }
        return lo;
      }

      function getQuintile(value: number, sortedValues: number[], inverse = false): number {
        const position = binarySearchInsert(sortedValues, value);
        const percentile = position / sortedValues.length;
        const score = Math.ceil(percentile * 5);
        const clamped = Math.max(1, Math.min(5, score));
        return inverse ? (6 - clamped) : clamped;
      }

      // Process and upsert in chunks
      let upserted = 0;
      const CHUNK = 200;
      for (let i = 0; i < allCustomers.length; i += CHUNK) {
        const chunk = allCustomers.slice(i, i + CHUNK);
        const upsertBatch = chunk.map(c => {
          const recencyDays = (now.getTime() - new Date(c.last_purchase_at || now).getTime()) / (1000 * 60 * 60 * 24);
          const rScore = getQuintile(recencyDays, recencies, true);
          const fScore = getQuintile(c.total_orders || 0, frequencies);
          const mScore = getQuintile(c.total_spent || 0, monetaries);
          const totalScore = rScore + fScore + mScore;
          const segment = getRfmSegment(rScore, fScore, mScore);

          return {
            zoppy_id: c.zoppy_id,
            rfm_recency_score: rScore,
            rfm_frequency_score: fScore,
            rfm_monetary_score: mScore,
            rfm_total_score: totalScore,
            rfm_segment: segment,
            rfm_calculated_at: now.toISOString(),
            avg_ticket: c.total_orders > 0 ? +((c.total_spent || 0) / c.total_orders).toFixed(2) : 0,
          };
        });

        const { error } = await supabase.from('zoppy_customers').upsert(upsertBatch, { onConflict: 'zoppy_id' });
        if (error) { console.error('Upsert error:', error); throw error; }
        upserted += upsertBatch.length;
      }

      return new Response(JSON.stringify({ success: true, count: upserted, message: `RFM calculado para ${upserted} clientes` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (mode === 'from_api') {
      if (!zoppyToken) {
        return new Response(JSON.stringify({ error: 'ZOPPY_API_TOKEN not configured' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const startPage = body.start_page || 1;
      const maxPages = body.max_pages || 50;
      let page = startPage;
      let totalSynced = 0;
      let hasMore = true;
      let pagesProcessed = 0;

      console.log(`Starting sync from page ${startPage}, max ${maxPages} pages...`);

      while (hasMore && pagesProcessed < maxPages) {
        const url = `${ZOPPY_BASE_URL}/customers?page=${page}&limit=100&after=2020-01-01T00:00:00.000Z`;
        console.log(`Fetching page ${page}: ${url}`);
        
        let res: Response | null = null;
        let lastError = '';
        
        try {
          res = await fetchWithRetry(url, {
            headers: { 'Authorization': `Bearer ${zoppyToken}`, 'Content-Type': 'application/json' },
          });
          
          if (!res.ok) {
            const text = await res.text();
            lastError = `Status ${res.status}: ${text}`;
            console.error(`Zoppy error ${res.status}: ${text}`);
            res = null;
          }
        } catch (err) {
          lastError = err.message;
          console.error(`Fetch failed: ${err.message}`);
          res = null;
        }

        if (!res || !res.ok) {
          if (totalSynced > 0) {
            return new Response(JSON.stringify({ 
              success: true, partial: true, count: totalSynced, next_page: page,
              message: `${totalSynced} clientes sincronizados (erro na página ${page}: ${lastError})` 
            }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }
          throw new Error(`Zoppy API error on page ${page}: ${lastError}`);
        }

        const data = await res.json();
        const customers = Array.isArray(data) ? data : (data.data || data.results || []);

        if (customers.length === 0) { hasMore = false; break; }

        const batch = customers.map((c: any) => {
          const addr = c.address || {};
          const coupon = c.coupon || null;
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
            coupon_code: coupon?.code || null,
            coupon_amount: coupon?.amount || null,
            coupon_type: coupon?.type || null,
            coupon_used: coupon?.used ?? null,
            coupon_min_purchase: coupon?.minPurchaseValue || null,
            coupon_expiry_date: coupon?.expiryDate || null,
            coupon_start_date: coupon?.startDate || null,
            zoppy_created_at: c.createdAt || null,
            zoppy_updated_at: c.updatedAt || null,
          };
        });

        const { error } = await supabase.from('zoppy_customers').upsert(batch, { onConflict: 'zoppy_id' });
        if (error) { console.error('Upsert error:', error); throw error; }

        totalSynced += batch.length;
        page++;
        pagesProcessed++;
        if (customers.length < 100) hasMore = false;
      }

      const completed = !hasMore;
      console.log(`Sync batch done: ${totalSynced} customers, completed: ${completed}, next page: ${page}`);

      return new Response(JSON.stringify({ 
        success: true, completed, count: totalSynced, 
        next_page: completed ? null : page,
        message: completed 
          ? `✅ Sincronização completa! ${totalSynced} clientes sincronizados da Zoppy`
          : `⏳ ${totalSynced} clientes sincronizados. Próxima página: ${page}. Clique novamente para continuar.`
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'Invalid mode. Use "calculate_rfm" or "from_api"' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
