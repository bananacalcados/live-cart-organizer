import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("exclusão do PDV não chama mais o Tiny", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(!src.includes("api.tiny.com.br"), "A exclusão voltou a chamar o Tiny");
  assert(!src.includes("accounts.tiny.com.br"), "A exclusão voltou a renovar token do Tiny");
  assert(!src.includes("tiny_token"), "A exclusão voltou a exigir token do Tiny");
});

Deno.test("cancel_tiny_only responde sucesso antes de qualquer consulta ou escrita", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const earlyReturn = src.indexOf("if (cancel_tiny_only)");
  const firstDatabaseUse = src.indexOf("createClient(");
  assert(earlyReturn >= 0 && firstDatabaseUse >= 0 && earlyReturn < firstDatabaseUse);
});

Deno.test("devolução única registra ajuste classificado antes do estoque", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const adjustment = src.indexOf(".from('pos_stock_adjustments')");
  const stockUpdate = src.indexOf(".update({ stock: newStock");
  assert(adjustment >= 0 && stockUpdate > adjustment, "O ajuste precisa vir antes da devolução de estoque");
  for (const expected of [
    "direction: 'in'",
    "reason: 'Venda excluída no PDV'",
    "movement_type: 'devolucao'",
    "sale_id: null",
    "previous_stock: previousStock",
    "new_stock: newStock",
  ]) {
    assert(src.includes(expected), `Ajuste sem ${expected}`);
  }
  assertEquals((src.match(/\.update\(\{ stock: newStock/g) || []).length, 1);
});
