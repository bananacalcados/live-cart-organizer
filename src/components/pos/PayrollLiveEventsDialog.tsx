import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Radio } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { LiveEventBreakdown } from "@/lib/pos/payroll";

const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export interface LiveEventInfo {
  name: string;
  date: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  personId: string;
  personName: string;
  events: LiveEventBreakdown[];
  eventInfo: Record<string, LiveEventInfo>;
  /** Recarrega os dados após gravar/remover um opt-out. */
  onChanged: () => Promise<void> | void;
  readOnly?: boolean;
}

/**
 * Lista todos os eventos/lives que incidem no faturamento de live de uma vendedora
 * no período, permitindo desmarcar aqueles em que ela NÃO participou.
 */
export function PayrollLiveEventsDialog({
  open, onOpenChange, personId, personName, events, eventInfo, onChanged, readOnly,
}: Props) {
  const [savingId, setSavingId] = useState<string | null>(null);

  const creditedTotal = events.reduce((a, e) => a + e.credited, 0);
  const potentialTotal = events.reduce((a, e) => a + (e.included ? e.credited : e.quota), 0);

  const toggle = async (eventId: string | null, storeId: string, included: boolean) => {
    if (!eventId) {
      toast.info("Vendas de live sem evento vinculado não podem ser desmarcadas.");
      return;
    }
    setSavingId(eventId);
    try {
      if (included) {
        // desmarcar → grava opt-out
        const { error } = await supabase.from("pos_commission_live_event_optouts").upsert(
          { person_id: personId, event_id: eventId, store_id: storeId || null },
          { onConflict: "person_id,event_id" },
        );
        if (error) throw error;
      } else {
        const { error } = await supabase.from("pos_commission_live_event_optouts")
          .delete().eq("person_id", personId).eq("event_id", eventId);
        if (error) throw error;
      }
      await onChanged();
    } catch (e: any) {
      toast.error("Erro ao salvar participação: " + e.message);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-fuchsia-500" /> Lives de {personName}
          </DialogTitle>
          <DialogDescription>
            Desmarque os eventos em que ela não participou. A cota é recalculada entre as demais participantes daquele evento.
          </DialogDescription>
        </DialogHeader>

        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Nenhum evento de live incidiu no faturamento desta vendedora no período.
          </p>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-[12px]">
              <thead className="text-muted-foreground uppercase text-[10px] tracking-wide">
                <tr>
                  <th className="text-left py-1.5 pr-2">Participou</th>
                  <th className="text-left py-1.5 px-2">Evento</th>
                  <th className="text-left py-1.5 px-2">Loja</th>
                  <th className="text-right py-1.5 px-2">Faturamento da live</th>
                  <th className="text-right py-1.5 px-2">Particip.</th>
                  <th className="text-right py-1.5 pl-2">Cota dela</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => {
                  const info = e.eventId ? eventInfo[e.eventId] : undefined;
                  return (
                    <tr key={`${e.eventId ?? "sem-evento"}-${e.storeKey}`} className="border-t border-border">
                      <td className="py-2 pr-2">
                        <Checkbox
                          checked={e.included}
                          disabled={readOnly || !e.eventId || savingId === e.eventId}
                          onCheckedChange={() => toggle(e.eventId, e.storeId, e.included)}
                        />
                        {savingId === e.eventId && <Loader2 className="h-3 w-3 animate-spin inline ml-2" />}
                      </td>
                      <td className="py-2 px-2">
                        <span className="font-medium">{info?.name || (e.eventId ? "Evento" : "Lives sem evento vinculado")}</span>
                        {info?.date && (
                          <span className="block text-[10px] text-muted-foreground">
                            {new Date(info.date).toLocaleDateString("pt-BR")}
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-2 capitalize">{e.storeKey === "perola" ? "Pérola" : e.storeKey === "centro" ? "Centro" : "—"}</td>
                      <td className="py-2 px-2 text-right">{BRL(e.net)}</td>
                      <td className="py-2 px-2 text-right">{e.participants}</td>
                      <td className={`py-2 pl-2 text-right font-semibold ${e.included ? "text-emerald-600" : "text-muted-foreground line-through"}`}>
                        {BRL(e.included ? e.credited : e.quota)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-border">
                  <td colSpan={5} className="py-2 text-right text-muted-foreground pr-2">Total de live creditado</td>
                  <td className="py-2 pl-2 text-right font-bold text-emerald-600">{BRL(creditedTotal)}</td>
                </tr>
                {potentialTotal !== creditedTotal && (
                  <tr>
                    <td colSpan={5} className="py-1 text-right text-muted-foreground pr-2 text-[11px]">
                      Se participasse de todas
                    </td>
                    <td className="py-1 pl-2 text-right text-[11px] text-muted-foreground">{BRL(potentialTotal)}</td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
