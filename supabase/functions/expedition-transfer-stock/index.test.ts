import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
Deno.test("não chama o Tiny", () => { assert(!src.includes("api.tiny.com.br")); });
Deno.test("não grava em pos_products", () => {
  assert(!/from\(\s*['"]pos_products['"]\s*\)[\s\S]*?\.update\(/.test(src));
  assert(!src.includes("pos_products"));
});
