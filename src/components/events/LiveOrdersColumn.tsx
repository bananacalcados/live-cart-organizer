import { useMemo, useState } from "react";
import { DbOrder } from "@/types/database";
import { OrderStage, Stage, STAGES } from "@/types/order";
import { OrderCardDb } from "@/components/OrderCardDb";
import { useDbOrderStore } from "@/stores/dbOrderStore";
import { cn } from "@/lib/utils";
import { LayoutList } from "lucide-react";

interface LiveOrdersColumnProps {
  orders: DbOrder[];
  stages?: Stage[];
  onEditOrder: (order: DbOrder) => void;
}

/**
 * Kanban VERTICAL da Central de Atendimento: as etapas viram chips com
 * contador e os pedidos ficam empilhados, cabendo numa coluna estreita.
 */
export function LiveOrdersColumn({ orders, stages = STAGES, onEditOrder }: LiveOrdersColumnProps) {
  const { deleteOrder } = useDbOrderStore();
  const [activeStage, setActiveStage] = useState<OrderStage | "all">("all");

  const byStage = useMemo(() => {
    const map = new Map<OrderStage, DbOrder[]>();
    for (const stage of stages) map.set(stage.id, []);
    for (const order of orders) {
      const list = map.get(order.stage as OrderStage);
      if (list) list.push(order);
    }
    return map;
  }, [orders, stages]);

  const visibleStages = activeStage === "all"
    ? stages.filter((s) => (byStage.get(s.id)?.length || 0) > 0)
    : stages.filter((s) => s.id === activeStage);

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="flex items-center gap-2 text-sm font-bold">
          <LayoutList className="h-4 w-4" /> Pedidos da Live
        </span>
        <span className="text-[10px] text-muted-foreground">{orders.length} no total</span>
      </div>

      <div className="flex flex-wrap gap-1 px-2 py-2">
        <button
          type="button"
          onClick={() => setActiveStage("all")}
          className={cn(
            "rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors",
            activeStage === "all"
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-muted-foreground hover:text-foreground"
          )}
        >
          Todas
        </button>
        {stages.map((stage) => {
          const count = byStage.get(stage.id)?.length || 0;
          if (count === 0 && activeStage !== stage.id) return null;
          return (
            <button
              key={stage.id}
              type="button"
              onClick={() => setActiveStage(stage.id)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors",
                activeStage === stage.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              )}
            >
              {stage.title} {count}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-2 pb-3">
        {visibleStages.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">Nenhum pedido nesta etapa.</p>
        )}
        {visibleStages.map((stage) => {
          const list = byStage.get(stage.id) || [];
          return (
            <div key={stage.id} className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <span className={cn("h-2 w-2 rounded-full", stage.color)} />
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  {stage.title} · {list.length}
                </span>
              </div>
              {list.map((order) => (
                <OrderCardDb
                  key={order.id}
                  order={order}
                  onEdit={onEditOrder}
                  onDelete={deleteOrder}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
