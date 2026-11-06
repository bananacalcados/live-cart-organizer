import { withAccessLog } from "../_shared/withAccessLog.ts";
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';
import { freightAuth } from '../_shared/freight-auth.ts';
import { loadCorreiosSettings, getCorreiosToken, createCorreiosFetch } from '../_shared/correios.ts';
import { extractPdfBase64 } from '../_shared/correios-prepost-domain.ts';
import { buildReversePayload, reverseValidity, reverseReturnItems, REVERSE_SERVICES, REVERSE_DEFAULT_PACKAGE } from '../_shared/correios-reverse-domain.ts';
import { internalCallHeaders } from '../_shared/requireAuth.ts';

const BUCKET = 'correios-labels';
const customer = z.object({
  nome: z.string().trim().min(3).max(80), cpf: z.string().max(20).optional().nullable(), telefone: z.string().min(10).max(20), email: z.string().max(255).optional().nullable(),
  cep: z.string().max(10), logradouro: z.string().trim().min(1).max(120), numero: z.string().trim().max(20), complemento: z.string().max(60).optional().nullable(),
  bairro: z.string().trim().min(1).max(80), cidade: z.string().trim().min(1).max(80), uf: z.string().trim().length(2),
});
const body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('services') }),
  z.object({ action: z.literal('list'), phone: z.string().min(8).max(20) }),
  z.object({
    action: z.literal('create'), idempotency_key: z.string().min(8).max(80), customer, service_code: z.string().regex(/^\d{5}$/),
    package: z.object({ peso_g: z.number().int().min(100).max(30000), c: z.number().min(15).max(100), l: z.number().min(10).max(100), a: z.number().min(1).max(100) }).optional(),
    return_items: z.array(z.object({ sale_item_id: z.string().uuid(), quantidade: z.number().int().min(1).max(99) })).min(1).max(30),
    reason: z.string().max(200).optional().nullable(), sale_id: z.string().uuid(), dry_run: z.boolean().optional(),
  }),
  z.object({ action: z.literal('sales'), phone: z.string().min(8).max(20) }),
  z.object({ action: z.literal('retry'), id: z.string().uuid() }),
  z.object({ action: z.literal('label'), id: z.string().uuid() }),
  z.object({ action: z.literal('check'), id: z.string().uuid() }),
  z.object({ action: z.literal('mark_sent'), id: z.string().uuid() }),
  z.object({ action: z.literal('cancel'), id: z.string().uuid() }),
]);
const COLS = 'id,created_at,customer_name,customer_phone,servico_codigo,servico_nome,valid_until,status,codigo_objeto,label_path,error_message,sent_at,reason,sale_id,devolucao_doc_id';
const NO_PDF_MSG = 'Na logística reversa os Correios não geram PDF antes da postagem: a cliente só informa o código na agência.';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fail = (msg: string, status = 400) => Object.assign(new Error(msg), { status });
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

