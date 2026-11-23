import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { initialStockFor, resolveStockStore, PEROLA_STORE_ID, SITE_LIVE_STORE_ID } from "./stockEntry.ts";
Deno.test("linha existente → estoque intocado", () => { assertEquals(initialStockFor(true, 5), null); });
Deno.test("linha nova → estoque inicial", () => { assertEquals(initialStockFor(false, 5), 5); });
Deno.test("Site/Live → Pérola", () => { assertEquals(resolveStockStore(SITE_LIVE_STORE_ID), PEROLA_STORE_ID); assertEquals(resolveStockStore("x"), "x"); });
Deno.test("código não soma em linha existente", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(!/existing\.stock/.test(src)); assert(!/updatePayload\.stock/.test(src));
});
