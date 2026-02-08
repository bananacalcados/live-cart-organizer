import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Header } from "@/components/Header";
import { KanbanBoardDb } from "@/components/KanbanBoardDb";
import { OrderDialogDb } from "@/components/OrderDialogDb";
import { StatsBar } from "@/components/StatsBar";
import { StageNavigation } from "@/components/StageNavigation";
import { OrderReportDialog } from "@/components/OrderReportDialog";
import { GlobalWhatsAppChat } from "@/components/GlobalWhatsAppChat";
import { useEventStore } from "@/stores/eventStore";
import { useCustomerStore } from "@/stores/customerStore";
import { useDbOrderStore } from "@/stores/dbOrderStore";
import { DbOrder } from "@/types/database";
import { OrderStage } from "@/types/order";
import { Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";

const Index = () => {
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<DbOrder | null>(null);
  const [selectedStage, setSelectedStage] = useState<OrderStage | "all">("all");
  
  const { currentEventId, getCurrentEvent, fetchEvents } = useEventStore();
  const { fetchCustomers } = useCustomerStore();
  const { orders, isLoading, fetchOrdersByEvent, checkNoResponseOrders, getUnpaidOrdersCount } = useDbOrderStore();

  const currentEvent = getCurrentEvent();

  // Fetch events on mount
  useEffect(() => {
    fetchEvents();
    fetchCustomers();
  }, [fetchEvents, fetchCustomers]);

  // Redirect to events page if no event selected
  useEffect(() => {
    if (!currentEventId) {
      navigate("/events");
    }
  }, [currentEventId, navigate]);

  // Fetch orders when event changes
  useEffect(() => {
    if (currentEventId) {
      fetchOrdersByEvent(currentEventId);
    }
  }, [currentEventId, fetchOrdersByEvent]);

  // Check for no-response orders every minute
  useEffect(() => {
    const interval = setInterval(() => {
      checkNoResponseOrders();
    }, 60000);

    return () => clearInterval(interval);
  }, [checkNoResponseOrders]);

  const handleNewOrder = () => {
    setEditingOrder(null);
    setDialogOpen(true);
  };

  const handleEditOrder = (order: DbOrder) => {
    setEditingOrder(order);
    setDialogOpen(true);
  };

  // Filter orders by stage
  const filteredOrders = selectedStage === "all" 
    ? orders 
    : orders.filter((o) => o.stage === selectedStage);

  const unpaidCount = getUnpaidOrdersCount(currentEventId || undefined);

  if (!currentEventId) {
    return null; // Will redirect
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <Header onNewOrder={handleNewOrder} />
      
      {currentEvent && (
        <div className="container py-2">
          <div className="flex items-center justify-between bg-secondary/50 rounded-lg px-4 py-2">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-accent" />
              <span className="font-medium">{currentEvent.name}</span>
              {unpaidCount > 0 && (
                <span className="text-sm text-stage-awaiting">
                  ({unpaidCount} não pago{unpaidCount !== 1 ? 's' : ''})
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <OrderReportDialog orders={orders} />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/events")}
              >
                Trocar Evento
              </Button>
            </div>
          </div>
        </div>
      )}
      
      <main className="container py-6">
        <StatsBar orders={orders} />
        
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">
            Carregando pedidos...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <KanbanBoardDb orders={filteredOrders} onEditOrder={handleEditOrder} />
          </div>
        )}
      </main>

      <StageNavigation 
        selectedStage={selectedStage} 
        onSelectStage={setSelectedStage} 
      />

      <OrderDialogDb
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingOrder={editingOrder}
        eventId={currentEventId}
      />

      {/* Global WhatsApp Chat */}
      <GlobalWhatsAppChat />
    </div>
  );
};

export default Index;
