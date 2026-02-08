import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Header } from "@/components/Header";
import { KanbanBoard } from "@/components/KanbanBoard";
import { OrderDialogDb } from "@/components/OrderDialogDb";
import { StatsBar } from "@/components/StatsBar";
import { StageNavigation } from "@/components/StageNavigation";
import { useEventStore } from "@/stores/eventStore";
import { useCustomerStore } from "@/stores/customerStore";
import { useDbOrderStore } from "@/stores/dbOrderStore";
import { DbOrder, DbCustomer } from "@/types/database";
import { Order, OrderStage } from "@/types/order";
import { Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";

// Convert DbOrder to Order format for compatibility with existing components
const dbOrderToOrder = (dbOrder: DbOrder): Order => ({
  id: dbOrder.id,
  instagramHandle: dbOrder.customer?.instagram_handle || '',
  whatsapp: dbOrder.customer?.whatsapp,
  cartLink: dbOrder.cart_link,
  products: dbOrder.products,
  stage: dbOrder.stage as OrderStage,
  notes: dbOrder.notes,
  createdAt: new Date(dbOrder.created_at),
  updatedAt: new Date(dbOrder.updated_at),
  hasUnreadMessages: dbOrder.has_unread_messages,
  lastCustomerMessageAt: dbOrder.last_customer_message_at ? new Date(dbOrder.last_customer_message_at) : undefined,
  lastSentMessageAt: dbOrder.last_sent_message_at ? new Date(dbOrder.last_sent_message_at) : undefined,
});

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

  const handleEditOrder = (order: Order) => {
    const dbOrder = orders.find((o) => o.id === order.id);
    if (dbOrder) {
      setEditingOrder(dbOrder);
      setDialogOpen(true);
    }
  };

  // Convert orders for KanbanBoard
  const convertedOrders = orders.map(dbOrderToOrder);
  
  const filteredOrders = selectedStage === "all" 
    ? convertedOrders 
    : convertedOrders.filter((o) => o.stage === selectedStage);

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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/events")}
            >
              Trocar Evento
            </Button>
          </div>
        </div>
      )}
      
      <main className="container py-6">
        <StatsBar orders={convertedOrders} />
        
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">
            Carregando pedidos...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <KanbanBoard orders={filteredOrders} onEditOrder={handleEditOrder} />
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
    </div>
  );
};

export default Index;
