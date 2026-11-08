import { describe, expect, it } from "vitest";
import { matchesRhVaga, normalizeRhVagaText } from "../../supabase/functions/_shared/rh-vaga-matcher";
import { buildRhVagaMetaMessage, rhVagaUrl } from "../../supabase/functions/_shared/rh-vaga-automation";
import { buildCandidateNotice } from "../../supabase/functions/rh-score/notice-text";

const cases: Array<[string, boolean]> = [
  ["vaga", true], ["VAGA", true], ["Vaga", true], ["vagaa", true],
  ["vagas", true], ["vaaga", true], ["vga", true], ["vagá", true],
  ["quero a vaga", true], ["vaga!!", true], ["v a g a", true],
  ["vaja", true], ["baga", true], ["😊 VAGASS... 👇", true],
  ["vara", false], ["vaca", false], ["quero uma vara de pescar", false],
  ["a vaca comeu", false], ["vago", false], ["viga", false],
  ["vagabundo", false], ["emprego", false], ["", false],
];

describe("VAGA-RH: correspondência exclusiva", () => {
  it.each(cases)("entrada %j => %s", (text, expected) => {
    expect(matchesRhVaga(text)).toBe(expected);
  });

  it("normaliza acentos, pontuação, repetição e letras espaçadas", () => {
    expect(normalizeRhVagaText("😊 V A G A ÁÁ!!")).toContain("vaga");
  });
});

describe("VAGA-RH: link e botão", () => {
  it("usa somente o endereço oficial e o código obtido no servidor", () => {
    expect(rhVagaUrl("abc123def4")).toBe("https://checkout.bananacalcados.com.br/vaga/abc123def4");
    expect(() => rhVagaUrl("https://externo.example")).toThrow();
  });

  it("cadastro já enviado recebe texto sem botão", () => {
    expect(buildRhVagaMetaMessage({ message: "Já recebemos", link_token: null })).toEqual({ text: "Já recebemos" });
  });

  it("link novo produz o botão pedido", () => {
    const message: any = buildRhVagaMetaMessage({ message: "Olá", link_token: "abc123def4" });
    expect(message.attachment.payload.buttons[0].title).toBe("Quero me candidatar");
  });
});

describe("RH: aviso sem respostas", () => {
  it("contém os dados resumidos e o link, nunca as respostas", () => {
    const text = buildCandidateNotice({ candidato_id: "7851813a-2eb2-4f05-8e32-99aeb4290348", nome: "Pessoa Teste", idade: 30, bairro: "Centro", nota: 86.5, parcial: true });
    expect(text).toContain("Nota 86,5/100 (parcial)");
    expect(text).toContain("/rh/candidato/7851813a-2eb2-4f05-8e32-99aeb4290348");
    expect(text).not.toContain("resposta do cenário");
  });
});
