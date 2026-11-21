import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sumSharedStock, sharedStockByBarcode } from "./shopify-shared-stock.ts";

// Cálculo antigo do espelho (referência): soma das lojas reais, clamp 0.
const legacyMirror = (rows: any[], ids: string[]) => {
  if (!ids.length) return 0;
  const s = rows.filter((r) => ids.includes(r.store_id)).reduce((a, r) => a + (Number(r.stock) || 0), 0);
  return s < 0 ? 0 : s;
};

Deno.test("mesmo resultado do espelho atual", () => {
  const ids = ["a", "b"];
  const cases = [
    [{ store_id: "a", stock: 3 }, { store_id: "b", stock: 2 }],
    [{ store_id: "a", stock: 3 }, { store_id: "b", stock: -1 }],
    [{ store_id: "a", stock: -5 }],
    [{ store_id: "a", stock: "4" }, { store_id: "b", stock: null }],
  ];
  for (const c of cases) assertEquals(sumSharedStock(c, ids), legacyMirror(c, ids));
});

Deno.test("ignora loja de simulação/inativa e limita negativo a 0", () => {
  assertEquals(sumSharedStock([{ store_id: "a", stock: 2 }, { store_id: "sim", stock: 50 }], ["a"]), 2);
  assertEquals(sumSharedStock([{ store_id: "a", stock: -3 }, { store_id: "b", stock: 1 }], ["a", "b"]), 0);
  assertEquals(sumSharedStock([{ store_id: "a", stock: 5 }], []), 0);
});

Deno.test("variação sem linha nas lojas consideradas = 0 e vai para missing", () => {
  const r = sharedStockByBarcode(
    [{ barcode: "111", store_id: "a", stock: 4 }, { barcode: "222", store_id: "sim", stock: 9 }],
    ["a"], ["111", "222", "333"],
  );
  assertEquals(r.stock, { "111": 4, "222": 0, "333": 0 });
  assertEquals(r.missing, ["222", "333"]);
});

Deno.test("sync-master-product-stock nunca grava em pos_products", async () => {
  const src = await Deno.readTextFile(new URL("../sync-master-product-stock/index.ts", import.meta.url));
  const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  const re = /from\(\s*["']pos_products["']\s*\)[\s\S]{0,200}?\.(update|insert|upsert|delete)\s*\(/;
  assert(!re.test(code), "sync-master-product-stock voltou a escrever em pos_products");
  assert(!code.includes("initial_stock"), "initial_stock não pode ser usado como estoque");
  assert(code.includes("_shared/shopify-shared-stock.ts"));
});
