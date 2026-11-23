// Regressão: a nota de devolução anterior (entrada) nunca pode ser escolhida como nota original.
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
Deno.test("nota original da devolução só considera saída", () => {
  const src = Deno.readTextFileSync(new URL("./index.ts", import.meta.url));
  const i = src.indexOf('.eq("pos_sale_id", pedidoOriginalId)');
  assert(i > 0);
  assert(src.slice(i, i + 400).includes('.eq("tipo_operacao", "saida")'));
});
