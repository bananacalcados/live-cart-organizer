import { describe, expect, it } from "vitest";
import { resolveOrderChoice, type ChoiceOrder } from "../../supabase/functions/_shared/selfservice-order-choice";

const phone = "5533999994550";
const row = (id: string, instagram: string, whatsapp = "", extra: Partial<ChoiceOrder> = {}): ChoiceOrder => ({
  id, customer_id: id, phone_last4: "4550", customer: { instagram_handle: instagram, whatsapp }, ...extra,
});

describe("escolha segura de pedidos da mesma live", () => {
  it("um incompleto usa o @ da equipe mesmo quando a cliente digitou outro", () => {
    expect(resolveOrderChoice([row("cila", "cilarocha2701")], phone).orders[0]?.customer?.instagram_handle).toBe("cilarocha2701");
  });
  it("duas pessoas incompletas com final 4550 exigem escolha sem vincular ninguém", () => {
    const result = resolveOrderChoice([row("x", "pessoa_x"), row("y", "pessoa_y")], phone);
    expect(result.orders).toEqual([]);
    expect(result.candidates.map((o) => o.id)).toEqual(["x", "y"]);
    expect(result.ambiguous).toBe(true);
  });
  it("selecionar Y não inclui o pedido de X", () => {
    expect(resolveOrderChoice([row("x", "pessoa_x"), row("y", "pessoa_y")], phone, "y").orders.map((o) => o.id)).toEqual(["y"]);
  });
  it("pedido completo de outro @ não compete com pedido novo incompleto", () => {
    expect(resolveOrderChoice([row("antigo", "outra", phone), row("novo", "nova")], phone).orders.map((o) => o.id)).toEqual(["novo"]);
  });
  it("telefone completo diferente com mesmo final nunca é associado", () => {
    expect(resolveOrderChoice([row("outra", "outra", "5511988884550")], phone).orders).toEqual([]);
  });
  it("telefone completo da ficha do pedido retira o pedido da disputa", () => {
    expect(resolveOrderChoice([row("antigo", "outra", "", { registration: { whatsapp: "5511988884550" } }), row("novo", "nova")], phone).orders.map((o) => o.id)).toEqual(["novo"]);
  });
  it("um pedido confirmado por outro WhatsApp não pode ser selecionado", () => {
    const result = resolveOrderChoice([row("outra", "outra", "", { claimedPhones: ["5511988884550"] })], phone, "outra");
    expect(result.invalidSelection).toBe(true);
    expect(result.orders).toEqual([]);
  });
  it("pedido escolhido removido ou de outra live exige nova identificação", () => {
    expect(resolveOrderChoice([row("x", "pessoa_x")], phone, "outro_evento").invalidSelection).toBe(true);
  });
  it("pedidos do mesmo @ ficam juntos, sem misturar outra pessoa", () => {
    expect(resolveOrderChoice([row("x1", "Pessoa_X"), row("x2", "@pessoa_x"), row("y", "pessoa_y")], phone, "x1").orders.map((o) => o.id)).toEqual(["x1", "x2"]);
  });
  it("zero pedidos não inventa um vínculo", () => {
    expect(resolveOrderChoice([], phone)).toMatchObject({ orders: [], ambiguous: false, hasCandidates: false });
  });
  it("pedido completo correto continua acessível sem incompletos", () => {
    expect(resolveOrderChoice([row("cila", "cilarocha2701", phone)], phone).orders.map((o) => o.id)).toEqual(["cila"]);
  });
  it("se o pedido agora tem telefone de outra pessoa, a seleção anterior é rejeitada", () => {
    expect(resolveOrderChoice([row("x", "pessoa_x", "5511988884550")], phone, "x").invalidSelection).toBe(true);
  });
  it("telefone parcial de quatro dígitos continua incompleto", () => {
    expect(resolveOrderChoice([row("x", "pessoa_x", "4550")], phone).orders.map((o) => o.id)).toEqual(["x"]);
  });
});