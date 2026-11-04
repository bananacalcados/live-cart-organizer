import { describe, it, expect } from "vitest";
import { reverseWhatsAppText } from "./POSWhatsAppReverseDialog";

describe("mensagem de reversa", () => {
  it("devolução fala de estorno em 2 dias úteis", () => {
    const t = reverseWhatsAppText("AP1BR", "devolucao");
    expect(t).toContain("*AP1BR*");
    expect(t).toContain("estorno da compra é feito em até 2 dias úteis");
    expect(t).not.toContain("envio da troca");
  });
  it("troca fala do envio da troca em 2 dias úteis", () => {
    const t = reverseWhatsAppText("AP1BR", "troca");
    expect(t).toContain("envio da troca é feito em até 2 dias úteis");
    expect(t).not.toContain("estorno");
  });
  it("validade de 7 dias", () => {
    expect(reverseWhatsAppText("X", "troca")).toContain("7 dias");
  });
});
