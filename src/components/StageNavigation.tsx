import { STAGES, OrderStage } from "@/types/order";
import { useOrderStore } from "@/stores/orderStore";
import { cn } from "@/lib/utils";

interface StageNavigationProps {
  selectedStage: OrderStage | "all";
  onSelectStage: (stage: OrderStage | "all") => void;
}

export function StageNavigation({ selectedStage, onSelectStage }: StageNavigationProps) {
  const orders = useOrderStore((state) => state.orders);

  const getCountByStage = (stage: OrderStage) => 
    orders.filter((o) => o.stage === stage).length;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur border-t border-border/40 safe-area-pb">
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
