import { describe, expect, it } from "vitest";
import { rhCondicoesLabel, rhCondicoesPergunta } from "../lib/rh/conditions";

const RESUMO_ATUAL = "R$ 1.850,00 fixo + comissão + bônus · escala 5x2 · dias de live e sábados de live: trabalho até as 19h";

describe("RH: condições exibidas e registradas", () => {
  it("monta a pergunta nova a partir do resumo atual da vaga", () => {
    expect(rhCondicoesPergunta(RESUMO_ATUAL)).toBe(
      "Você topa trabalhar com R$ 1.850,00 fixo + comissão + bônus, escala 5x2? Em dias de live e sábados de live, o trabalho vai até as 19h.",
    );
  });

  it("diferencia a versão nova das condições anteriores sem alterar cadastros antigos", () => {
    expect(rhCondicoesLabel("1850-live-sab-19h")).toBe("Cond.: R$ 1.850,00");
    expect(rhCondicoesLabel(null)).toBe("Cond.: R$ 1.950 (anterior)");
  });
});
