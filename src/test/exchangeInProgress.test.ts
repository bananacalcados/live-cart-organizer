import { describe, it, expect } from "vitest";
import { isPostingOverdue, canAddReplacement, canCancelExchange } from "@/lib/pos/exchangeInProgress";
const d = new Date("2026-11-17T15:00:00Z");
describe("troca em andamento", () => {
  it("prazo vencido só quando reversa venceu e produto não voltou", () => {
    expect(isPostingOverdue("aguardando_retorno", "2026-11-16", d)).toBe(true);
    expect(isPostingOverdue("aguardando_retorno", "2026-11-17", d)).toBe(false);
    expect(isPostingOverdue("recebido_conferencia", "2026-11-01", d)).toBe(false);
  });
  it("adicionar produto só em troca aberta sem produto", () => {
    expect(canAddReplacement({ tipo: "troca", status: "iniciada", pedido_novo_id: null })).toBe(true);
    expect(canAddReplacement({ tipo: "troca", status: "iniciada", pedido_novo_id: "x" })).toBe(false);
    expect(canAddReplacement({ tipo: "devolucao", status: "iniciada", pedido_novo_id: null })).toBe(false);
    expect(canAddReplacement({ tipo: "troca", status: "aguardando_envio", pedido_novo_id: null })).toBe(false);
  });
  it("cancelar bloqueado com voucher/estorno ou após finalizar", () => {
    expect(canCancelExchange({ status: "aguardando_retorno" })).toBe(true);
    expect(canCancelExchange({ status: "aguardando_retorno", voucher_id: "v" })).toBe(false);
    expect(canCancelExchange({ status: "aguardando_envio" })).toBe(false);
  });
});

import { exchangeDifference, differenceLinkTotal } from "@/lib/pos/exchangeInProgress";
describe("diferença da troca", () => {
  it("produto mais caro: cliente paga a diferença", () => {
    expect(exchangeDifference([{ direcao: "devolvido", valor_unitario: 159.99, quantidade: 1 }, { direcao: "reposicao", valor_unitario: 199.99, quantidade: 1 }]).diff).toBe(40);
  });
  it("produto mais barato: diferença negativa vira crédito", () => {
    expect(exchangeDifference([{ direcao: "devolvido", valor_unitario: 200, quantidade: 1 }, { direcao: "reposicao", valor_unitario: 150, quantidade: 1 }]).diff).toBe(-50);
  });
  it("frete grátis não cobra frete", () => { expect(differenceLinkTotal(40, 25, "gratis")).toBe(40); });
  it("frete cotado/fixo soma à diferença", () => { expect(differenceLinkTotal(40, 25.5, "fixo")).toBe(65.5); });
  it("crédito da cliente não abate o frete no link", () => { expect(differenceLinkTotal(-50, 20, "cotado")).toBe(20); });
});

import { canSwapReplacement as swapOk } from "@/lib/pos/exchangeInProgress";
describe("Trocar produto", () => {
  const base = { tipo: "troca", status: "recebido_conferencia", pedido_novo_id: "s1" };
  it("libera com produto já na Expedição", () => expect(swapOk(base)).toBe(true));
  it("não libera sem produto ainda", () => expect(swapOk({ ...base, pedido_novo_id: null })).toBe(false));
  it("não libera depois de finalizada (novo envio)", () => expect(swapOk({ ...base, status: "aguardando_envio" })).toBe(false));
  it("não libera com voucher", () => expect(swapOk({ ...base, voucher_id: "v" })).toBe(false));
  it("não libera com diferença paga", () => expect(swapOk({ ...base, diferenca_venda_id: "d" }, "completed")).toBe(false));
  it("libera com diferença ainda não paga", () => expect(swapOk({ ...base, diferenca_venda_id: "d" }, "online_pending")).toBe(true));
});
