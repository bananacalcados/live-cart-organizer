import { describe, expect, it } from "vitest";
import { suggestExchangeSize } from "@/lib/exchangeDesk/suggestedSize";

describe("numeração sugerida na troca", () => {
  it("38 apertado sugere 39", () => {
    expect(suggestExchangeSize("38", "tamanho", "Calço 37 e comprei número 38. Mesmo assim ficou apertado.")).toBe("39");
  });
  it("36 grande sugere 35", () => {
    expect(suggestExchangeSize("36", "nao_gostou", "Ficou grande e folgado")).toBe("35");
  });
  it("sem indicação de ajuste fica vazio", () => {
    expect(suggestExchangeSize("38", "defeito", "O solado descolou")).toBeNull();
  });
  it("tamanho não numérico não inventa sugestão", () => {
    expect(suggestExchangeSize("único", "tamanho", "ficou pequeno")).toBeNull();
  });
});
