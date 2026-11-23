// Falha se esta edge voltar a gravar pos_products.stock direto (deve usar pos_stock_move / pos_stock_balance_to).
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
Deno.test("pos-exchange-stock-adjust: sem update direto de stock em pos_products", () => {
  const re = /\.from\(\s*["']pos_products["']\s*\)[\s\S]{0,200}?\.update\(\s*\{[^}]*\bstock\b/;
  assert(!re.test(src), "voltou a gravar stock direto");
});
