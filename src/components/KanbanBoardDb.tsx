import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { STAGES, OrderStage, Stage } from "@/types/order";
import { OrderCardDb } from "./OrderCardDb";
import { useDbOrderStore } from "@/stores/dbOrderStore";
import { DbOrder } from "@/types/database";

interface KanbanBoardDbProps {
  orders: DbOrder[];
  onEditOrder: (order: DbOrder) => void;
  stages?: Stage[];
}

export function KanbanBoardDb({ orders, onEditOrder, stages = STAGES }: KanbanBoardDbProps) {
  const { moveOrder, deleteOrder } = useDbOrderStore();

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;

    const orderId = result.draggableId;
    const newStage = result.destination.droppableId as OrderStage;

    moveOrder(orderId, newStage);
  };

  // Pedido pago SEMPRE aparece na coluna PAGO, mesmo que a etapa atual não exista
  // nas colunas configuradas (ex.: modo Área de Membros com etapa "no_response").
  const knownStageIds = new Set(stages.map((s) => s.id));
  const hasPaidColumn = knownStageIds.has("paid" as OrderStage);

  const resolveStage = (order: DbOrder): string => {
    if (knownStageIds.has(order.stage as OrderStage)) return order.stage;
    if (hasPaidColumn && isOrderMarkedPaid(order)) return "paid";
    return "__others__";
  };

  const getOrdersByStage = (stage: OrderStage) =>
    orders.filter((order) => resolveStage(order) === stage);

  const orphanOrders = orders.filter((o) => resolveStage(o) === "__others__");
  const columns: Stage[] = orphanOrders.length
    ? [...stages, { id: "__others__" as OrderStage, title: "Outras etapas", color: "bg-muted-foreground" }]
    : stages;


  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4 px-1">
        {columns.map((stage) => {
          const stageOrders =
            (stage.id as string) === "__others__" ? orphanOrders : getOrdersByStage(stage.id);

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
