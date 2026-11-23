import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
Deno.test("sync-pos-shopify-to-rfm não chama o Tiny", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(!src.includes("api.tiny.com.br"));
});
