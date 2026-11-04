import { assertEquals } from "jsr:@std/assert";
import { planDiff, checkGuards, isRollingWindow } from "./logic.ts";

Deno.test("diferença: só entra quem entrou e sai quem saiu", () => {
  const d = planDiff([{ key: "a", row_hash: "1" }, { key: "b", row_hash: "2" }], [{ key: "a", row_hash: "1" }, { key: "c", row_hash: "3" }]);
  assertEquals(d.add.map((x) => x.key), ["b"]);
  assertEquals(d.remove.map((x) => x.key), ["c"]);
});
Deno.test("trava 20% nas rodadas", () => {
  assertEquals(checkGuards({ replace: false, erpCount: 70, metaLower: null, activeMembers: 100, removing: 21, force: false }).ok, false);
  assertEquals(checkGuards({ replace: false, erpCount: 80, metaLower: null, activeMembers: 100, removing: 20, force: false }).ok, true);
});
Deno.test("trava 70% na 1ª carga", () => {
  assertEquals(checkGuards({ replace: true, erpCount: 699, metaLower: 1000, activeMembers: 0, removing: 0, force: false }).ok, false);
  assertEquals(checkGuards({ replace: true, erpCount: 700, metaLower: 1000, activeMembers: 0, removing: 0, force: false }).ok, true);
});
Deno.test("regra vazia nunca esvazia público", () => {
  assertEquals(checkGuards({ replace: false, erpCount: 0, metaLower: null, activeMembers: 0, removing: 0, force: true }).ok, false);
});
Deno.test("janela móvel (7 dias) não tem trava de 20%, mas mantém a de regra vazia", () => {
  assertEquals(checkGuards({ replace: false, erpCount: 326, metaLower: null, activeMembers: 323, removing: 187, force: false, rollingWindow: true }).ok, true);
  assertEquals(checkGuards({ replace: false, erpCount: 0, metaLower: null, activeMembers: 323, removing: 323, force: false, rollingWindow: true }).ok, false);
  assertEquals(isRollingWindow("compraram_7d"), true);
  assertEquals(isRollingWindow("todos_base"), false);
});
