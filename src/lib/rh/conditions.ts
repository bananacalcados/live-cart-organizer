const resumoItens = (resumo: string) => resumo.split("·").map((item) => item.trim()).filter(Boolean);

/** A pergunta usa o mesmo resumo exibido no cartão da vaga. */
export function rhCondicoesPergunta(resumo: string) {
  const itens = resumoItens(resumo);
  if (itens.length < 3) return "Você topa trabalhar nas condições apresentadas acima?";
  const horario = itens.slice(2).join(" · ")
    .replace(/:\s*trabalho até/i, ", o trabalho vai até")
    .replace(/[.?!]+$/, "");
  return `Você topa trabalhar com ${itens[0]}, ${itens[1]}? Em ${horario}.`;
}

export function rhCondicoesLabel(versao?: string | null) {
  if (!versao) return "Cond.: R$ 1.950 (anterior)";
  if (versao === "1850-live-sab-19h") return "Cond.: R$ 1.850,00";
  return `Cond.: ${versao}`;
}
