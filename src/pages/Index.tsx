import { useState, useEffect } from "react";
import { Header } from "@/components/Header";
import { KanbanBoard } from "@/components/KanbanBoard";
import { OrderDialog } from "@/components/OrderDialog";
import { StatsBar } from "@/components/StatsBar";
import { StageNavigation } from "@/components/StageNavigation";
import { useOrderStore } from "@/stores/orderStore";
import { Order, OrderStage } from "@/types/order";

const Index = () => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [selectedStage, setSelectedStage] = useState<OrderStage | "all">("all");
  const orders = useOrderStore((state) => state.orders);
  const checkNoResponseOrders = useOrderStore((state) => state.checkNoResponseOrders);

  // Check for no-response orders every minute
  useEffect(() => {
    const interval = setInterval(() => {
      checkNoResponseOrders();
    }, 60000); // Check every minute

    return () => clearInterval(interval);
  }, [checkNoResponseOrders]);

  const handleNewOrder = () => {
    setEditingOrder(null);
    setDialogOpen(true);
  };

  const handleEditOrder = (order: Order) => {
    setEditingOrder(order);
    setDialogOpen(true);
  };

  const filteredOrders = selectedStage === "all" 
    ? orders 
    : orders.filter((o) => o.stage === selectedStage);

  return (
    <div className="min-h-screen bg-background pb-20">
      <Header onNewOrder={handleNewOrder} />
      
      <main className="container py-6">
        <StatsBar orders={orders} />
        
        <div className="overflow-x-auto">
          <KanbanBoard orders={filteredOrders} onEditOrder={handleEditOrder} />
        </div>
      </main>

      <StageNavigation 
        selectedStage={selectedStage} 
        onSelectStage={setSelectedStage} 
      />

      <OrderDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingOrder={editingOrder}
      />
    </div>
  );
};

export default Index;
