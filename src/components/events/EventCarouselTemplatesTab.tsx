import { Card } from "@/components/ui/card";
import { Images } from "lucide-react";
import { CarouselTemplatesLadder } from "@/components/admin/CarouselTemplatesLadder";

/**
 * Templates API de carrossel para o módulo Eventos.
 *
 * Reaproveita o editor da Escada do PDV (aprovado pela Meta), mas com
 * `scope="event"` — os templates ficam separados dos do PDV e podem ter o
 * mesmo nome sem conflitar. Os nomes enviados à Meta recebem o prefixo
 * "evento_" automaticamente na edge `carousel-ladder-create` para garantir
 * unicidade global do lado da Meta.
 */
export function EventCarouselTemplatesTab() {
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-primary/10 p-2 text-primary">
            <Images className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-semibold">Templates API de carrossel — Eventos</h2>
            <p className="text-sm text-muted-foreground">
              Crie templates de carrossel específicos para o módulo Eventos (cross-sell, novidades da
              live, agradecimento). Os templates ficam separados dos do PDV e são enviados à Meta
              com o prefixo <code className="rounded bg-muted px-1">evento_</code>. Depois de
              aprovados, aparecerão automaticamente no botão de <strong>Cross-sell</strong> do chat
              de WhatsApp do evento.
            </p>
          </div>
        </div>
      </Card>

      <CarouselTemplatesLadder scope="event" />
    </div>
  );
}
