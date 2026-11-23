import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { alreadyEntered, entryReason } from "./entryGuard.ts";
const inv = { invoice_number: "1234", nfe_key: "K" };
Deno.test("motivo usa nota + item", () => { assertEquals(entryReason(inv, { id: "a", line_number: 3 }), "Entrada NF 1234 item 3"); });
Deno.test("item já vinculado → não soma", () => { assert(alreadyEntered({ id: "a", linked_at: "2026-11-01" }, "x", new Set())); });
Deno.test("ajuste já lançado → não soma", () => {
  const r = entryReason(inv, { id: "a", line_number: 3 });
  assert(alreadyEntered({ id: "a", line_number: 3 }, r, new Set([r])));
});
Deno.test("item novo → soma", () => { assert(!alreadyEntered({ id: "a", line_number: 3 }, "Entrada NF 1234 item 3", new Set())); });
Deno.test("ajuste gravado antes do update de estoque", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const adj = src.indexOf('from("pos_stock_adjustments").insert'); const up = src.indexOf("patch.stock = prev + entryStock");
  assert(adj > 0 && up > adj);
});
