import { describe, expect, it } from "vitest";
import { matchesRhVaga, normalizeRhVagaText } from "../../supabase/functions/_shared/rh-vaga-matcher";
import { buildRhVagaMetaMessage, rhVagaUrl, rhVagaInboxSource, rhVagaDirectWindowOpen } from "../../supabase/functions/_shared/rh-vaga-automation";
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
  it("reconhece resposta de story com texto tolerante", () => {
    const event = { message: { mid: "story-1", text: "😊 V A G A!!", reply_to: { story: { id: "123" } } } };
    expect(rhVagaInboxSource(event)).toBe("story");
    expect(matchesRhVaga(event.message.text)).toBe(true);
  });

  it("reconhece DM direta e menção com palavra VAGA", () => {
    expect(rhVagaInboxSource({ message: { text: "quero a vagá" } })).toBe("dm");
    expect(rhVagaInboxSource({ message: { text: "vaja", attachments: [{ type: "story_mention" }] } })).toBe("story");
  });

  it("não interpreta ecos, exclusões, botões nem menção sem texto", () => {
    expect(rhVagaInboxSource({ message: { text: "VAGA", is_echo: true } })).toBeNull();
    expect(rhVagaInboxSource({ message: { text: "VAGA", is_deleted: true } })).toBeNull();
    expect(rhVagaInboxSource({})).toBeNull();
    expect(rhVagaInboxSource({ message: { attachments: [{ type: "story_mention" }] } })).toBeNull();
  });

  it("bloqueia Direct com 24 horas, sem usar a janela de comentário", () => {
    const now = Date.parse("2026-11-08T16:45:00Z");
    expect(rhVagaDirectWindowOpen("2026-11-07T16:45:01Z", now)).toBe(true);
    expect(rhVagaDirectWindowOpen("2026-11-07T16:45:00Z", now)).toBe(false);
    expect(rhVagaDirectWindowOpen("inválido", now)).toBe(false);
  });
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
