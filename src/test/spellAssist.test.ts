import { describe, it, expect } from "vitest";
import { capitalizeSentences } from "@/lib/spellAssist/capitalize";
import { applySuggestion, type Misspelling } from "@/lib/spellAssist/dictionary";

describe("capitalizeSentences", () => {
  it("capitaliza o início do texto", () => {
    expect(capitalizeSentences("oi tudo bem")).toBe("Oi tudo bem");
  });

  it("capitaliza após ponto, exclamação e interrogação", () => {
    expect(capitalizeSentences("oi. tudo bem? otimo! e voce")).toBe(
      "Oi. Tudo bem? Otimo! E voce",
    );
  });

  it("capitaliza após quebra de linha", () => {
    expect(capitalizeSentences("oi\ntudo bem")).toBe("Oi\nTudo bem");
  });

  it("preserva o comprimento (só muda o case)", () => {
    const input = "ola. como vai voce?";
    expect(capitalizeSentences(input).length).toBe(input.length);
  });

  it("não mexe em letras já maiúsculas no meio da frase", () => {
    expect(capitalizeSentences("o PIX foi enviado")).toBe("O PIX foi enviado");
  });

  it("lida com string vazia", () => {
    expect(capitalizeSentences("")).toBe("");
  });
});

describe("applySuggestion", () => {
  const make = (word: string, start: number, suggestions: string[]): Misspelling => ({
    word,
    start,
    end: start + word.length,
    suggestions,
  });

  it("substitui a palavra pela sugestão", () => {
    const text = "vou enviar agra";
    const m = make("agra", 11, ["agora"]);
    expect(applySuggestion(text, m, "agora")).toBe("vou enviar agora");
  });

  it("preserva a capitalização da palavra original", () => {
    const text = "Agra vou enviar";
    const m = make("Agra", 0, ["agora"]);
    expect(applySuggestion(text, m, "agora")).toBe("Agora vou enviar");
  });

  it("usa fallback de primeira ocorrência quando o offset mudou", () => {
    const text = "ja enviei o pdido agora pdido";
    const m = make("pdido", 99, ["pedido"]);
    expect(applySuggestion(text, m, "pedido")).toBe("ja enviei o pedido agora pdido");
  });
});
