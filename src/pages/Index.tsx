import { useState } from "react";
import { Header } from "@/components/Header";
import { KanbanBoard } from "@/components/KanbanBoard";
import { OrderDialog } from "@/components/OrderDialog";
import { StatsBar } from "@/components/StatsBar";
import { useOrderStore } from "@/stores/orderStore";
import { Order } from "@/types/order";

const Index = () => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const orders = useOrderStore((state) => state.orders);

  const handleNewOrder = () => {
    setEditingOrder(null);
    setDialogOpen(true);
  };

  const handleEditOrder = (order: Order) => {
    setEditingOrder(order);
    setDialogOpen(true);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header onNewOrder={handleNewOrder} />
      
      <main className="container py-6">
        <StatsBar orders={orders} />
        
        <div className="overflow-x-auto">
          <KanbanBoard orders={orders} onEditOrder={handleEditOrder} />
        </div>
      </main>

      <OrderDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingOrder={editingOrder}
      />
    </div>
  );
};

export default Index;
