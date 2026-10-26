import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';
import { freightAuth } from '../_shared/freight-auth.ts';
import { loadCorreiosSettings, quoteCorreios } from '../_shared/correios.ts';
import { buildPackage, parseBrl, standardCarrier, localDelivery, type FreightOption, type FreightPackage } from '../_shared/freight-domain.ts';
const bodySchema = z.object({ sale_id: z.string().uuid(), action: z.enum(['quote','select']).default('quote'), quote_id: z.string().uuid().optional(), option_index: z.number().int().min(0).max(199).optional(), package: z.object({ peso_g: z.number().int().positive().max(1000000), c: z.number().positive().max(100), l: z.number().positive().max(100), a: z.number().positive().max(100) }).strict().optional() }).strict();
const cepOf = (a: any) => String(a?.zip_code || a?.zip || a?.cep || a?.postal_code || '').replace(/\D/g,'');
const unique = (v: (string | null)[]) => [...new Set(v.filter((s): s is string => !!s))];
const checked = (r: any, name: string) => { if (r.error) throw new Error(`Não foi possível carregar ${name}`); return r.data || []; };
function exactMatch(rows: any[], item: { barcode?: string; sku?: string }, barcodeKey = 'gtin', skuKey = 'sku') {
  const strong = item.barcode ? rows.filter((r) => r[barcodeKey] === item.barcode) : [];
  const candidates = strong.length ? strong : rows.filter((r) => item.sku && r[skuKey] === item.sku);
  return candidates.length === 1 ? candidates[0] : null;
}
async function frenetQuote(settings: any, p: FreightPackage, destination: string, invoiceValue: number): Promise<FreightOption[]> {
  const token = Deno.env.get('FRENET_TOKEN');
  if (!token) throw new Error('Frenet: token não configurado');
  const response = await fetch('https://api.frenet.com.br/shipping/quote', { method: 'POST', headers: { token, Accept: 'application/json', 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000), body: JSON.stringify({ SellerCEP: settings.remetente.cep.replace(/\D/g,''), RecipientCEP: destination, ShipmentInvoiceValue: invoiceValue, ShippingItemArray: [{ Height: p.a, Length: p.c, Width: p.l, Weight: p.peso_g / 1000, Quantity: 1, SKU: 'PACKAGE' }], RecipientCountry: 'BR' }) });
  if (!response.ok) throw new Error(`Frenet: não foi possível cotar (${response.status})`);
  const data = await response.json();
  const rows = data.ShippingSevicesArray || data.ShippingServices || [];
  const options: FreightOption[] = [];
  for (const s of rows) {
    const price = parseBrl(s.ShippingPrice || s.OriginalShippingPrice);
    if (s.Error === true || s.Error === 'true' || s.Error === 1 || !Number.isFinite(price) || price <= 0) continue;
    const carrier = String(s.Carrier || 'Transportadora'), service = String(s.ServiceDescription || s.ServiceCode || '');
    const days = s.DeliveryTime != null && s.DeliveryTime !== '' ? Number(s.DeliveryTime) : NaN;
    options.push({ source: 'frenet', carrier, service, service_code: String(s.ServiceCode || ''), price, delivery_days: Number.isFinite(days) && days >= 0 ? days : null, note: String(s.Msg || ''), ...standardCarrier(carrier, service) });
  }
  if (!options.length) throw new Error('Frenet: nenhum frete disponível para este pacote/CEP');
  return options;
}
Deno.serve(async (req) => {
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { db, userClient, userId } = await freightAuth(req);
    const input = bodySchema.safeParse(await req.json().catch(() => null));
    if (!input.success) return reply({ error: 'Informe uma venda e um pacote válidos', details: input.error.flatten().fieldErrors }, 400);
    const b = input.data;
    const saleCols = 'id,store_id,total,shipping_address,shipping_carrier,shipping_type,is_store_pickup,expedition_group_id,expedition_stage';
    const { data: sale, error } = await userClient.from('pos_sales').select(saleCols).eq('id', b.sale_id).maybeSingle();
    if (error || !sale) return reply({ error: 'Pedido não encontrado ou sem acesso' }, 404);
    // Eligibility mirrors the Expedition screen (item quantities), never the pos_sales.expedition_stage summary.
    if (sale.is_store_pickup || /retirada|pickup/i.test(`${sale.shipping_type || ''} ${sale.shipping_carrier || ''}`)) return reply({ error: 'Pedido é retirada na loja' }, 400);
    if (localDelivery(sale)) return reply({ error: 'Pedido é entrega por mototáxi' }, 400);
    if (b.action === 'select') {
      if (!b.quote_id || b.option_index == null) return reply({ error: 'Informe a cotação e a opção' }, 400);
      const { data: q, error: qErr } = await db.from('sale_freight_quotes').select('sale_id').eq('id', b.quote_id).maybeSingle();
      if (qErr || q?.sale_id !== sale.id) return reply({ error: 'Cotação não pertence a este pedido' }, 400);
      const result = await db.rpc('select_sale_freight_option', { p_quote_id: b.quote_id, p_option_index: b.option_index, p_user_id: userId });
      if (result.error) return reply({ error: result.error.message }, 409);
      return reply({ selected_option: result.data });
    }
    let sales: any[] = [sale];
    if (sale.expedition_group_id) {
      const r = await userClient.from('pos_sales').select(saleCols).eq('expedition_group_id', sale.expedition_group_id).order('id').limit(101);
      sales = checked(r, 'agrupamento');
      if (!sales.length || sales.length > 100) return reply({ error: 'Agrupamento inválido ou com mais de 100 pedidos' }, 400);
      if (sales.some((s) => localDelivery(s))) return reply({ error: 'Um pedido do agrupamento é retirada na loja ou mototáxi' }, 400);
      if (new Set(sales.map((s) => cepOf(s.shipping_address))).size > 1) return reply({ error: 'Pedidos do agrupamento têm CEPs de destino diferentes' }, 400);
    }
    const ids = sales.map((s) => s.id);
    const allItems = checked(await db.from('pos_sale_items').select('id,sale_id,sku,barcode,quantity,expedition_conference_qty,expedition_completed_qty').in('sale_id', ids).order('id').limit(201), 'itens');
    if (!allItems.length) return reply({ error: 'Pedido sem itens' }, 400);
    // Package: Conferência items; fallback to not-yet-completed, then full quantity.
    const pick = (f: (i: any) => number) => allItems.map((i: any) => ({ ...i, pkg_qty: f(i) })).filter((i: any) => i.pkg_qty > 0);
    let items = pick((i) => Number(i.expedition_conference_qty) || 0);
    if (!items.length) items = pick((i) => (Number(i.quantity) || 0) - (Number(i.expedition_completed_qty) || 0));
    if (!items.length) items = pick((i) => Number(i.quantity) || 0);
    if (!items.length) return reply({ error: 'Nenhum item do pedido tem quantidade para cotar' }, 400);
    if (items.length > 200) return reply({ error: 'Pacote contém mais de 200 linhas de itens; divida o envio' }, 400);
    const destination = cepOf(sale.shipping_address);
    if (!destination) return reply({ error: 'Pedido sem CEP' }, 400);
    if (!/^\d{8}$/.test(destination)) return reply({ error: 'CEP do pedido inválido (precisa ter 8 dígitos)' }, 400);
    const settings = await loadCorreiosSettings(db);
    const skus = unique(items.map((i: any) => i.sku)), barcodes = unique(items.map((i: any) => i.barcode));
    const empty = Promise.resolve({ data: [], error: null });
    const variantsResults = await Promise.all([
      skus.length ? db.from('product_variants').select('id,master_id,sku,gtin,weight_kg_override').in('sku', skus).limit(201) : empty,
      barcodes.length ? db.from('product_variants').select('id,master_id,sku,gtin,weight_kg_override').in('gtin', barcodes).limit(201) : empty,
    ]);
    const variants = [...new Map(variantsResults.flatMap((r) => checked(r,'variantes')).map((v: any) => [v.id,v])).values()] as any[];
    const masterIds = unique(variants.map((v) => v.master_id));
    const mastersResults = await Promise.all([
      masterIds.length ? db.from('products_master').select('id,sku_root,weight_kg,length_cm,width_cm,height_cm,category_id').in('id',masterIds).limit(201) : empty,
      skus.length ? db.from('products_master').select('id,sku_root,weight_kg,length_cm,width_cm,height_cm,category_id').in('sku_root',skus).limit(201) : empty,
    ]);
    const masters = [...new Map(mastersResults.flatMap((r) => checked(r,'produtos')).map((m: any) => [m.id,m])).values()] as any[];
    // Scope legacy local products by store, preserving indexed store+identifier lookups.
    const storeIds = unique(sales.map((s) => s.store_id));
    const localResults = await Promise.all([
      skus.length ? db.from('pos_products').select('id,sku,barcode,category_id,store_id').in('store_id',storeIds).in('sku',skus).limit(201) : empty,
      barcodes.length ? db.from('pos_products').select('id,sku,barcode,category_id,store_id').in('store_id',storeIds).neq('barcode','').in('barcode',barcodes).limit(201) : empty,
    ]);
    if ([...variantsResults,...mastersResults,...localResults].some((r) => (r.data?.length || 0) > 200)) return reply({ error: 'Muitos produtos correspondentes. Revise o cadastro ou divida o envio' }, 400);
    const locals = [...new Map(localResults.flatMap((r) => checked(r,'catálogo local')).map((v: any) => [v.id,v])).values()] as any[];
    const categoryIds = unique([...masters,...locals].map((v) => v.category_id));
    const categories = categoryIds.length ? checked(await db.from('product_categories').select('id,default_weight_kg,default_height_cm,default_width_cm,default_length_cm').in('id',categoryIds).limit(200),'categorias') : [];
    const pkg = buildPackage(items.map((item: any) => {
      const variant = exactMatch(variants,item);
      const master = variant ? masters.find((m) => m.id === variant.master_id) : exactMatch(masters,item,'unused','sku_root');
      const store = sales.find((s) => s.id === item.sale_id)?.store_id;
      const local = exactMatch(locals.filter((v) => v.store_id === store), item, 'barcode');
      const category = categories.find((c: any) => c.id === (master?.category_id || local?.category_id));
      return { quantity: Number(item.pkg_qty), variantWeight: variant?.weight_kg_override, masterWeight: master?.weight_kg, categoryWeight: category?.default_weight_kg, length: master?.length_cm, width: master?.width_cm, height: master?.height_cm, categoryLength: category?.default_length_cm, categoryWidth: category?.default_width_cm, categoryHeight: category?.default_height_cm };
    }), b.package);
    const errors: Record<string,string> = {};
    const sources = await Promise.allSettled([
      settings.enabled ? quoteCorreios(db,settings,pkg,destination) : Promise.resolve({ options: [] as FreightOption[], error: undefined }),
      frenetQuote(settings,pkg,destination,sales.reduce((s,v) => s + Number(v.total || 0),0)),
    ]);
    const options: FreightOption[] = [];
    sources.forEach((source,i) => {
      const name = i === 0 ? 'correios' : 'frenet';
      if (source.status === 'rejected') errors[name] = source.reason instanceof Error ? (/timeout|abort/i.test(source.reason.name) ? `${name === 'frenet' ? 'Frenet' : 'Correios'}: consulta excedeu 15 segundos` : source.reason.message) : 'Não foi possível cotar';
      else if (i === 0) { const r = source.value as { options: FreightOption[]; error?: string }; options.push(...r.options); if (r.error) errors.correios = r.error; }
      else options.push(...source.value as FreightOption[]);
    });
    options.sort((a,b) => a.price-b.price);
    if (options.length > 200) options.length = 200;
    const context = { group_id: sale.expedition_group_id || '', address: sale.shipping_address, items: items.map((i: any) => ({ id:i.id, quantity:i.pkg_qty, sku:i.sku, barcode:i.barcode })) };
    const result = await db.rpc('record_sale_freight_quote', { p_sale_id:sale.id, p_sale_ids:ids, p_package:pkg, p_options:options, p_errors:errors, p_user_id:userId, p_context:context });
    if (result.error) throw new Error(result.error.message || 'Não foi possível salvar a cotação');
    return reply({ id:result.data.id, quoted_at:result.data.quoted_at, package:pkg, options, errors });
  } catch (e) {
    const err = e as Error & { status?:number };
    return reply({ error:err.message || 'Não foi possível cotar os fretes' }, err.status || 400);
  }
});