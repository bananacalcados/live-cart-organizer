import { useEffect, useState } from "react";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { STAGES, OrderStage, Stage } from "@/types/order";
import { OrderCardDb } from "./OrderCardDb";
import { useDbOrderStore } from "@/stores/dbOrderStore";
import { DbOrder } from "@/types/database";
import { isOrderMarkedPaid, isPaidOrderStage } from "@/lib/orderPaymentStages";
import { supabase } from "@/integrations/supabase/client";


interface KanbanBoardDbProps {
  orders: DbOrder[];
  onEditOrder: (order: DbOrder) => void;
  stages?: Stage[];
}

export function KanbanBoardDb({ orders, onEditOrder, stages = STAGES }: KanbanBoardDbProps) {
  const { moveOrder, deleteOrder } = useDbOrderStore();
  // order_id -> cadastro completo (nome + cpf + whatsapp + endereço)
  const [completeRegs, setCompleteRegs] = useState<Record<string, boolean>>({});

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;

    const orderId = result.draggableId;
    const newStage = result.destination.droppableId as OrderStage;

    moveOrder(orderId, newStage);
  };

  const knownStageIds = new Set(stages.map((s) => s.id));
  const hasPaidColumn = knownStageIds.has("paid" as OrderStage);
  const hasAwaitingPayment = knownStageIds.has("awaiting_payment" as OrderStage);
  const hasNew = knownStageIds.has("new" as OrderStage);

  // Pedidos cuja etapa gravada não existe nas colunas configuradas do evento.
  const unknownOrderIds = orders
    .filter((o) => !knownStageIds.has(o.stage as OrderStage) && !isOrderMarkedPaid(o))
    .map((o) => o.id);
  const unknownKey = unknownOrderIds.slice().sort().join(",");

  useEffect(() => {
    const ids = unknownKey ? unknownKey.split(",") : [];
    const missing = ids.filter((id) => completeRegs[id] === undefined);
    if (!missing.length) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("customer_registrations")
        .select("order_id,full_name,cpf,whatsapp,cep,address,city,state")
        .in("order_id", missing.slice(0, 500));
      if (cancelled) return;
      const notPlaceholder = (v?: string | null, ph?: string) =>
        !!(v && v.trim() && (!ph || v.trim().toUpperCase() !== ph.toUpperCase()));
      const next: Record<string, boolean> = {};
      missing.forEach((id) => { next[id] = false; });
      (data || []).forEach((reg: any) => {
        const ok = notPlaceholder(reg.full_name) && notPlaceholder(reg.cpf) && notPlaceholder(reg.whatsapp)
          && notPlaceholder(reg.cep) && reg.cep?.replace(/\D/g, "") !== "00000000"
          && notPlaceholder(reg.address, "Pendente")
          && notPlaceholder(reg.city, "Pendente")
          && notPlaceholder(reg.state);
        if (reg.order_id) next[reg.order_id] = !!ok;
      });
      setCompleteRegs((prev) => ({ ...prev, ...next }));
    })();
    return () => { cancelled = true; };
  }, [unknownKey, completeRegs]);

  /**
   * Tempo real: quando a cliente preenche/atualiza o cadastro na área de
   * membros, o card muda de coluna na hora (NOVO PEDIDO → AGUARDANDO
   * PAGAMENTO) sem precisar recarregar a página.
   */
  const orderIdsKey = orders.map((o) => o.id).sort().join(",");
  useEffect(() => {
    const ids = new Set(orderIdsKey ? orderIdsKey.split(",") : []);
    if (!ids.size) return;
    const channel = supabase
      .channel(`kanban-regs-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "customer_registrations" },
        (payload: any) => {
          const orderId = payload?.new?.order_id || payload?.old?.order_id;
          if (!orderId || !ids.has(orderId)) return;
          setCompleteRegs((prev) => {
            const next = { ...prev };
            delete next[orderId];
            return next;
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [orderIdsKey]);



  // Regra: pago -> PAGO. Cadastro completo mas não pago -> AGUARDANDO PAGAMENTO.
  // Confirmou pedido mas cadastro incompleto -> NOVO PEDIDO. Nunca cai em "Outras etapas".
  const resolveStage = (order: DbOrder): string => {
    // Etapas pós-pagamento (Expedição/Concluído) têm prioridade sobre a coluna PAGO.
    if (knownStageIds.has(order.stage as OrderStage) && isPaidOrderStage(order.stage)) return order.stage;
    if (hasPaidColumn && isOrderMarkedPaid(order)) return "paid";
    if (knownStageIds.has(order.stage as OrderStage)) return order.stage;
    if (hasAwaitingPayment && completeRegs[order.id]) return "awaiting_payment";
    if (hasNew) return "new";
    if (hasAwaitingPayment) return "awaiting_payment";
    return stages[0]?.id as string;
  };

  const getOrdersByStage = (stage: OrderStage) =>
    orders.filter((order) => resolveStage(order) === stage);

  const columns: Stage[] = stages;


  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4 px-1">
        {columns.map((stage) => {
          const stageOrders = getOrdersByStage(stage.id);


          return (
            <div key={stage.id} className="flex-shrink-0 w-80 flex flex-col max-h-[calc(100vh-320px)]">
              <div className="kanban-column flex flex-col h-full">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${stage.color}`} />
                    <h3 className="font-semibold text-foreground text-sm">
                      {stage.title}
                    </h3>
                  </div>
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-xs font-medium">
                    {stageOrders.length}
                  </span>
                </div>

                <Droppable droppableId={stage.id}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`space-y-3 min-h-[200px] flex-1 overflow-y-auto rounded-lg p-1 transition-colors ${
                        snapshot.isDraggingOver ? "bg-primary/5" : ""
                      }`}
                    >
                      {stageOrders.map((order, index) => (
                        <Draggable
                          key={order.id}
                          draggableId={order.id}
                          index={index}
                        >
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                            >
                              <OrderCardDb
                                order={order}
                                onEdit={onEditOrder}
                                onDelete={deleteOrder}
                                isDragging={snapshot.isDragging}
                              />
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                      {stageOrders.length === 0 && !snapshot.isDraggingOver && (
                        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                          <p className="text-sm">Nenhum pedido</p>
                          <p className="text-xs mt-1">Arraste pedidos para cá</p>
                        </div>
                      )}
                    </div>
                  )}
                </Droppable>
              </div>
            </div>
          );
        })}
      </div>
    </DragDropContext>
  );
}
