// Falha se esta edge voltar a gravar pos_products.stock direto (deve usar pos_stock_move / pos_stock_balance_to).
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
Deno.test("pos-stock-movement: sem update direto de stock em pos_products", () => {
  const re = /\.from\(\s*["']pos_products["']\s*\)[\s\S]{0,200}?\.update\(\s*\{[^}]*\bstock\b/;
  assert(!re.test(src), "voltou a gravar stock direto");
});
Deno.test("pos-stock-movement: funções seguras, recusa Site/Live e espelha Shopify", () => {
  assert(src.includes('"pos_stock_move"') && src.includes('"pos_stock_balance_to"'));
  assert(src.includes("2bd2c08d-321c-47ee-98a9-e27e936818ab"));
  assert(src.includes('"shopify-mirror-stock"') && src.includes('"manual_adjust"'));
});
