import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("pos-tiny-create-sale não grava estoque em pos_products", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const re = /\.from\(\s*["']pos_products["']\s*\)[\s\S]{0,300}?\.update\(/;
  assert(!re.test(src), "pos-tiny-create-sale voltou a baixar estoque (baixa dupla)");
});
