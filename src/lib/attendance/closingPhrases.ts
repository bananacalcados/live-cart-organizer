/**
 * Lista padrão de frases de fechamento de atendimento.
 *
 * Quando a mensagem da vendedora contém uma destas frases, NÃO faz sentido
 * exigir que ela termine com uma pergunta (ela está encerrando o atendimento).
 *
 * A lista pode ser editada em runtime pela tela de configuração
 * (tabela `chat_attendance_rules`, regra `end_with_question`, campo `closing_phrases`).
 */
export const DEFAULT_CLOSING_PHRASES: string[] = [
  "obrigada",
  "obrigado",
  "agradeço",
  "pedido enviado",
  "pedido a caminho",
  "enviado pelos correios",
  "codigo de rastreio",
  "até logo",
  "até mais",
  "volte sempre",
  "qualquer coisa estou à disposição",
  "estou à disposição",
  "tenha um ótimo dia",
  "boa compra",
  "seja bem-vinda de volta",
  "finalizado",
  "pagamento confirmado",
  "compra concluída",
];

/** Normaliza texto: minúsculo, sem acentos, espaços colapsados. */
export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
