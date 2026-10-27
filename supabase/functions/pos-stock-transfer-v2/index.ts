// Transferência de estoque entre lojas (motor atômico pos_transfer_stock).
// Ações: preview | execute | reverse (admin) | history | resolve | execute_request.
// Não chama a Shopify: ela recebe a soma das lojas, que não muda numa transferência.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { freightAuth } from '../_shared/freight-auth.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCT_COLS = 'id, store_id, name, sku, barcode, parent_sku, size, color, image_url, stock, is_active, price';

function cleanError(msg: string) {
  return msg.replace(/^.*?ERROR:\s*/i, '').trim();
}

async function userName(db: any, userId: string) {
  const { data } = await db.from('profiles').select('full_name, username, email').eq('id', userId).maybeSingle();
  if (data?.full_name || data?.username) return data.full_name || data.username;
  const { data: u } = await db.auth.admin.getUserById(userId);
  return (u?.user?.user_metadata as any)?.full_name || u?.user?.email || 'Usuário';
}

async function withDestStock(db: any, rows: any[], toStore: string | null) {
  if (!toStore) return rows.map((r) => ({ ...r, dest_stock: null, dest_product_id: null }));
  return await Promise.all(rows.map(async (r) => {
    const { data: destId } = await db.rpc('pos_transfer_find_dest', { p_src_id: r.id, p_to: toStore });
    let dest_stock = 0;
    if (destId) {
      const { data: d } = await db.from('pos_products').select('stock').eq('id', destId).maybeSingle();
      dest_stock = Number(d?.stock || 0);
    }
    return { ...r, dest_product_id: destId || null, dest_stock };
  }));
}

