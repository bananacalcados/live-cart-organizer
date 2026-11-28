import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import baseline from './fixtures/shopify-before-phases.json';
import { appendDraftMedia } from '@/lib/marketing/draftMediaCaption';
import { getOfficialProductUrl } from '@/lib/marketing/officialProductUrl';
import { whatsappSendCandidates } from '@/lib/whatsapp/erpProductPhotos';
import { variantsFromShopify } from '@/lib/liveCatalog';
import {
  __resetLiveProductSource, __resetProductSource, erpMasterOf, erpOnlyItems,
  fetchCrossellProducts, getProductSource, isErpOnlyId, isShopifyVariantGid, orderItemIdentity, promoKeyOf,
} from '@/lib/liveProductSource';
import { erpMasterFromId } from '@/lib/marketing/erpMarketing';

const { fetchProducts, rpc } = vi.hoisted(() => ({ fetchProducts: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/shopify', () => ({ fetchProducts }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));

// Execute the real handlers with in-memory dependencies, not a rewritten copy of their rules.
// Frozen fixture was extracted verbatim with git show 89e788d95:<path>; no Git access at test runtime.
function extract(source: string, name: string): string {
  const file = ts.createSourceFile('handler.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let result: string | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name && node.initializer) result = node.initializer.getText(file);
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node.getText(file).replace(/^export\s+/, '');
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!result) throw new Error(`Handler not found: ${name}`);
  return result;
}
function current(path: string, name: string) { return extract(readFileSync(path, 'utf8'), name); }
function executable(source: string, context: Record<string, unknown>, declaration?: string): (...args: any[]) => any {
  const code = declaration ? `${source}; return ${declaration};` : `return (${source});`;
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(context), js)(...Object.values(context));
}
const image = 'https://fotos.servidorbanana.com/tenis_m.webp';
function product(id = 'gid://shopify/Product/42', variantId = 'legacy-variant') {
  return { node: { id, title: 'Tênis', handle: 'tenis', priceRange: { minVariantPrice: { amount: '159.99' } },
    images: { edges: [{ node: { url: image } }] }, variants: { edges: [{ node: {
      id: variantId, sku: 'SKU37', title: 'Preto / 37', selectedOptions: [{ name: 'Cor', value: 'Preto' }, { name: 'Tamanho', value: '37' }],
      price: { amount: '159.99' }, image: { url: image },
    } }] } } } as any;
}
const scheduled = current('src/components/marketing/ScheduledMessageForm.tsx', 'selectShopifyProduct');
async function select(source: string, p: any, mode = 'photo_only', forLink = false) {
  let blocks: any[] = [{ id: 'block', type: mode === 'photo_only' ? 'image' : 'text', content: 'Oferta', mediaItems: [], vipLinkProduct: null }];
  const context = {
    blocks, shopifyTargetBlockId: 'block', shopifyForLink: forLink, shopifySendMode: mode,
    updateBlock: (id: string, value: any) => { blocks = blocks.map(b => b.id === id ? value : b); },
    setBlocks: (fn: (value: any[]) => any[]) => { blocks = fn(blocks); }, createBlock: (type: string) => ({ id: 'new', type }),
    setShowShopifyPicker: vi.fn(), setShopifyForLink: vi.fn(), toast: { success: vi.fn(), error: vi.fn() },
    appendDraftMedia, getOfficialProductUrl, whatsappSendCandidates, erpMasterOf, getProductSource, erpMasterFromId,
  };
  await executable(source, context)(p, image);
  return blocks;
}
beforeEach(() => {
  vi.clearAllMocks();
  __resetLiveProductSource('shopify');
  for (const key of ['product_source_crossell', 'product_source_whatsapp', 'product_source_marketing'] as const) __resetProductSource(key, 'shopify');
});
describe('89e788d95 → atual: Shopify sem mudanças', () => {
  it.each([['photo_only', false], ['photo_only', true], ['link', false]] as const)('VIP: mesma gravação em %s (link=%s)', async (mode, link) => {
    const before = await select(baseline.scheduledSelect, product(), mode, link);
    const after = await select(scheduled, product(), mode, link);
    expect(after).toEqual(before);
    if (mode === 'photo_only' && !link) expect(after[0].mediaItems[0].url).toBe(image);
  });
  it('Marketing Shopify não converte nem um produto com procedência ERP persistida', async () => {
    const p = product(); p.node.variants.edges[0].node.erp = { masterId: 'master', variantId: 'variant' };
    expect((await select(scheduled, p))[0].mediaItems[0].url).toBe(image);
  });
  it('Marketing ERP não converte produto da Shopify sem procedência ERP', async () => {
    __resetProductSource('product_source_marketing', 'erp');
    expect((await select(scheduled, product()))[0].mediaItems[0].url).toBe(image);
  });
  it.each(['gid://shopify/Product/42', 'erp-product:11111111-1111-1111-1111-111111111111'])('JPG apenas com Marketing ERP e produto ERP: %s', async id => {
    __resetProductSource('product_source_marketing', 'erp');
    const p = product(id); p.node.variants.edges[0].node.erp = { masterId: 'master', variantId: 'variant' };
    expect((await select(scheduled, p))[0].mediaItems[0].url).toBe(whatsappSendCandidates(image)[0]);
    expect((await select(scheduled, p))[0].mediaItems[0].url).not.toBe(image);
  });
  it.each(['legacy-variant', '123456', 'gid://shopify/ProductVariant/42', 'gid://shopify/ProductVariant/legacy'])('catálogo e pedido preservam identificador Shopify %s', id => {
    const p = product(undefined, id);
    const before = executable(baseline.catalogVariants, { SIZE_RX: /tamanho|numera|size|n[uú]mero/i, COLOR_RX: /cor|color/i }, 'variantsFromShopify')(p);
    expect(variantsFromShopify(p)).toEqual(before);
    expect(variantsFromShopify(p)[0].variant_id).toBe(id);
    expect(orderItemIdentity(p.node.variants.edges[0].node)).toEqual({ shopifyId: id, sku: 'SKU37' });
    expect(erpOnlyItems([{ shopifyId: id }])).toEqual([]);
  });
});

// Limit payment execution to the real Yampi branch; every provider and write is simulated.
function yampiBranch(source: string): string {
  const file = ts.createSourceFile('payment.ts', `const payment = ${source}`, ts.ScriptTarget.Latest, true);
  let body: string | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isIfStatement(node) && node.expression.getText(file) === 'gateway === "yampi"') body = node.thenStatement.getText(file);
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!body) throw new Error('Yampi branch missing');
  return `async () => { let link = ""; ${body}; return link; }`;
}
async function yampi(source: string, cart: any[]) {
  const invoke = vi.fn().mockResolvedValue({ data: { success: true, payment_link: 'https://example.test/payment' }, error: null });
  const fn = executable(yampiBranch(source), { cart, isShopifyVariantGid, linkedCustomer: { name: 'Teste', whatsapp: '5533999990000' }, couponCode: 'TESTE', supabase: { functions: { invoke } } });
  return { fn, invoke };
}
describe('venda online: validação estrita somente no caminho ERP', () => {
  it.each(['legacy-id', '123456', 'gid://shopify/ProductVariant/legacy', 'gid://shopify/ProductVariant/42'])('Yampi encaminha exatamente a entrada antiga %s', async variantId => {
    const cart = [{ variantId, sku: 'SKU37', quantity: 2, price: 159.99 }];
    const before = await yampi(baseline.posPayment, cart);
    const after = await yampi(current('src/components/pos/POSOnlineSales.tsx', 'processPayment'), cart);
    expect(await after.fn()).toBe(await before.fn());
    expect(after.invoke.mock.calls).toEqual(before.invoke.mock.calls);
    expect(after.invoke.mock.calls[0][1].body.items[0].shopify_variant_id).toBe(variantId);
  });
  it('continua recusando produto ERP-only na Yampi sem chamar provedor', async () => {
    const { fn, invoke } = await yampi(current('src/components/pos/POSOnlineSales.tsx', 'processPayment'), [{ erpVariantId: 'v', variantId: 'erp-variant:v' }]);
    await expect(fn()).rejects.toThrow('Há produto só do ERP');
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('promoções: fonte única é product_source_crossell', () => {
  it.each(['shopify', 'erp'] as const)('cross-sell Shopify, live %s: busca/gravação iguais ao baseline', async live => {
    __resetLiveProductSource(live);
    const ps = [product()]; fetchProducts.mockResolvedValue(ps);
    const promoFetch = executable(current('src/components/events/LivePromotionsManager.tsx', 'promoFetch'), { fetchCrossellProducts, getProductSource }, 'promoFetch');
    const run = async (source: string) => {
      let results: unknown; const searching: boolean[] = [];
      const fn = executable(source, { q: 'tenis', CODE_RE: /^\s*([a-z])\s*[-\s]?\s*(\d{3})\s*$/i,
        setSearching: (v: boolean) => searching.push(v), setResults: (v: unknown) => { results = v; },
        fetchProducts, promoFetch, isErpOnlyId, promoKeyOf, numId: (v: string) => String(v || '').split('/').pop()?.replace(/\D/g, '') || '',
        toast: { error: vi.fn(), info: vi.fn() },
      });
      fetchProducts.mockClear(); await fn();
      // Omitted optional argument and explicit undefined are identical inputs to fetchProducts.
      return { results, searching, calls: fetchProducts.mock.calls.map(([limit, query, opts]) => [limit, query, opts]) };
    };
    expect(await run(current('src/components/events/LivePromotionsManager.tsx', 'search'))).toEqual(await run(baseline.promotionSearch));
    expect(rpc).not.toHaveBeenCalled();
    expect((await promoFetch(1, 'id:42')).ps).toBe(ps);
    expect(fetchProducts).toHaveBeenLastCalledWith(1, 'id:42', undefined);
  });
  it.each(['shopify', 'erp'] as const)('cross-sell ERP, live %s: usa só a consulta ERP', async live => {
    __resetLiveProductSource(live); __resetProductSource('product_source_crossell', 'erp');
    rpc.mockResolvedValue({ data: { items: [], total: 0 }, error: null });
    const promoFetch = executable(current('src/components/events/LivePromotionsManager.tsx', 'promoFetch'), { fetchCrossellProducts, getProductSource }, 'promoFetch');
    expect(await promoFetch(20, 'title:*tenis*')).toEqual({ erp: true, ps: [] });
    expect(rpc).toHaveBeenCalledWith('erp_catalog_search', { p_query: 'tenis', p_ids: null, p_limit: 20, p_offset: 0 });
    expect(fetchProducts).not.toHaveBeenCalled();
  });
});