import { useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { selfServiceStage, SELF_SERVICE_STAGE_LABEL } from "@/lib/liveModes";
import { phoneKeyOf, useSelfServiceFunnelStore } from "@/stores/selfServiceFunnelStore";

/** Selo do estágio do autoatendimento. Só aparece em lives "WhatsApp + Cadastro online". */
export function SelfServiceStageBadge({
  eventId,
  createdAt,
  registeredAt,
  isPaid,
  whatsapp,
}: {
  eventId?: string | null;
  createdAt: string;
  registeredAt?: string | null;
  isPaid: boolean;
  whatsapp?: string | null;
}) {
  const st = useSelfServiceFunnelStore();
  useEffect(() => {
    if (!eventId) return;
    void useSelfServiceFunnelStore.getState().load(eventId);
    // Atualiza com a aba visível, no máximo a cada 60 s (sem polling rápido).
    const t = setInterval(() => {
      if (!document.hidden) void useSelfServiceFunnelStore.getState().load(eventId);
    }, 60_000);
    return () => clearInterval(t);
  }, [eventId]);

  if (!eventId || st.eventId !== eventId || !st.isSelfService) return null;
  const key = phoneKeyOf(whatsapp);
  const stage = selfServiceStage({
    isPaid,
    createdAt,
    registeredAt,
    viewedAt: key && st.viewedKeys.has(key) ? "1" : null,
    minutes: st.minutes,
  });
  const tone =
    stage === "paid" ? "border-primary/50 text-primary"
    : stage === "registered_in_time" ? "border-primary/40 text-primary"
    : stage === "registered_late" ? "border-destructive/40 text-destructive"
    : "border-border text-muted-foreground";
  return (
    <Badge variant="outline" className={`text-[10px] ${tone}`}>
      🧾 {SELF_SERVICE_STAGE_LABEL[stage]}
    </Badge>
  );
}
