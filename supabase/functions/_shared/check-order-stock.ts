// Verifica se os itens de um pedido (orders.products JSONB) têm estoque
// disponível considerando o somatório de estoque em pos_products (todas as lojas).
// Retorna { ok: true } se tudo disponível ou se o produto não estiver cadastrado no PDV
// (assume que produtos não-PDV têm controle externo). Retorna ok=false com lista de
// itens em falta caso algum item esteja explicitamente sem estoque.

export interface OrderProductLike {
  sku?: string;
  title?: string;
  variant?: string;
  quantity?: number;
  shopifyId?: string;
}

export interface StockIssue {
  title: string;
  variant?: string;
  sku?: string;
  requested: number;
  available: number;
}

export interface CheckOrderStockResult {
  ok: boolean;
  issues: StockIssue[];
  checked: number;
  skipped_unknown: number;
}

// deno-lint-ignore no-explicit-any
export async function checkOrderStock(supabase: any, products: OrderProductLike[]): Promise<CheckOrderStockResult> {
  const issues: StockIssue[] = [];
  let checked = 0;
  let skipped = 0;

  // Coleta SKUs (que são, na prática, códigos de barras EAN)
  const skus = (products || []).map((p) => p?.sku?.toString().trim()).filter(Boolean) as string[];
  if (skus.length === 0) {
    return { ok: true, issues: [], checked: 0, skipped_unknown: 0 };
  }

  // Busca estoques agregados por barcode em pos_products (todas as lojas)
  const { data: rows, error } = await supabase
    .from("pos_products")
    .select("barcode, sku, stock")
    .in("barcode", skus);

  if (error) {
    console.error("[check-order-stock] db error:", error);
    // Em caso de erro, não bloqueia
    return { ok: true, issues: [], checked: 0, skipped_unknown: skus.length };
  }

  // Soma estoque por barcode
  const stockByBarcode = new Map<string, number>();
  for (const r of rows || []) {
    const key = (r.barcode || r.sku || "").toString();
    if (!key) continue;
    stockByBarcode.set(key, (stockByBarcode.get(key) || 0) + Number(r.stock || 0));
  }

  for (const p of products || []) {
    const sku = p?.sku?.toString().trim();
    if (!sku) {
      skipped++;
      continue;
    }
    const qty = Math.max(1, Number(p.quantity || 1));
    if (!stockByBarcode.has(sku)) {
      // Produto não cadastrado no PDV — não bloqueia
      skipped++;
      continue;
    }
    const available = stockByBarcode.get(sku) || 0;
    checked++;
    if (available < qty) {
      issues.push({
        title: p.title || "Produto",
        variant: p.variant,
        sku,
        requested: qty,
        available,
      });
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    checked,
    skipped_unknown: skipped,
  };
}
