import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { returnDiscountRatio, returnLineValues, isUndiscountedReverse } from '../../supabase/functions/_shared/devolucao-values';
import { decideDevolucao } from '../../supabase/functions/_shared/devolucao-guard';
import { parseXmlDest, parseXmlItems, matchXmlItem, mergeDest, cfopEntrada, precheckDevolucao, missingAddressMessage, cstEntradaPisCofins } from '../../supabase/functions/_shared/devolucao-dest';

const cases = [
  ['181', 359.99, 0, 359.99], ['182', 359.99, 0, 359.99],
  ['183', 459.99, 0, 459.99], ['189', 359.99, 0, 359.99],
  ['191', 399.99, 139.99, 260], ['184', 359.99, 36, 323.99],
  ['193', 359.99, 0, 359.99], ['194', 359.99, 36, 323.99],
] as const;

// Execute the actual handler with an in-memory read-only database. All writes
// and all fetch calls throw: a dry_run crossing the safety boundary fails.
async function dryRun(price: number, discount: number, expected: number, existing = true, exchange = false, unmatched = false) {
  let handler: ((req: Request) => Promise<Response>) | undefined;
  const writes = vi.fn(() => { throw new Error('Forbidden write'); });
  const fetch = vi.fn(() => { throw new Error('Forbidden provider call'); });
  const item = { id: 'item', unit_price: price, quantity: 1, sku: 'sku', barcode: 'barcode' };
  const doc = { id: 'doc', status: 'authorized', valor_total: expected, numero: 3027, chave_acesso: '1'.repeat(44) };
  const evt = { pedido_original_id: 'sale', devolucao_doc_id: existing ? 'doc' : null,
    trocas_devolucoes_itens: [{ direcao: 'devolvido', estado_estoque: 'retornado_vendavel', quantidade: 1, sku: unmatched ? 'missing' : 'sku', valor_unitario: expected }] };
  const db = { from(table: string) {
    let cols = ''; const filters: [string, unknown][] = [];
    const result = () => {
      if (table === 'correios_reverse_shipments') return cols.includes('return_items')
        ? { id: 'rv', sale_id: 'sale', devolucao_doc_id: existing ? 'doc' : null,
          return_items: [{ sale_item_id: 'item', sku: 'sku', quantidade: 1, valor_unitario: price }] }
        : existing ? [{ id: 'rv', devolucao_doc_id: 'doc' }] : [];
      if (table === 'pos_sales') return { id: 'sale', discount, total: expected, customer_name: 'Cliente Teste', customer_cpf: '52998224725', pos_sale_items: [item] };
      if (table === 'companies') return { brasilnfe_token: 'fake-test-only', address_state: 'MG' };
      if (table === 'trocas_devolucoes') return cols.includes('trocas_devolucoes_itens') ? evt : [];
      if (table === 'fiscal_documents') {
        if (cols === 'chave_acesso, modelo, company_id') return { chave_acesso: '1'.repeat(44), company_id: 'company' };
        if (cols === 'valor_total') return { valor_total: price };
        if (filters.some(([key]) => key === 'ref_chave_acesso')) return existing ? [doc] : [];
        return existing ? doc : null;
      }
      throw new Error(`Unexpected table ${table}`);
    };
    const q: any = { select(c: string) { cols = c; return q; },
      eq(k: string, v: unknown) { filters.push([k, v]); return q; },
      not: () => q, in: () => q, order: () => q, limit: () => q,
      maybeSingle: async () => ({ data: result() }), single: async () => ({ data: result() }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: result() }).then(resolve),
      update: writes, insert: writes };
    return q;
  } };
  const source = readFileSync('supabase/functions/nfe-devolucao-emitir/index.ts', 'utf8')
    .replace(/^import .*;\r?\n/gm, '');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  runInNewContext(js, { Deno: { env: { get: () => 'fake-test-only' }, serve: (fn: typeof handler) => { handler = fn; } },
    createClient: () => db, withAccessLog: (_: string, fn: unknown) => fn, requireStaffOrInternal: async () => null,
    returnDiscountRatio, returnLineValues, isUndiscountedReverse, decideDevolucao,
    parseXmlDest, parseXmlItems, matchXmlItem, mergeDest, cfopEntrada, precheckDevolucao, missingAddressMessage, cstEntradaPisCofins, cstEntradaRule: cstEntradaPisCofins,
    Request, Response, URL, fetch, console });
  if (!handler) throw new Error('Handler not registered');
  const response = await handler(new Request('https://test.invalid', { method: 'POST', body: JSON.stringify({
    ...(exchange ? { troca_devolucao_id: 'td' } : { reverse_shipment_id: 'rv' }), dry_run: true,
  }) }));
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.dry_run).toBe(true);
  expect(writes).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  return body;
}

