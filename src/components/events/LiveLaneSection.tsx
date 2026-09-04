import { ReactNode } from "react";
import { LaneSection } from "@/components/chat/LaneSection";

interface LiveLaneSectionProps {
  id: string;
  eventId?: string | null;
  title: string;
  count: number;
  /** Classe de cor do título/contador (token semântico). */
  tone: string;
  icon?: ReactNode;
  children: ReactNode;
}

/** Linha (etapa de atendimento) da aba Pedidos: título com contador + conteúdo recolhível. */
export function LiveLaneSection({ id, eventId, title, count, tone, icon, children }: LiveLaneSectionProps) {
  return (
    <LaneSection storageKey={`live-lane-collapsed:${eventId || "none"}:${id}`} title={title} count={count} tone={tone} icon={icon}>
      {children}
    </LaneSection>
  );
}
