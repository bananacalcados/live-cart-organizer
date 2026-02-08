import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { Order, STAGES, OrderStage } from "@/types/order";
import { OrderCard } from "./OrderCard";
import { useOrderStore } from "@/stores/orderStore";

interface KanbanBoardProps {
  orders: Order[];
  onEditOrder: (order: Order) => void;
}

export function KanbanBoard({ orders, onEditOrder }: KanbanBoardProps) {
  const { moveOrder, deleteOrder } = useOrderStore();

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;

    const orderId = result.draggableId;
    const newStage = result.destination.droppableId as OrderStage;

    moveOrder(orderId, newStage);
  };

  const getOrdersByStage = (stage: OrderStage) =>
    orders.filter((order) => order.stage === stage);

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4 px-1">
        {STAGES.map((stage) => {
          const stageOrders = getOrdersByStage(stage.id);
          return (
            <div key={stage.id} className="flex-shrink-0 w-80">
              <div className="kanban-column">
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
                      className={`space-y-3 min-h-[400px] rounded-lg p-1 transition-colors ${
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
                              <OrderCard
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