describe('devolução com desconto único — SQL reproduzido em dry_run', () => {
  for (const [td, price, discount, expected] of cases) {
    it(`TD-${td}: valor líquido ${expected}, sem emissão`, async () => {
      const result = await dryRun(price, discount, expected);
      expect(result.valor_novo).toBe(expected);
      expect(result.decision.action).toBe('reuse');
      expect(result.produtos[0].ValorTotal - (result.produtos[0].ValorDesconto || 0)).toBeCloseTo(expected, 2);
    });
  }
  it('reversa nova com desconto usa 323,99 e segue elegível para emissão futura', async () => {
    const result = await dryRun(359.99, 36, 323.99, false);
    expect(result.valor_novo).toBe(323.99);
    expect(result.decision.action).toBe('emit');
  });
  it('troca e reversa usam exatamente a mesma linha fiscal', async () => {
    const reverse = await dryRun(399.99, 139.99, 260);
    const exchange = await dryRun(399.99, 139.99, 260, true, true);
    expect(exchange.produtos).toEqual(reverse.produtos);
  });
  it('sem item original correspondente não desconta de novo o valor líquido salvo', async () => {
    const result = await dryRun(359.99, 36, 323.99, true, true, true);
    expect(result.valor_novo).toBe(323.99);
    expect(result.desconto_rateado).toBe(0);
  });
  it('devolução parcial rateia só o desconto proporcional ao item retornado', () => {
    const ratio = returnDiscountRatio([{ unit_price: 100, quantity: 2 }, { unit_price: 100, quantity: 1 }], 30);
    expect(returnLineValues(100, 1, ratio)).toEqual({ unitPrice: 100, gross: 100, discount: 10, net: 90 });
  });
  it('vínculo existente associa uma nova nota simulada à única troca aberta', async () => {
    const source = readFileSync('supabase/functions/correios-reverse/index.ts', 'utf8');
    const start = source.indexOf("const { data: open } = await db.from('trocas_devolucoes')");
    const end = source.indexOf("} catch (e) { console.error('[correios-reverse] vínculo", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const patches: { table: string; patch: unknown }[] = [];
    const db = { from(table: string) {
      const q: any = { select: () => q, eq: () => q, not: () => q, limit: () => q, is: () => q,
        update: (patch: unknown) => { patches.push({ table, patch }); return q; },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: 'open-td', devolucao_doc_id: null }] }).then(resolve) };
      return q;
    } };
    const js = ts.transpileModule(`(async () => { ${source.slice(start, end)} })()`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText;
    await runInNewContext(js, { db, row: { sale_id: 'sale' }, doc: { id: 'simulated-doc', chave_acesso: '2'.repeat(44) } });
    expect(patches).toEqual([
      { table: 'fiscal_documents', patch: { troca_devolucao_id: 'open-td' } },
      { table: 'trocas_devolucoes', patch: { devolucao_doc_id: 'simulated-doc', chave_devolucao: '2'.repeat(44) } },
    ]);
  });
  it('diagnóstico de desconto ausente exige NF reversa autorizada pelo valor bruto', () => {
    const base = { reason: 'divergente', reverseLinked: true, authorized: true, issued: 359.99, gross: 359.99, net: 323.99 };
    expect(isUndiscountedReverse(base)).toBe(true);
    expect(isUndiscountedReverse({ ...base, issued: 323.99, net: 291.59 })).toBe(false);
    expect(isUndiscountedReverse({ ...base, reverseLinked: false })).toBe(false);
    expect(isUndiscountedReverse({ ...base, authorized: false })).toBe(false);
  });
});