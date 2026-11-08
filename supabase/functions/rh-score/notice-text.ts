const SITE = "https://checkout.bananacalcados.com.br";

export function buildCandidateNotice(input: {
  candidato_id: string;
  nome?: string | null;
  idade?: number | null;
  bairro?: string | null;
  nota: number;
  parcial?: boolean | null;
}): string {
  const score = Number(input.nota);
  const formatted = Number.isInteger(score) ? String(score) : score.toFixed(1).replace(".", ",");
  return `Novo candidato: ${input.nome || "Não informado"}, ${input.idade ?? "—"} anos, ${input.bairro || "Não informado"}. Nota ${formatted}/100${input.parcial ? " (parcial)" : ""}. Ver respostas, notas e impressões da IA: ${SITE}/rh/candidato/${input.candidato_id}`;
}
