// Regressão: a nota de devolução anterior (entrada) nunca pode ser escolhida como nota original.
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
Deno.test("nota original da devolução só considera saída", () => {
  const src = Deno.readTextFileSync(new URL("./index.ts", import.meta.url));
  const i = src.indexOf('.eq("pos_sale_id", pedidoOriginalId)');
  assert(i > 0);
  assert(src.slice(i, i + 400).includes('.eq("tipo_operacao", "saida")'));
});
Deno.test("reversa cancelada não prende a nota de devolução", () => {
  const src = Deno.readTextFileSync(new URL("./index.ts", import.meta.url));
  const i = src.indexOf('select("id, devolucao_doc_id").in("devolucao_doc_id", devIds)');
  assert(i > 0 && src.slice(i, i + 120).includes('.neq("status", "cancelada")'));
});
