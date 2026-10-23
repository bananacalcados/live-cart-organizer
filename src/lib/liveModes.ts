/** Modo novo: "WhatsApp + Cadastro online". */
export const SELF_SERVICE_MODE = "whatsapp_autoatendimento";

/** Modos em que a Central da Live, fila, chat e follow-ups do WhatsApp valem. */
export function isWhatsAppLikeMode(mode?: string | null): boolean {
  return mode === "whatsapp" || mode === SELF_SERVICE_MODE;
}

export function isSelfServiceMode(mode?: string | null): boolean {
  return mode === SELF_SERVICE_MODE;
}

/** Fim do prazo do prêmio: minutos de cadastro contados de orders.created_at. */
export function registrationDeadline(createdAt: string, minutes: number): number {
  return new Date(createdAt).getTime() + Math.max(0, minutes) * 60_000;
}

/** Cadastro conta como "no prazo" se registered_at <= created_at + minutos. */
export function registeredInTime(createdAt: string, registeredAt: string | null | undefined, minutes: number): boolean {
  if (!registeredAt) return false;
  return new Date(registeredAt).getTime() <= registrationDeadline(createdAt, minutes);
}

export type SelfServiceStage = "awaiting_id" | "viewed" | "registered_unconfirmed" | "registered_in_time" | "registered_late" | "paid";

export const SELF_SERVICE_STAGE_LABEL: Record<SelfServiceStage, string> = {
  awaiting_id: "Aguardando identificação",
  viewed: "Viu o produto",
  registered_unconfirmed: "Cadastro feito — não confirmou no WhatsApp",
  registered_in_time: "Confirmou no WhatsApp (no prazo)",
  registered_late: "Confirmou no WhatsApp (fora do prazo)",
  paid: "Pago",
};

/** Estágio do pedido no autoatendimento para a Central/apresentadora. */
export function selfServiceStage(args: {
  isPaid: boolean;
  createdAt: string;
  registeredAt?: string | null;
  viewedAt?: string | null;
  /** undefined = sem informação (mantém o estágio de cadastro); false = não confirmou. */
  confirmedWhatsApp?: boolean;
  minutes: number;
}): SelfServiceStage {
  if (args.isPaid) return "paid";
  if (args.registeredAt) {
    if (args.confirmedWhatsApp === false) return "registered_unconfirmed";
    return registeredInTime(args.createdAt, args.registeredAt, args.minutes) ? "registered_in_time" : "registered_late";
  }
  if (args.viewedAt) return "viewed";
  return "awaiting_id";
}

export function formatMmSs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
