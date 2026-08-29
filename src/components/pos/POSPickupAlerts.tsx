import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { MapPin, X, CalendarClock } from "lucide-react";

interface PickupAlert {
  id: string;
  sale_id: string | null;
  order_id: string | null;
  alert_type: "created" | "due_date";
  target_date: string | null;
  customer_name: string | null;
  total: number | null;
}

interface Props {
  storeId: string;
  onOpenSale: (saleId: string | null) => void;
}

const fmt = (v?: number | null) =>
  typeof v === "number" ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "";

const br = (d?: string | null) => (d ? d.split("-").reverse().join("/") : "");

/**
 * Avisos de RETIRADA NA LOJA no PDV da loja física.
 * - `created`: aparece assim que o pedido é enviado para a loja.
 * - `due_date`: reaparece no dia agendado da retirada.
 */
export function POSPickupAlerts({ storeId, onOpenSale }: Props) {
  const [alerts, setAlerts] = useState<PickupAlert[]>([]);

  const load = useCallback(async () => {
    if (!storeId) { setAlerts([]); return; }
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await supabase
      .from("pos_pickup_alerts" as any)
      .select("id, sale_id, order_id, alert_type, target_date, customer_name, total")
      .eq("store_id", storeId)
      .is("dismissed_at", null)
      .or(`alert_type.eq.created,and(alert_type.eq.due_date,target_date.lte.${today})`)
      .order("created_at", { ascending: false })
      .limit(10);
    setAlerts(((data as any) || []) as PickupAlert[]);
  }, [storeId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!storeId) return;
    const ch = supabase
      .channel(`pos-pickup-alerts-${storeId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pos_pickup_alerts", filter: `store_id=eq.${storeId}` },
        () => load(),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [storeId, load]);

  // Reavalia ao virar o dia (PDV fica aberto por longos períodos)
  useEffect(() => {
    const t = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [load]);

  const dismiss = async (id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    await supabase
      .from("pos_pickup_alerts" as any)
      .update({ dismissed_at: new Date().toISOString() } as any)
      .eq("id", id);
  };

  if (alerts.length === 0) return null;

  return (
    <div className="fixed bottom-20 right-4 z-50 flex w-[300px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {alerts.map((a) => {
        const isDue = a.alert_type === "due_date";
        return (
          <div
            key={a.id}
            className="rounded-lg border border-pos-orange/50 bg-pos-black/95 p-3 shadow-lg backdrop-blur"
          >
            <div className="flex items-start gap-2">
              {isDue ? (
                <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-pos-orange" />
              ) : (
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-pos-orange" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-wide text-pos-orange">
                  {isDue ? "Retirada é hoje" : "Nova retirada nesta loja"}
                </p>
                <p className="truncate text-sm font-semibold text-pos-white">
                  {a.customer_name || "Cliente"}
                </p>
                <p className="text-[11px] text-pos-white/60">
                  {fmt(a.total)}{a.target_date ? ` · retirada em ${br(a.target_date)}` : ""}
                </p>
                <p className="mt-1 text-[10px] text-pos-white/50">
                  Separe o pedido antes da cliente chegar.
                </p>
              </div>
              <button
                onClick={() => dismiss(a.id)}
                className="rounded p-0.5 text-pos-white/50 hover:bg-pos-white/10 hover:text-pos-white"
                title="Dispensar"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <Button
              size="sm"
              className="mt-2 h-7 w-full bg-pos-orange text-[11px] font-bold text-pos-black hover:bg-pos-orange/90"
              onClick={() => { onOpenSale(a.sale_id); dismiss(a.id); }}
            >
              VER PEDIDO
            </Button>
          </div>
        );
      })}
    </div>
  );
}
