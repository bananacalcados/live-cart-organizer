import { STAGES, OrderStage } from "@/types/order";
import { useDbOrderStore } from "@/stores/dbOrderStore";
import { cn } from "@/lib/utils";
import { AlertCircle } from "lucide-react";

interface StageNavigationProps {
  selectedStage: OrderStage | "all" | "unpaid";
  onSelectStage: (stage: OrderStage | "all" | "unpaid") => void;
}

export function StageNavigation({ selectedStage, onSelectStage }: StageNavigationProps) {
  const orders = useDbOrderStore((state) => state.orders);

  const getCountByStage = (stage: OrderStage) => 
    orders.filter((o) => o.stage === stage).length;

  const unpaidCount = orders.filter((o) => !o.is_paid).length;

  return (
    <div className="sticky top-16 z-40 bg-background/95 backdrop-blur border-b border-border/40">
      <div className="container py-2">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          <button
            onClick={() => onSelectStage("all")}
            className={cn(
              "flex-shrink-0 px-3 py-2 rounded-lg text-xs font-medium transition-all",
              selectedStage === "all"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            )}
          >
            Todos ({orders.length})
          </button>
          <button
            onClick={() => onSelectStage("unpaid")}
            className={cn(
              "flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all",
              selectedStage === "unpaid"
                ? "bg-destructive text-destructive-foreground"
                : "bg-destructive/10 text-destructive hover:bg-destructive/20"
            )}
          >
            <AlertCircle className="h-3 w-3" />
            <span className="whitespace-nowrap">Não Pagos</span>
            <span className="bg-background/20 px-1.5 py-0.5 rounded-full text-[10px]">
              {unpaidCount}
            </span>
          </button>
          {STAGES.map((stage) => {
            const count = getCountByStage(stage.id);
            return (
              <button
                key={stage.id}
                onClick={() => onSelectStage(stage.id)}
                className={cn(
                  "flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all",
                  selectedStage === stage.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                )}
              >
                <div className={cn("w-2 h-2 rounded-full", stage.color)} />
                <span className="whitespace-nowrap">{stage.title}</span>
                <span className="bg-background/20 px-1.5 py-0.5 rounded-full text-[10px]">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