Deno.serve(withAccessLog("correios-reverse", async (req) => {
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { db, userId } = await freightAuth(req, false);
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return reply({ error: 'Requisição inválida', details: parsed.error.flatten().fieldErrors }, 400);
    const b = parsed.data;
    const sign = async (p: string | null) => p ? (await db.storage.from(BUCKET).createSignedUrl(p, 3600)).data?.signedUrl || null : null;
    const docInfo = async (ids: string[]) => {
      const m = new Map<string, any>();
      const u = [...new Set(ids.filter(Boolean))];
      if (u.length) { const { data } = await db.from('fiscal_documents').select('id,status,numero,chave_acesso,danfe_url,rejection_message').in('id', u); for (const d of data || []) m.set(d.id, d); }
      return m;
    };
    const decorate = (r: any, docs: Map<string, any>) => { const d = r.devolucao_doc_id ? docs.get(r.devolucao_doc_id) : null; return { nfe_devolucao: d ? { status: d.status, numero: d.numero, chave: d.chave_acesso, danfe_url: d.danfe_url, erro: d.rejection_message } : null }; };
    const withUrl = async (r: any) => ({ ...r, label_url: await sign(r.label_path), ...decorate(r, await docInfo([r.devolucao_doc_id])) });
    const get = async (id: string) => {
      const { data } = await db.from('correios_reverse_shipments').select('*').eq('id', id).maybeSingle();
      if (!data) throw fail('Reversa não encontrada', 404);
      return data;
    };
    const cws = async () => { const settings = await loadCorreiosSettings(db); if (!settings.enabled) throw fail('Integração Correios desativada no Admin'); const auth = await getCorreiosToken(db, { settings }); return { settings: auth.settings, cf: createCorreiosFetch(auth.settings, auth.token) }; };

    const emitLabel = async (row: any) => {
      const { settings, cf } = await cws();
      let recibo = row.response?.label_recibo as string | undefined;
      if (!recibo) {
        const r: any = await cf('/prepostagem/v1/prepostagens/rotulo/assincrono/pdf', { method: 'POST', body: JSON.stringify({ idsPrePostagem: [row.prepostagem_id], numeroCartaoPostagem: settings.cartao_postagem, tipoRotulo: 'P', formatoRotulo: 'ET', imprimeRemetente: 'S', layoutImpressao: 'LINEAR_100_150' }) });
        recibo = r?.idRecibo || r?.reciboSolicitacao || r?.id;
        if (!recibo) throw new Error('Correios: não retornou o recibo da etiqueta');
        row.response = { ...(row.response || {}), label_recibo: recibo };
        await db.from('correios_reverse_shipments').update({ response: row.response, updated_at: new Date().toISOString() }).eq('id', row.id);
      }
      let pdf: Uint8Array | null = null, lastErr = '';
      for (let i = 0; i < 6 && !pdf; i++) {
        if (i) await sleep(1500);
        try {
          const d: any = await cf(`/prepostagem/v1/prepostagens/rotulo/download/assincrono/${encodeURIComponent(recibo)}`, { method: 'GET' });
          // Reverse pre-postages stay "Pendente" until the customer posts: Correios refuse the PDF (PPN-288) — the code alone is what the agency uses.
          if (typeof d?.mensagem === 'string' && d.mensagem.includes('PPN-288')) throw Object.assign(new Error(NO_PDF_MSG), { noPdf: true });
          if (d?.pdfBytes) pdf = d.pdfBytes; else { const s = extractPdfBase64(d); if (s) pdf = fromB64(s); }
        }
        catch (e) { if ((e as any)?.noPdf) throw e; lastErr = e instanceof Error ? e.message : String(e); continue; }
      }
      if (!pdf) throw new Error(lastErr || 'Correios: etiqueta ainda em processamento. Tente de novo em instantes');
      const path = `reversa/${row.id}/etiqueta.pdf`;
      const up = await db.storage.from(BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: true });
      if (up.error) throw new Error('Não foi possível salvar a etiqueta');
      let code = row.codigo_objeto as string | null;
      if (!code) {
        const one: any = await cf(`/prepostagem/v1/prepostagens/${encodeURIComponent(row.prepostagem_id)}`, { method: 'GET' }).catch(() => null);
        code = one?.codigoObjeto || null;
      }
      const patch = { label_path: path, codigo_objeto: code, status: 'rotulo_emitido', error_message: null, updated_at: new Date().toISOString() };
      await db.from('correios_reverse_shipments').update(patch).eq('id', row.id);
      return { ...row, ...patch };
    };

    if (b.action === 'services') {
      // Diagnostic: shows which reverse services this contract/card accepts (no pre-postage created).
      const { settings, cf } = await cws();
      const cnpj = String((settings.token_meta as any)?.cnpj || settings.remetente?.cnpj || '').replace(/\D/g, '');
      const tries = [
        `/meucontrato/v1/empresas/${cnpj}/contratos/${settings.contrato}/cartoes/${settings.cartao_postagem}/servicos?page=0&size=100`,
        `/meucontrato/v1/empresas/${cnpj}/contratos/${settings.contrato}/servicos?page=0&size=100`,
      ];
      const out: any[] = [];
      for (const p of tries) { try { out.push({ path: p.split('?')[0], data: await cf(p, { method: 'GET' }) }); break; } catch (e) { out.push({ path: p.split('?')[0], error: e instanceof Error ? e.message : String(e) }); } }
      return reply({ known: REVERSE_SERVICES, results: out });
    }

    if (b.action === 'list') {
      const key = b.phone.replace(/\D/g, '').slice(-8);
      const { data, error } = await db.from('correios_reverse_shipments').select(COLS).eq('phone_key', key).order('created_at', { ascending: false }).limit(20);
      if (error) throw new Error('Não foi possível listar as reversas');
      const docs = await docInfo((data || []).map((r: any) => r.devolucao_doc_id));
      return reply({ items: await Promise.all((data || []).map(async (r: any) => ({ ...r, label_url: await sign(r.label_path), ...decorate(r, docs) }))) });
    }

    if (b.action === 'sales') {
      // Vendas da cliente (últimas 15, por final do telefone) com NF-e autorizada — base da devolução.
      const key = b.phone.replace(/\D/g, '').slice(-8);
      const { data: sales } = await db.from('pos_sales').select('id,created_at,total,discount,customer_name,customer_cpf').eq('phone_suffix8', key).order('created_at', { ascending: false }).limit(15);
      const ids = (sales || []).map((x: any) => x.id);
      if (!ids.length) return reply({ sales: [] });
      const [{ data: its }, { data: nfs }] = await Promise.all([
        db.from('pos_sale_items').select('id,sale_id,product_name,quantity,unit_price,sku,barcode').in('sale_id', ids).limit(500),
        db.from('fiscal_documents').select('pos_sale_id,numero,modelo,chave_acesso').in('pos_sale_id', ids).eq('status', 'authorized').eq('tipo_operacao', 'saida').in('modelo', [55, 65]).not('chave_acesso', 'is', null),
      ]);
      return reply({ sales: (sales || []).map((x: any) => ({ ...x, nfe: (nfs || []).find((n: any) => n.pos_sale_id === x.id) || null, items: (its || []).filter((i: any) => i.sale_id === x.id) })) });
    }

    // Emite (ou reaproveita) a NF-e de devolução e só então registra a pré-postagem nos Correios.
    const finish = async (row: any) => {
      const settings = await loadCorreiosSettings(db);
      const store = { ...(settings.remetente as any), nome: (settings.remetente as any)?.nome_etiqueta || 'Banana Calçados' };
      const markErr = async (msg: string) => { await db.from('correios_reverse_shipments').update({ status: 'erro', error_message: msg, updated_at: new Date().toISOString() }).eq('id', row.id); throw Object.assign(fail(msg, 502), { marked: true }); };
      let nf: any = null;
      try {
        const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/nfe-devolucao-emitir`, { method: 'POST', headers: { ...(await internalCallHeaders()), 'Content-Type': 'application/json' }, body: JSON.stringify({ reverse_shipment_id: row.id }) });
        nf = await r.json().catch(() => null);
      } catch (e) { nf = { error: e instanceof Error ? e.message : String(e) }; }
      if (nf?.skip) await markErr('A venda não tem NF-e autorizada; sem ela não dá para emitir a nota de devolução');
      if (nf?.status !== 'authorized') await markErr(nf?.contingencia ? 'Nota de devolução na fila da SEFAZ (fora do ar). Tente "Tentar de novo" em alguns minutos' : `Nota de devolução não autorizada: ${String(nf?.error || nf?.message || 'erro desconhecido').slice(0, 220)}`);
      const { data: doc } = await db.from('fiscal_documents').select('id,numero,chave_acesso').eq('id', nf.document_id).maybeSingle();
      if (!doc?.chave_acesso || !doc?.numero) await markErr('Nota de devolução autorizada sem número/chave — confira no Fiscal');
      row.devolucao_doc_id = doc!.id;
      // Quem recebe a mercadoria é quem emitiu a nota de entrada: o CNPJ do destinatário precisa ser o da chave da nota.
      const emitCnpj = String(doc!.chave_acesso).slice(6, 20);
      if (/^\d{14}$/.test(emitCnpj)) store.cnpj = emitCnpj;
      const ad = row.address || {};
      const cust = { nome: row.customer_name, cpf: row.customer_cpf, telefone: row.customer_phone, email: row.request?.remetente?.email || null, cep: ad.cep, logradouro: ad.logradouro, numero: ad.numero, complemento: ad.complemento, bairro: ad.bairro, cidade: ad.cidade, uf: ad.uf };
      const valid = reverseValidity(new Date());
      const decl = (row.return_items || []).map((i: any) => ({ conteudo: i.nome, quantidade: i.quantidade, valor: i.valor_pago }));
      const { payload, problems } = buildReversePayload({ customer: cust, store, serviceCode: row.servico_codigo, pkg: row.package || REVERSE_DEFAULT_PACKAGE, items: decl, validUntilBr: valid.br, reference: row.idempotency_key.slice(0, 8), invoice: { numero: doc!.numero, chave: doc!.chave_acesso } });
      if (problems.length) await markErr(problems.join('; '));
      await db.from('correios_reverse_shipments').update({ request: payload, valid_until: valid.iso, status: 'criada', error_message: null, updated_at: new Date().toISOString() }).eq('id', row.id);
      row = { ...row, request: payload, valid_until: valid.iso, status: 'criada', error_message: null };
      try {
        const { cf } = await cws();
        const res: any = await cf('/prepostagem/v1/prepostagens', { method: 'POST', body: JSON.stringify({ ...payload, numeroCartaoPostagem: settings.cartao_postagem }) });
        if (!res?.id) throw new Error('Correios: pré-postagem reversa sem identificador');
        const patch = { prepostagem_id: String(res.id), codigo_objeto: res.codigoObjeto || null, response: { id: res.id, codigoObjeto: res.codigoObjeto, statusAtual: res.statusAtual, prazoPostagem: res.prazoPostagem, dataValidadeLogReversa: res.dataValidadeLogReversa }, updated_at: new Date().toISOString() };
        await db.from('correios_reverse_shipments').update(patch).eq('id', row.id);
        row = { ...row, ...patch };
      } catch (e) {
        if ((e as any)?.marked) throw e;
        await markErr(e instanceof Error ? e.message : 'Correios: falha ao criar a reversa');
      }
      try { row = await emitLabel(row); }
      catch (e) { if ((e as any)?.noPdf) return row; const msg = e instanceof Error ? e.message : 'Falha ao emitir etiqueta'; await db.from('correios_reverse_shipments').update({ error_message: msg }).eq('id', row.id); row.error_message = msg; }
      return row;
    };

    if (b.action === 'create') {
      const svc = REVERSE_SERVICES.find((s) => s.codigo === b.service_code);
      if (!svc) throw fail('Serviço de reversa inválido');
      const { data: existing } = await db.from('correios_reverse_shipments').select('*').eq('idempotency_key', b.idempotency_key).maybeSingle();
      if (existing && !b.dry_run) return reply({ item: await withUrl(existing), existing: true });
      const key = b.customer.telefone.replace(/\D/g, '').slice(-8);
      const { data: sale } = await db.from('pos_sales').select('id,discount,phone_suffix8').eq('id', b.sale_id).maybeSingle();
      if (!sale) throw fail('Venda original não encontrada');
      if (sale.phone_suffix8 && sale.phone_suffix8 !== key) throw fail('Esta venda não é deste telefone');
      const { data: saleItems } = await db.from('pos_sale_items').select('id,product_name,quantity,unit_price,sku,barcode').eq('sale_id', sale.id).limit(200);
      const ret = reverseReturnItems(saleItems || [], b.return_items, Number(sale.discount || 0));
      if (ret.problems.length) throw fail(ret.problems.join('; '));
      const cpf = String(b.customer.cpf || '').replace(/\D/g, '');
      if (cpf.length !== 11) throw fail('CPF da cliente é obrigatório: ela é a remetente e a nota de devolução sai no nome dela');
      const settings = await loadCorreiosSettings(db);
      const store = { ...(settings.remetente as any), nome: (settings.remetente as any)?.nome_etiqueta || 'Banana Calçados' };
      const valid = reverseValidity(new Date());
      const pkg = b.package || REVERSE_DEFAULT_PACKAGE;
      // Prévia sem nota (a nota real entra em finish): valida os dados antes de emitir qualquer documento fiscal.
      const decl = ret.items.map((i) => ({ conteudo: i.nome, quantidade: i.quantidade, valor: i.valor_pago }));
      const { payload, problems } = buildReversePayload({ customer: b.customer, store, serviceCode: svc.codigo, pkg, items: decl, validUntilBr: valid.br, reference: b.idempotency_key.slice(0, 8) });
      if (b.dry_run) return reply({ dry_run: true, ok: !problems.length, problems, payload, return_items: ret.items });
      if (problems.length) throw fail(problems.join('; '));
      const ins = await db.from('correios_reverse_shipments').insert({
        created_by: userId, customer_name: b.customer.nome, customer_phone: b.customer.telefone, customer_cpf: cpf,
        address: { cep: b.customer.cep, logradouro: b.customer.logradouro, numero: b.customer.numero, complemento: b.customer.complemento, bairro: b.customer.bairro, cidade: b.customer.cidade, uf: b.customer.uf },
        sale_id: sale.id, return_items: ret.items, reason: b.reason || null, servico_codigo: svc.codigo, servico_nome: svc.nome, package: pkg, valid_until: valid.iso, request: payload, idempotency_key: b.idempotency_key,
      }).select('*').single();
      if (ins.error) {
        const { data: again } = await db.from('correios_reverse_shipments').select('*').eq('idempotency_key', b.idempotency_key).maybeSingle();
        if (again) return reply({ item: await withUrl(again), existing: true });
        throw new Error('Não foi possível registrar a reversa');
      }
      return reply({ item: await withUrl(await finish(ins.data)) });
    }

    if (b.action === 'retry') {
      // Reaproveita a mesma reversa (e a mesma nota, se já autorizada) — nunca emite nota em dobro.
      const row = await get(b.id);
      if (row.prepostagem_id || row.status !== 'erro') throw fail('Esta reversa não está com erro');
      if (!row.sale_id || !row.return_items) throw fail('Reversa antiga sem venda vinculada: gere uma nova');
      return reply({ item: await withUrl(await finish(row)) });
    }

    if (b.action === 'label') {
      let row = await get(b.id);
      if (!row.prepostagem_id || ['cancelada', 'erro'].includes(row.status)) throw fail('Esta reversa não está ativa');
      if (!row.label_path) { try { row = await emitLabel(row); } catch (e) { if ((e as any)?.noPdf) throw fail(NO_PDF_MSG); throw e; } }
      return reply({ item: await withUrl(row) });
    }

    if (b.action === 'check') {
      // Read-only: asks Correios what they have registered for this pre-postage.
      const row = await get(b.id);
      if (!row.prepostagem_id) throw fail('Esta reversa não chegou a ser registrada nos Correios');
      const { cf } = await cws();
      let one: any = null;
      const tries = [`/prepostagem/v2/prepostagens?codigoObjeto=${encodeURIComponent(row.codigo_objeto || '')}&page=0&size=1`, `/prepostagem/v2/prepostagens?id=${encodeURIComponent(row.prepostagem_id)}&page=0&size=1`];
      const errs: string[] = [];
      for (const p of tries) { try { const r: any = await cf(p, { method: 'GET' }); one = r?.itens?.[0] || r?.content?.[0] || r; break; } catch (e) { errs.push(e instanceof Error ? e.message : String(e)); } }
      if (!one) one = { errors: errs };
      let label: any = null;
      const recibo = row.response?.label_recibo;
      if (recibo) { try { const d: any = await cf(`/prepostagem/v1/prepostagens/rotulo/download/assincrono/${encodeURIComponent(recibo)}`, { method: 'GET' }); label = d?.pdfBytes ? { pdf: true } : (d && typeof d === 'object' ? Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typeof v === 'string' && v.length > 200 ? `[${v.length} chars]` : v])) : d); } catch (e) { label = { error: e instanceof Error ? e.message : String(e) }; } }
      const pick = (o: any) => o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).filter(([k]) => /codigo|status|valid|prazo|autoriz|tipo|logReversa|servico/i.test(k))) : o;
      return reply({ correios: pick(one), raw_keys: one && typeof one === "object" ? Object.keys(one).slice(0, 40) : null, raw: JSON.stringify(one).slice(0, 1500), label });
    }

    if (b.action === 'mark_sent') {
      const { data } = await db.from('correios_reverse_shipments').update({ sent_at: new Date().toISOString() }).eq('id', b.id).is('sent_at', null).select(COLS).maybeSingle();
      return reply({ item: data ? await withUrl(data) : await withUrl(await get(b.id)) });
    }

    if (b.action === 'cancel') {
      const row = await get(b.id);
      if (row.status === 'postada' || row.status === 'entregue') throw fail('Objeto já postado não pode ser cancelado');
      if (row.status === 'cancelada') return reply({ item: await withUrl(row) });
      if (row.prepostagem_id) { const { cf } = await cws(); await cf(`/prepostagem/v1/prepostagens/${encodeURIComponent(row.prepostagem_id)}`, { method: 'DELETE' }); }
      await db.from('correios_reverse_shipments').update({ status: 'cancelada', updated_at: new Date().toISOString() }).eq('id', row.id);
      return reply({ item: await withUrl({ ...row, status: 'cancelada' }) });
    }
    return reply({ error: 'Ação desconhecida' }, 400);
  } catch (e) {
    const status = (e as any)?.status || 500;
    return reply({ error: e instanceof Error ? e.message : 'Erro inesperado' }, status);
  }
}));
