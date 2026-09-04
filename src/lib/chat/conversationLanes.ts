import type { Conversation } from "@/components/chat/ChatTypes";

/** Linhas (etapas de atendimento) da visão em Linhas do WhatsApp do PDV. */
export type ChatLane = "new" | "unread" | "followup" | "live" | "support" | "groups" | "finished";

export const CHAT_LANE_ORDER: ChatLane[] = ["new", "unread", "followup", "live", "support", "groups", "finished"];

export const CHAT_LANE_META: Record<ChatLane, { title: string; tone: string; description: string }> = {
  new: { title: "Novas", tone: "text-emerald-600 dark:text-emerald-400", description: "Nunca atendidas ou finalizadas que voltaram a falar" },
  unread: { title: "Não lidas", tone: "text-amber-600 dark:text-amber-400", description: "A cliente respondeu e está esperando a gente" },
  followup: { title: "Follow Up", tone: "text-sky-600 dark:text-sky-400", description: "Respondemos e a cliente ainda não retornou" },
  live: { title: "Pedidos da Live", tone: "text-fuchsia-600 dark:text-fuchsia-400", description: "Clientes com pedido em Live Shopping" },
  support: { title: "Suporte", tone: "text-orange-600 dark:text-orange-400", description: "Ticket de suporte aberto ou movida manualmente" },
  groups: { title: "Grupos", tone: "text-violet-600 dark:text-violet-400", description: "Conversas de grupos do WhatsApp, separadas dos atendimentos individuais" },
  finished: { title: "Finalizadas", tone: "text-muted-foreground", description: "Encerradas por qualquer atendente" },
};

/** Janela em que o card fica na linha anterior depois da nossa resposta. */
export const FOLLOWUP_GRACE_MS = 5 * 60 * 1000;

export const laneAutoKey = (phone?: string | null) => String(phone || "").replace(/\D/g, "").slice(-8);

export interface LaneClassifyInput {
  conv: Conversation;
  /** Agora (ms) — injetado para tornar a função testável e permitir o tick de 30s. */
  now: number;
  /** Conversa tem pedido em Live Shopping (mapa pelo telefone). */
  isLive: boolean;
  /** Telefone tem ticket de suporte aberto. */
  hasSupport: boolean;
  /** Data da última finalização (ISO) para este telefone, se houver. */
  finishedAt?: string | null;
  /** Marcação manual (Etapa 2). */
  manualLane?: ChatLane | null;
  /** Linha em que o card estava antes da nossa última resposta (memória local). */
  previousLane?: ChatLane | null;
}

/**
 * Classifica uma conversa em uma linha.
 * Prioridade: manual > finalizada > live > suporte > regras por status/tempo.
 */
export function classifyConversationLane(input: LaneClassifyInput): ChatLane {
  const { conv, now, isLive, hasSupport, finishedAt, manualLane, previousLane } = input;

  if (manualLane) return manualLane;
  if (conv.isFinished) return "finished";
  // Grupos ficam em linha própria, separados dos atendimentos individuais.
  if (conv.isGroup) return "groups";
  if (isLive) return "live";
  if (hasSupport) return "support";

  const lastAt = new Date(conv.lastMessageAt).getTime();
  const status = conv.conversationStatus;

  // Finalizada anteriormente e a cliente voltou a falar → Novas.
  const returnedAfterFinish = !!finishedAt && lastAt > new Date(finishedAt).getTime();

  if (status === "not_started") return "new";
  if (status === "awaiting_reply") return returnedAfterFinish ? "new" : "unread";

  // awaiting_customer: última mensagem é nossa.
  const sinceReply = now - lastAt;
  if (sinceReply < FOLLOWUP_GRACE_MS) {
    // Dentro dos 5 min, fica onde estava (se soubermos).
    if (previousLane && previousLane !== "followup" && previousLane !== "finished") return previousLane;
  }
  return "followup";
}

/** Milissegundos até o card sair da janela de 5 min (0 se já saiu). */
export function msUntilFollowup(conv: Conversation, now: number): number {
  if (conv.conversationStatus !== "awaiting_customer") return 0;
  const lastAt = new Date(conv.lastMessageAt).getTime();
  return Math.max(0, FOLLOWUP_GRACE_MS - (now - lastAt));
}
