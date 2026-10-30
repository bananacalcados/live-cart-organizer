import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { tagDispatchText, tagDispatchComponents, hasTrackableLink } from "./dispatch-tracking.ts";
const D = "1234abcd-0000-0000-0000-000000000000";
Deno.test("link sem query recebe código", () => {
  assertEquals(tagDispatchText("Entra: https://checkout.bananacalcados.com.br/ao-vivo/livebanana.", "abc1234", D),
    "Entra: https://checkout.bananacalcados.com.br/ao-vivo/livebanana?d=abc1234&utm_source=disparo&utm_campaign=1234abcd.");
});
Deno.test("preserva query existente", () => {
  assertEquals(tagDispatchText("https://checkout.bananacalcados.com.br/pedido/x?a=1", "abc1234", D),
    "https://checkout.bananacalcados.com.br/pedido/x?a=1&d=abc1234&utm_source=disparo&utm_campaign=1234abcd");
});
Deno.test("outro domínio não muda", () => {
  assertEquals(tagDispatchText("https://instagram.com/x", "abc1234", D), "https://instagram.com/x");
  assertEquals(hasTrackableLink("oi"), false);
});
Deno.test("botão com sufixo variável", () => {
  const tpl = [{ type: "BUTTONS", buttons: [{ type: "URL", url: "https://checkout.bananacalcados.com.br/ao-vivo/{{1}}" }] }];
  const out = tagDispatchComponents([{ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "livebanana" }] }], tpl, "abc1234", D);
  assertEquals(out[0].parameters[0].text, "livebanana?d=abc1234&utm_source=disparo&utm_campaign=1234abcd");
});
