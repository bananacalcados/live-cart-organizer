import { describe, it, expect } from "vitest";
import { evaluateDraft, type RulesMap } from "@/lib/attendance/rules";
import { DEFAULT_CLOSING_PHRASES } from "@/lib/attendance/closingPhrases";

const rules: RulesMap = {
  end_with_question: {
    enabled: true,
    config: {
      message: "Termine com pergunta?",
      min_length: 12,
      closing_phrases: DEFAULT_CLOSING_PHRASES,
    },
  },
};

describe("evaluateDraft - end_with_question", () => {
  it("avisa quando a frase não termina com pergunta", () => {
    const n = evaluateDraft("Temos esse modelo na cor preta", {}, rules);
    expect(n.map((x) => x.ruleKey)).toContain("end_with_question");
  });

  it("não avisa quando termina com pergunta", () => {
    const n = evaluateDraft("Temos esse modelo, qual seu tamanho?", {}, rules);
    expect(n).toHaveLength(0);
  });

  it("não avisa em mensagens curtas", () => {
    expect(evaluateDraft("ok", {}, rules)).toHaveLength(0);
    expect(evaluateDraft("blz", {}, rules)).toHaveLength(0);
  });

  it("não avisa quando contém frase de fechamento", () => {
    expect(evaluateDraft("Pedido enviado pelos correios hoje", {}, rules)).toHaveLength(0);
    expect(evaluateDraft("Muito obrigada pela compra, volte sempre", {}, rules)).toHaveLength(0);
  });

  it("respeita acento/maiúscula nas exceções", () => {
    expect(evaluateDraft("PEDIDO ENVIADO para você agora", {}, rules)).toHaveLength(0);
  });

  it("não avisa em conversa finalizada", () => {
    expect(evaluateDraft("Te enviei as fotos do produto", { isFinished: true }, rules)).toHaveLength(0);
  });

  it("não avisa se a regra está desativada", () => {
    const off: RulesMap = { end_with_question: { enabled: false, config: {} } };
    expect(evaluateDraft("Temos esse modelo na cor preta", {}, off)).toHaveLength(0);
  });

  it("ignora mensagem só com link", () => {
    expect(evaluateDraft("https://checkout.bananacalcados.com.br/abc", {}, rules)).toHaveLength(0);
  });
});
