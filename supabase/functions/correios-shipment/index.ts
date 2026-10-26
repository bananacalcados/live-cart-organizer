import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';
import { freightAuth } from '../_shared/freight-auth.ts';
import { loadCorreiosSettings, getCorreiosToken, createCorreiosFetch, quoteCorreios } from '../_shared/correios.ts';
import { localDelivery, buildPackage } from '../_shared/freight-domain.ts';
import { buildPrePostagemPayload, resolveLabelSender, parseNfeXml, correiosTrackingUrl, extractPdfBase64, saleAddress, type NfeSummary } from '../_shared/correios-prepost-domain.ts';
import { buildCombinedPdf, concatPdfs } from '../_shared/correios-label-pdf.ts';

const BUCKET = 'correios-labels';
const ACTIVE = '(cancelada,erro)';
const body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), sale_id: z.string().uuid(), dry_run: z.boolean().optional(), simulate_service_code: z.string().regex(/^\d{5}$/).optional() }),
  z.object({ action: z.literal('label'), shipment_id: z.string().uuid() }),
  z.object({ action: z.literal('cancel'), shipment_id: z.string().uuid(), reason: z.string().trim().min(3).max(200) }),
  z.object({ action: z.literal('list'), sale_ids: z.array(z.string().uuid()).min(1).max(200) }),
  z.object({ action: z.literal('batch_labels'), shipment_ids: z.array(z.string().uuid()).min(1).max(50) }),
]);
const SALE_COLS = 'id,customer_name,customer_cpf,customer_phone,customer_email,shipping_address,is_store_pickup,status,status_cancelamento,expedition_group_id,expedition_stage,expedition_deleted_at,shipping_type,shipping_carrier';
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fail = (msg: string, status = 400) => Object.assign(new Error(msg), { status });

