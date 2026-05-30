import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function formatBRDate(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}/${m}/${date.getFullYear()}`;
}

function brToISO(br: string): string {
  const parts = br.split('/');
  if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  return br;
}

async function safeJson(resp: Response) {
  const text = await resp.text();
  try { return JSON.parse(text); }
  catch { return { retorno: { status: 'Erro', erros: [{ erro: text.substring(0, 200) }] } }; }
}

function normalizeBRPhone(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (!digits.startsWith('55')) digits = '55' + digits;
  // Inject 9th digit for BR mobile numbers missing it (55 + 2-digit DDD + 8 digits = 12)
  if (digits.length === 12 && digits.startsWith('55')) {
    const ddd = digits.slice(2, 4);
    const number = digits.slice(4);
    digits = `55${ddd}9${number}`;
  }
  return digits;
}

// Extract DDD + last 8 digits as unique matching key
function extractPhoneKey(raw: string): string | null {
  let digits = raw.replace(/\D/g, '');
  if (!digits || digits.length < 10) return null;
  // Remove country code 55 if present
  if (digits.length >= 12 && digits.startsWith('55')) {
    digits = digits.slice(2);
  }
  // DDD = first 2, suffix = last 8
  return digits.slice(0, 2) + digits.slice(-8);
}

// Simple name similarity: compare normalized tokens overlap
function nameSimilarity(a: string, b: string): number {
  const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const tokensA = normalize(a).split(/\s+/).filter(t => t.length > 1);
  const tokensB = normalize(b).split(/\s+/).filter(t => t.length > 1);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  let matches = 0;
  for (const t of tokensA) {
    if (tokensB.includes(t)) matches++;
  }
  // Score = matched tokens / max tokens count
  return matches / Math.max(tokensA.length, tokensB.length);
}

const TIME_LIMIT_MS = 55_000;
const NAME_SIMILARITY_THRESHOLD = 0.5; // At least 50% of name tokens must match

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const functionStart = Date.now();
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const mode = body.mode || 'all';
    const months = body.months || 24;
    let posCount = 0;
    let tinyOnlineCount = 0;

    // ── 1. Sync POS completed sales with CPF-first rematching ──
    if (mode === 'pos' || mode === 'all') {
      // 1a. Fetch all POS sales
      let allSales: any[] = [];
      let salesFrom = 0;
      while (true) {
        const { data, error: salesErr } = await supabase
          .from('pos_sales').select('id, customer_id, total, created_at, status, store_id')
          .in('status', ['completed', 'paid']).range(salesFrom, salesFrom + 999);
        if (salesErr) throw salesErr;
        if (!data || data.length === 0) break;
        allSales = allSales.concat(data);
        if (data.length < 1000) break;
        salesFrom += 1000;
      }

      if (allSales.length > 0) {
        // 1b. Fetch all POS customers
        const customerIds = [...new Set(allSales.filter(s => s.customer_id).map(s => s.customer_id))];
        let allCustomers: any[] = [];
        for (let ci = 0; ci < customerIds.length; ci += 50) {
          const { data: cc } = await supabase.from('pos_customers')
            .select('id, name, email, whatsapp, city, state, gender, cpf, shoe_size, preferred_style, age_range')
            .in('id', customerIds.slice(ci, ci + 50));
          if (cc) allCustomers = allCustomers.concat(cc);
        }
        const customerMap = new Map(allCustomers.map(c => [c.id, c]));

        // 1c. Aggregate sales per POS customer
        const customerSales = new Map<string, { total: number; count: number; first: string; last: string; storeId: string | null }>();
        for (const sale of allSales) {
          if (!sale.customer_id) continue;
          const e = customerSales.get(sale.customer_id);
          if (e) {
            e.total += Number(sale.total || 0); e.count++;
            if (sale.created_at < e.first) e.first = sale.created_at;
            if (sale.created_at > e.last) { e.last = sale.created_at; e.storeId = sale.store_id || e.storeId; }
          } else {
            customerSales.set(sale.customer_id, { total: Number(sale.total || 0), count: 1, first: sale.created_at, last: sale.created_at, storeId: sale.store_id || null });
          }
        }

        // 1d. Build dedicated pos- records with SET (REPLACE) semantics.
        // IMPORTANT: We intentionally do NOT additively merge into existing zoppy
        // records anymore. The previous additive merge re-added the full lifetime
        // total on every cron run, compounding values into the millions. Each POS
        // customer is now represented as a single `pos-<id>` row whose totals are
        // recomputed (SET) from pos_sales every run — fully idempotent.
        const upsertBatch: any[] = [];

        for (const [custId, stats] of customerSales) {
          const cust = customerMap.get(custId);
          if (!cust) continue;
          const phone = normalizeBRPhone(cust.whatsapp || '');
          const cpf = (cust.cpf || '').replace(/\D/g, '') || null;
          const custName = (cust.name || '').trim();
          if (!phone && !cust.email && !cpf) continue;

          const nameParts = custName.split(' ');
          const ddd = phone.length >= 12 ? phone.slice(2, 4) : null;

          upsertBatch.push({
            zoppy_id: `pos-${custId}`, external_id: custId,
            first_name: nameParts[0] || '', last_name: nameParts.slice(1).join(' ') || '',
            phone: phone || null, email: cust.email || null, cpf,
            city: cust.city || null, state: cust.state || null, gender: cust.gender || null,
            region_type: 'local', ddd, store_id: stats.storeId,
            shoe_size: cust.shoe_size || null, preferred_style: cust.preferred_style || null, age_range: cust.age_range || null,
            source: 'pos', lead_status: 'customer',
            total_orders: stats.count, total_spent: stats.total,
            avg_ticket: stats.count > 0 ? stats.total / stats.count : 0,
            first_purchase_at: stats.first, last_purchase_at: stats.last,
          });
        }

        // Upsert with SET semantics: onConflict replaces the stored totals with the
        // freshly recomputed values (never accumulates).
        for (let i = 0; i < upsertBatch.length; i += 100) {
          const chunk = upsertBatch.slice(i, i + 100);
          const { error } = await supabase.from('zoppy_customers').upsert(chunk, { onConflict: 'zoppy_id' });
          if (error) console.error('POS upsert error:', error);
          else posCount += chunk.length;
        }
      }
      console.log(`POS sync: ${posCount} customers upserted (SET semantics)`);
    }

    // ── 2. Sync online sales from Tiny ERP (site) ──
    if (mode === 'tiny' || mode === 'all') {
      const { data: tinyStore } = await supabase.from('pos_stores').select('id, name, tiny_token').eq('name', 'Tiny Shopify').single();
      const tinyToken = tinyStore?.tiny_token || Deno.env.get('TINY_ERP_TOKEN');
      if (!tinyToken) {
        console.warn('No Tiny token for online sync');
      } else {
        const now = new Date();
        const dateFrom = new Date(now);
        dateFrom.setMonth(dateFrom.getMonth() - months);

        const customerByName = new Map<string, { total: number; count: number; first: string; last: string }>();
        let page = 1, totalPages = 1, totalOrders = 0;

        while (page <= totalPages && (Date.now() - functionStart) < TIME_LIMIT_MS - 10000) {
          const formParams: Record<string, string> = {
            token: tinyToken, formato: 'json', pagina: String(page),
            dataInicial: formatBRDate(dateFrom), dataFinal: formatBRDate(now),
          };
          if (body.situacao) formParams.situacao = body.situacao;

          const resp = await fetch('https://api.tiny.com.br/api2/pedidos.pesquisa.php', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(formParams).toString(),
          });
          const data = await safeJson(resp);
          const retorno = data.retorno;

          if (retorno?.status === 'Erro') { console.log(`Tiny page ${page}: ${retorno?.erros?.[0]?.erro}`); break; }
          if (!retorno?.pedidos?.length) break;
          if (page === 1) totalPages = retorno?.numero_paginas || 1;

          for (const p of retorno.pedidos) {
            const ped = p.pedido;
            if (!ped) continue;
            totalOrders++;
            const name = (ped.nome || '').trim();
            if (!name) continue;
            const total = parseFloat(ped.valor || '0');
            const rawDate = ped.data_pedido || ped.dataPrevista || '';
            const date = rawDate.includes('/') ? brToISO(rawDate) : (rawDate || new Date().toISOString().slice(0, 10));

            const ex = customerByName.get(name);
            if (ex) { ex.total += total; ex.count++; if (date < ex.first) ex.first = date; if (date > ex.last) ex.last = date; }
            else customerByName.set(name, { total, count: 1, first: date, last: date });
          }

          console.log(`Tiny page ${page}/${totalPages}: ${retorno.pedidos.length} orders, ${customerByName.size} customers`);
          page++;
          await new Promise(r => setTimeout(r, 350));
        }

        console.log(`Tiny scan done: ${totalOrders} orders, ${customerByName.size} unique customers`);

        // Build dedicated tiny-online- records with SET (REPLACE) semantics.
        // IMPORTANT: We no longer additively merge Tiny totals into existing zoppy
        // records. That additive merge re-added the full lifetime total on every run,
        // compounding values. Each Tiny customer is one `tiny-online-<name>` row whose
        // totals are recomputed (SET) from Tiny every run — fully idempotent.
        const newBatch: any[] = [];

        for (const [name, stats] of customerByName) {
          const nameParts = name.split(' ');
          newBatch.push({
            zoppy_id: `tiny-online-${name.toLowerCase().replace(/\s+/g, '-')}`,
            first_name: nameParts[0] || '', last_name: nameParts.slice(1).join(' ') || '',
            phone: null, email: null, cpf: null,
            city: null, state: null,
            region_type: 'online', ddd: null,
            source: 'tiny_online', lead_status: 'customer',
            total_orders: stats.count, total_spent: stats.total,
            avg_ticket: stats.count > 0 ? stats.total / stats.count : 0,
            first_purchase_at: stats.first, last_purchase_at: stats.last,
          });
        }

        // Upsert with SET semantics (onConflict replaces totals, never accumulates).
        for (let i = 0; i < newBatch.length; i += 100) {
          const chunk = newBatch.slice(i, i + 100);
          const { error } = await supabase.from('zoppy_customers').upsert(chunk, { onConflict: 'zoppy_id' });
          if (error) console.error('Tiny upsert error:', error);
          else tinyOnlineCount += chunk.length;
        }
        console.log(`Tiny online sync: ${tinyOnlineCount} customers (SET mode)`);
      }
    }

    // ── 3. Recalculate RFM ──
    if (body.recalculate_rfm !== false) {
      try {
        const rfmRes = await fetch(`${supabaseUrl}/functions/v1/rfm-recalculate`, {
          method: 'POST', headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const rfmData = await rfmRes.json();
        console.log('RFM recalculated:', rfmData.message || rfmData);
      } catch (e) { console.warn('RFM recalc failed:', e); }
    }

    return new Response(JSON.stringify({
      success: true,
      pos_customers_synced: posCount,
      tiny_online_customers_synced: tinyOnlineCount,
      message: `✅ SET mode (idempotente) — POS: ${posCount}, Tiny: ${tinyOnlineCount}`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Sync error:', error);
    return new Response(JSON.stringify({ error: 'Internal error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