async function runTransfer(db: any, args: Record<string, unknown>) {
  const { data, error } = await db.rpc('pos_transfer_stock', args);
  if (error) return { ok: false, error: cleanError(error.message) };
  return data;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { db, userId } = await freightAuth(req);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');

    if (action === 'resolve') {
      const store = String(body.store_id || ''), code = String(body.code || '').trim();
      const toStore = body.to_store_id && UUID.test(String(body.to_store_id)) ? String(body.to_store_id) : null;
      if (!UUID.test(store) || !code || code.length > 80) return json({ ok: false, error: 'Loja ou código inválido' }, 400);
      let rows: any[] = [];
      let mode: 'code' | 'text' = 'code';
      if (/^\d{8,14}$/.test(code)) {
        const { data } = await db.from('pos_products').select(PRODUCT_COLS).eq('store_id', store)
          .or(`barcode.eq.${code},sku.eq.${code}`).order('stock', { ascending: false }).limit(5);
        rows = data || [];
      } else {
        const { data } = await db.from('pos_products').select(PRODUCT_COLS).eq('store_id', store).eq('sku', code).limit(5);
        rows = data || [];
        if (!rows.length) {
          mode = 'text';
          const { data: found } = await db.rpc('search_products_unaccent', { search_term: code, p_store_id: store });
          rows = (found || []).slice(0, 20).map((r: any) => ({
            id: r.id, store_id: r.store_id, name: r.name, sku: r.sku, barcode: r.barcode, parent_sku: r.parent_sku,
            size: r.size, color: r.color, image_url: r.image_url, stock: r.stock, is_active: r.is_active, price: r.price,
          }));
        }
      }
      return json({ ok: true, mode, products: await withDestStock(db, rows, toStore) });
    }

    if (action === 'preview' || action === 'execute') {
      const name = await userName(db, userId);
      const result = await runTransfer(db, {
        p_from: body.from_store_id, p_to: body.to_store_id, p_items: body.items ?? [],
        p_notes: typeof body.notes === 'string' ? body.notes.slice(0, 500) : null,
        p_user_id: userId, p_user_name: name,
        p_idempotency_key: action === 'execute' ? String(body.idempotency_key || '').slice(0, 120) : null,
        p_dry_run: action === 'preview',
      });
      return json(result);
    }

    // Confirmação de solicitação entre lojas: a loja que recebeu o pedido (to_store_id) envia para quem pediu (from_store_id).
    if (action === 'execute_request') {
      const requestId = String(body.request_id || '');
      if (!UUID.test(requestId)) return json({ ok: false, error: 'Solicitação inválida' }, 400);
      const { data: request } = await db.from('pos_inter_store_requests').select('id, from_store_id, to_store_id, items').eq('id', requestId).maybeSingle();
      if (!request) return json({ ok: false, error: 'Solicitação não encontrada' }, 404);
      const origin = request.to_store_id, dest = request.from_store_id;
      const items: any[] = [], missing: string[] = [];
      for (const it of (request.items as any[]) || []) {
        const code = String(it.barcode || it.sku || '').trim();
        if (!code) { missing.push(`${it.product_name || 'Item'}: sem código`); continue; }
        let q = db.from('pos_products').select('id').eq('store_id', origin);
        q = it.barcode ? q.eq('barcode', it.barcode) : q.eq('sku', it.sku);
        const { data } = await q.order('stock', { ascending: false }).limit(1);
        if (!data?.[0]) { missing.push(`${it.product_name || code}${it.size ? ` (tam ${it.size})` : ''}: não encontrado no estoque de origem`); continue; }
        items.push({ pos_product_id: data[0].id, quantity: Number(it.quantity) });
      }
      if (missing.length) return json({ ok: false, error: `Nada foi transferido. ${missing.join('; ')}` });
      const name = await userName(db, userId);
      return json(await runTransfer(db, {
        p_from: origin, p_to: dest, p_items: items, p_notes: `Solicitação entre lojas ${requestId.slice(0, 8)}`,
        p_user_id: userId, p_user_name: name, p_idempotency_key: `request:${requestId}`, p_dry_run: false,
      }));
    }

    if (action === 'reverse') {
      const id = String(body.transfer_id || '');
      if (!UUID.test(id)) return json({ ok: false, error: 'Transferência inválida' }, 400);
      const name = await userName(db, userId);
      const { data, error } = await db.rpc('pos_reverse_stock_transfer', {
        p_transfer_id: id, p_user_id: userId, p_user_name: name, p_reason: String(body.reason || '').slice(0, 500),
      });
      if (error) return json({ ok: false, error: cleanError(error.message) });
      return json(data);
    }

    if (action === 'history') {
      const limit = Math.min(Math.max(Number(body.limit) || 20, 1), 100);
      const offset = Math.max(Number(body.offset) || 0, 0);
      let q = db.from('pos_stock_transfers')
        .select('id, numero, from_store_id, to_store_id, status, items, total_items, notes, created_by, created_by_name, created_at, reversed_of, reversed_by_transfer, reversed_at, reverse_reason', { count: 'exact' })
        .order('created_at', { ascending: false }).range(offset, offset + limit - 1);
      if (body.store_id && UUID.test(String(body.store_id))) q = q.or(`from_store_id.eq.${body.store_id},to_store_id.eq.${body.store_id}`);
      if (body.other_store_id && UUID.test(String(body.other_store_id))) q = q.or(`from_store_id.eq.${body.other_store_id},to_store_id.eq.${body.other_store_id}`);
      if (body.from) q = q.gte('created_at', String(body.from));
      if (body.to) q = q.lte('created_at', String(body.to));
      if (body.user && typeof body.user === 'string') q = q.ilike('created_by_name', `%${body.user.replace(/[%,()]/g, '')}%`);
      const search = typeof body.search === 'string' ? body.search.trim().replace(/[%,()]/g, '') : '';
      if (search) {
        const num = Number(search.replace(/^t-?/i, ''));
        if (Number.isInteger(num) && num > 0) q = q.eq('numero', num);
        else q = q.filter('items::text', 'ilike', `%${search}%`);
      }
      const { data, error, count } = await q;
      if (error) return json({ ok: false, error: error.message }, 500);
      const { data: isAdmin } = await db.rpc('has_role', { _user_id: userId, _role: 'admin' });
      return json({ ok: true, transfers: data || [], total: count || 0, is_admin: !!isAdmin });
    }

    return json({ ok: false, error: 'Ação inválida' }, 400);
  } catch (e) {
    const status = (e as any)?.status || 500;
    return json({ ok: false, error: (e as Error).message }, status);
  }
});