Deno.serve(async (req) => {
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { db, userClient, userId } = await freightAuth(req, false);
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return reply({ error: 'Requisição inválida', details: parsed.error.flatten().fieldErrors }, 400);
    const b = parsed.data;
    const sign = async (path: string | null) => path ? (await db.storage.from(BUCKET).createSignedUrl(path, 600)).data?.signedUrl || null : null;
    const getShipment = async (id: string) => {
      const { data, error } = await db.from('correios_shipments').select('*').eq('id', id).maybeSingle();
      if (error || !data) throw fail('Envio Correios não encontrado', 404);
      // Access check through the caller's own visibility of the sale.
      const { data: own } = await userClient.from('pos_sales').select('id').eq('id', data.sale_id).maybeSingle();
      if (!own) throw fail('Sem acesso a este pedido', 403);
      return data;
    };
    const loadNfes = async (saleIds: string[]) => {
      const { data, error } = await db.from('fiscal_documents').select('pos_sale_id,company_id,chave_acesso,numero,serie,protocolo,xml_content,created_at').in('pos_sale_id', saleIds).eq('modelo', 55).eq('status', 'authorized').order('created_at', { ascending: false }).limit(200);
      if (error) throw new Error('Não foi possível ler as NF-e');
      const bySale = new Map<string, any>();
      for (const d of data || []) if (!bySale.has(d.pos_sale_id)) bySale.set(d.pos_sale_id, d);
      return bySale;
    };
    const summarize = (d: any): NfeSummary => parseNfeXml(d.xml_content || '', { chave: d.chave_acesso, numero: d.numero, serie: d.serie, protocolo: d.protocolo });
    const writeTracking = async (shipment: any, code: string) => {
      const carrier = shipment.servico_nome === 'SEDEX' || shipment.servico_codigo === '03220' ? 'Correios SEDEX' : 'Correios PAC';
      const { error } = await db.from('pos_sales').update({ tracking_code: code, tracking_carrier: carrier, tracking_url: correiosTrackingUrl(code) }).in('id', shipment.sale_ids);
      if (error) throw new Error('Etiqueta emitida, mas não foi possível gravar o rastreio no pedido');
    };
    const buildCombined = async (shipment: any, label: Uint8Array) => {
      const nfeMap = await loadNfes(shipment.sale_ids);
      const nfes = [...nfeMap.values()].filter((d) => shipment.nfe_chaves.includes(d.chave_acesso)).map(summarize);
      const pdf = await buildCombinedPdf(label, nfes);
      const path = `${shipment.id}/etiqueta-conjunta.pdf`;
      const up = await db.storage.from(BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: true });
      if (up.error) throw new Error('Não foi possível salvar a etiqueta conjunta');
      return path;
    };
    // Emits label (async CWS flow: request receipt, then download) and stores PDFs.
    const emitLabel = async (shipment: any) => {
      const settings = await loadCorreiosSettings(db);
      const auth = await getCorreiosToken(db, { settings });
      const cf = createCorreiosFetch(auth.settings, auth.token);
      let recibo = shipment.response?.label_recibo as string | undefined;
      if (!recibo) {
        const r: any = await cf('/v1/prepostagens/rotulo/assincrono/pdf', { method: 'POST', body: JSON.stringify({ idsPrePostagem: [shipment.prepostagem_id], numeroCartaoPostagem: settings.cartao_postagem, tipoRotulo: 'P', formatoRotulo: 'ET', imprimeRemetente: 'S', layoutImpressao: 'LINEAR_100_150' }) });
        recibo = r?.idRecibo || r?.reciboSolicitacao || r?.id;
        if (!recibo) throw new Error('Correios: não retornou o recibo do rótulo');
        await db.from('correios_shipments').update({ response: { ...(shipment.response || {}), label_recibo: recibo } }).eq('id', shipment.id);
        shipment.response = { ...(shipment.response || {}), label_recibo: recibo };
      }
      let pdfB64: string | null = null, lastErr = '';
      for (let i = 0; i < 6 && !pdfB64; i++) {
        if (i) await sleep(1500);
        try { const d: any = await cf(`/v1/prepostagens/rotulo/download/assincrono/${encodeURIComponent(recibo)}`, { method: 'GET' }); pdfB64 = d?.pdfBytes ? null : extractPdfBase64(d); if (d?.pdfBytes) { const label = d.pdfBytes as Uint8Array; return await finishLabel(shipment, label, cf); } }
        catch (e) { lastErr = e instanceof Error ? e.message : String(e); }
      }
      if (!pdfB64) throw new Error(lastErr || 'Correios: rótulo ainda em processamento. Tente "Gerar etiqueta" novamente em instantes');
      return await finishLabel(shipment, fromB64(pdfB64), cf);
    };
    const finishLabel = async (shipment: any, label: Uint8Array, cf: ReturnType<typeof createCorreiosFetch>) => {
      const labelPath = `${shipment.id}/rotulo.pdf`;
      const up = await db.storage.from(BUCKET).upload(labelPath, label, { contentType: 'application/pdf', upsert: true });
      if (up.error) throw new Error('Não foi possível salvar o rótulo');
      let code = shipment.codigo_objeto as string | null;
      if (!code) {
        const list: any = await cf(`/v2/prepostagens?id=${encodeURIComponent(shipment.prepostagem_id)}&page=0&size=1`, { method: 'GET' }).catch(() => null);
        const item = list?.itens?.[0] || list?.content?.[0] || list?.[0];
        code = item?.codigoObjeto || null;
      }
      const combinedPath = await buildCombined(shipment, label);
      const patch = { label_path: labelPath, combined_path: combinedPath, codigo_objeto: code, status: code ? 'rotulo_emitido' : 'criada', label_generated_at: new Date().toISOString(), error_message: code ? null : 'Rótulo emitido, mas o código de rastreio ainda não voltou. Tente de novo' };
      await db.from('correios_shipments').update(patch).eq('id', shipment.id);
      if (code) await writeTracking(shipment, code);
      return { ...shipment, ...patch };
    };
    const withUrls = async (s: any) => ({ ...s, request: undefined, response: undefined, combined_url: await sign(s.combined_path), label_url: await sign(s.label_path) });

    if (b.action === 'list') {
      const { data, error } = await db.from('correios_shipments').select('id,sale_id,sale_ids,codigo_objeto,servico_nome,status,created_at,label_generated_at,error_message').overlaps('sale_ids', b.sale_ids).not('status', 'in', ACTIVE).order('created_at', { ascending: false }).limit(200);
      if (error) throw new Error('Não foi possível listar os envios');
      return reply({ shipments: data || [] });
    }

    if (b.action === 'create') {
      if (b.simulate_service_code && b.dry_run !== true) throw fail('Simulação só em dry_run');
      const { data: sale } = await userClient.from('pos_sales').select(SALE_COLS).eq('id', b.sale_id).maybeSingle();
      if (!sale) throw fail('Pedido não encontrado ou sem acesso', 404);
      let sales: any[] = [sale];
      if (sale.expedition_group_id) {
        const { data: g, error } = await userClient.from('pos_sales').select(SALE_COLS).eq('expedition_group_id', sale.expedition_group_id).order('id').limit(101);
        if (error || !g?.length || g.length > 100) throw fail('Não foi possível carregar o agrupamento');
        sales = g;
      }
      const ids = sales.map((s) => s.id);
      if (sales.some((s) => s.status_cancelamento === 'cancelado' || s.expedition_deleted_at || s.expedition_stage === 'concluido')) throw fail('Há pedido cancelado, removido ou já concluído neste envio');
      if (sales.some((s) => localDelivery(s))) throw fail('Retirada na loja/mototáxi não usa etiqueta Correios');
      const { data: existing } = await db.from('correios_shipments').select('*').overlaps('sale_ids', ids).not('status', 'in', ACTIVE).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (existing && !b.dry_run) return reply({ shipment: await withUrls(existing), existing: true });
      const { data: quoteRow } = await db.from('sale_freight_quotes').select('id,package,options,selected_option,quoted_at').contains('sale_ids', [sale.id]).order('quoted_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle();
      // simulate_service_code (dry_run only) previews a Correios option from the latest quote without selecting it.
      let quote: any = quoteRow;
      // Simulation without a usable quote: quote Correios in memory (default package per item), never saved or selected.
      if (b.simulate_service_code && !(quote?.options || []).some((o: any) => o?.source === 'correios' && String(o.service_code) === b.simulate_service_code)) {
        const { data: its } = await db.from('pos_sale_items').select('quantity').in('sale_id', ids).limit(200);
        const pkg = buildPackage((its || []).map((i: any) => ({ quantity: Number(i.quantity) })));
        const st = await loadCorreiosSettings(db);
        const r: any = await quoteCorreios(db, st, pkg, saleAddress(sale).cep, false, true);
        quote = { id: null, package: pkg, options: r.options || [], selected_option: null, simulated_quote: true, quote_error: r.error || null };
      }
      const option = (b.simulate_service_code ? ((quote as any)?.options || []).find((o: any) => o?.source === 'correios' && String(o.service_code) === b.simulate_service_code) : quote?.selected_option) as any;
      if (!quote || option?.source !== 'correios') throw fail(b.simulate_service_code ? 'A última cotação não tem essa opção dos Correios' : 'Selecione uma opção dos Correios na cotação');
      const nfeMap = await loadNfes(ids);
      const missingNfe = sales.filter((s) => !nfeMap.get(s.id)?.chave_acesso);
      const summaryBase = { cotacao_simulada: !!quote.simulated_quote, servico: option.service, servico_codigo: option.service_code, price: option.price, package: quote.package, destinatario: { nome: sale.customer_name, endereco: saleAddress(sale) }, sale_ids: ids };
      if (missingNfe.length) {
        const msg = `NF-e autorizada não encontrada para: ${missingNfe.map((s) => `${s.customer_name || 'pedido'} (${s.id.slice(0, 8)})`).join(', ')}`;
        if (b.dry_run) return reply({ dry_run: true, ok: false, problems: [msg], summary: { ...summaryBase, nfes: [...nfeMap.values()].map((d) => ({ numero: d.numero, chave: d.chave_acesso })), nfe_faltantes: missingNfe.map((s) => s.id) } });
        throw fail(msg);
      }
      const nfes = ids.map((id) => summarize(nfeMap.get(id)));
      const settings = await loadCorreiosSettings(db);
      if (!settings.enabled) throw fail('Integração Correios desativada no Admin');
      const companyIds = [...new Set(ids.map((id) => nfeMap.get(id)?.company_id).filter(Boolean))];
      const { data: companies, error: compErr } = companyIds.length ? await db.from('companies').select('id,cnpj').in('id', companyIds) : { data: [], error: null };
      if (compErr) throw new Error('Não foi possível ler a empresa emitente da NF-e');
      const issuer = ids.map((id) => (companies || []).find((c: any) => c.id === nfeMap.get(id)?.company_id)?.cnpj);
      const resolved = resolveLabelSender(settings.remetente as any, issuer);
      if (!resolved.sender) { if (b.dry_run) return reply({ dry_run: true, ok: false, problems: [resolved.problem], summary: { ...summaryBase, nfes: nfes.map((n) => ({ numero: n.numero, serie: n.serie, chave: n.chave })) } }); throw fail(resolved.problem!); }
      const { payload, problems } = buildPrePostagemPayload({ sender: resolved.sender, sale, serviceCode: String(option.service_code), pkg: quote.package as any, nfes, reference: sale.id.slice(0, 8) });
      const summary = { ...summaryBase, remetente: { nome: payload.remetente.nome, cnpj: payload.remetente.cpfCnpj }, nfes: nfes.map((n) => ({ numero: n.numero, serie: n.serie, chave: n.chave })) };
      if (b.dry_run) return reply({ dry_run: true, simulated: !!b.simulate_service_code, ok: !problems.length, problems, payload, summary });
      if (problems.length) throw fail(problems.join('; '));
      const ins = await db.from('correios_shipments').insert({ sale_id: sale.id, group_id: sale.expedition_group_id, sale_ids: ids, servico_codigo: option.service_code, servico_nome: option.service, status: 'criada', request: payload, nfe_chaves: nfes.map((n) => n.chave), package: quote.package, price: option.price, created_by: userId }).select('*').single();
      if (ins.error) {
        const { data: again } = await db.from('correios_shipments').select('*').eq('sale_id', sale.id).not('status', 'in', ACTIVE).maybeSingle();
        if (again) return reply({ shipment: await withUrls(again), existing: true });
        throw new Error('Não foi possível registrar o envio');
      }
      let shipment = ins.data;
      try {
        const auth = await getCorreiosToken(db, { settings });
        const res: any = await createCorreiosFetch(auth.settings, auth.token)('/v1/prepostagens', { method: 'POST', body: JSON.stringify(payload) });
        if (!res?.id) throw new Error('Correios: pré-postagem sem identificador na resposta');
        const patch = { prepostagem_id: String(res.id), codigo_objeto: res.codigoObjeto || null, response: { id: res.id, codigoObjeto: res.codigoObjeto, statusAtual: res.statusAtual, descStatusAtual: res.descStatusAtual, prazoPostagem: res.prazoPostagem } };
        await db.from('correios_shipments').update(patch).eq('id', shipment.id);
        shipment = { ...shipment, ...patch };
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Correios: falha ao criar pré-postagem';
        await db.from('correios_shipments').update({ status: 'erro', error_message: msg }).eq('id', shipment.id);
        throw fail(msg, 502);
      }
      try { shipment = await emitLabel(shipment); }
      catch (e) { const msg = e instanceof Error ? e.message : 'Falha ao emitir rótulo'; await db.from('correios_shipments').update({ error_message: msg }).eq('id', shipment.id); shipment.error_message = msg; }
      return reply({ shipment: await withUrls(shipment) });
    }

    if (b.action === 'label') {
      let shipment = await getShipment(b.shipment_id);
      if (['cancelada', 'erro'].includes(shipment.status) || !shipment.prepostagem_id) throw fail('Este envio não está ativo');
      if (!shipment.label_path || !shipment.codigo_objeto) shipment = await emitLabel(shipment);
      else if (!shipment.combined_path) {
        const { data } = await db.storage.from(BUCKET).download(shipment.label_path);
        if (!data) throw new Error('Rótulo salvo não encontrado');
        const combined_path = await buildCombined(shipment, new Uint8Array(await data.arrayBuffer()));
        await db.from('correios_shipments').update({ combined_path }).eq('id', shipment.id);
        shipment.combined_path = combined_path;
      }
      return reply({ shipment: await withUrls(shipment) });
    }

    if (b.action === 'cancel') {
      const shipment = await getShipment(b.shipment_id);
      if (shipment.status === 'postada') throw fail('Objeto já postado não pode ser cancelado');
      if (shipment.status === 'cancelada') return reply({ shipment: await withUrls(shipment) });
      if (shipment.prepostagem_id) {
        const settings = await loadCorreiosSettings(db);
        const auth = await getCorreiosToken(db, { settings });
        await createCorreiosFetch(auth.settings, auth.token)(`/v1/prepostagens/${encodeURIComponent(shipment.prepostagem_id)}`, { method: 'DELETE' });
      }
      const patch = { status: 'cancelada', cancelled_at: new Date().toISOString(), cancelled_by: userId, cancel_reason: b.reason };
      await db.from('correios_shipments').update(patch).eq('id', shipment.id);
      if (shipment.codigo_objeto) await db.from('pos_sales').update({ tracking_code: null, tracking_carrier: null, tracking_url: null }).in('id', shipment.sale_ids).eq('tracking_code', shipment.codigo_objeto);
      return reply({ shipment: await withUrls({ ...shipment, ...patch }) });
    }

    // batch_labels
    const { data: rows, error } = await db.from('correios_shipments').select('id,sale_id,combined_path,status').in('id', b.shipment_ids).eq('status', 'rotulo_emitido').not('combined_path', 'is', null).order('created_at').limit(50);
    if (error || !rows?.length) throw fail('Nenhuma etiqueta emitida para imprimir');
    const saleIds = rows.map((r) => r.sale_id);
    const { data: visible } = await userClient.from('pos_sales').select('id').in('id', saleIds).limit(50);
    if ((visible || []).length !== new Set(saleIds).size) throw fail('Sem acesso a algum pedido do lote', 403);
    const files: Uint8Array[] = [];
    for (const r of rows) { const { data } = await db.storage.from(BUCKET).download(r.combined_path!); if (data) files.push(new Uint8Array(await data.arrayBuffer())); }
    const merged = await concatPdfs(files);
    const path = `lotes/${crypto.randomUUID()}.pdf`;
    const up = await db.storage.from(BUCKET).upload(path, merged, { contentType: 'application/pdf' });
    if (up.error) throw new Error('Não foi possível montar o lote');
    return reply({ url: await sign(path), count: files.length });
  } catch (e) {
    const err = e as Error & { status?: number };
    return reply({ error: err.message || 'Falha no envio Correios' }, err.status || 400);
  }
});
