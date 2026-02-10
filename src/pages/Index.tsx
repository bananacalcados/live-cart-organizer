import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Header } from "@/components/Header";
import { KanbanBoardDb } from "@/components/KanbanBoardDb";
import { OrderDialogDb } from "@/components/OrderDialogDb";
import { StatsBar } from "@/components/StatsBar";
import { StageNavigation } from "@/components/StageNavigation";
import { OrderReportDialog } from "@/components/OrderReportDialog";
import { GlobalWhatsAppChat } from "@/components/GlobalWhatsAppChat";
import { PrizeEligibleList } from "@/components/PrizeEligibleList";
import { EventPromotionManager } from "@/components/EventPromotionManager";
import { useEventStore } from "@/stores/eventStore";
import { useCustomerStore } from "@/stores/customerStore";
import { useDbOrderStore } from "@/stores/dbOrderStore";
import { DbOrder } from "@/types/database";
import { OrderStage } from "@/types/order";
import { Calendar, Search, Trophy, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const Index = () => {
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<DbOrder | null>(null);
  const [selectedStage, setSelectedStage] = useState<OrderStage | "all" | "unpaid">("all");
  const [searchQuery, setSearchQuery] = useState("");
  
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

  // Filter orders by stage and search
  const filteredOrders = orders.filter((o) => {
    // Stage/unpaid filter
    if (selectedStage === "unpaid") {
      if (o.is_paid) return false;
    } else if (selectedStage !== "all") {
      if (o.stage !== selectedStage) return false;
    }
    
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const qDigits = searchQuery.replace(/\D/g, '');
    const instagram = o.customer?.instagram_handle?.toLowerCase() || '';
    const whatsapp = o.customer?.whatsapp?.replace(/\D/g, '') || '';
    return instagram.includes(q) || (qDigits && whatsapp.includes(qDigits));
  });

  const unpaidCount = getUnpaidOrdersCount(currentEventId || undefined);

  if (!currentEventId) {
    return null; // Will redirect
  }

  return (
    <div className="min-h-screen bg-background">
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
      
      <StageNavigation 
        selectedStage={selectedStage} 
        onSelectStage={setSelectedStage} 
      />

      <main className="container py-6">
        <Tabs defaultValue="kanban" className="w-full">
          <div className="flex items-center gap-2 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por @ ou WhatsApp..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <TabsList className="ml-auto">
              <TabsTrigger value="kanban">Pedidos</TabsTrigger>
              <TabsTrigger value="promotions" className="gap-1">
                <Tag className="h-3 w-3" />
                Promoções
              </TabsTrigger>
              <TabsTrigger value="prizes" className="gap-1">
                <Trophy className="h-3 w-3" />
                Roleta
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="kanban">
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
          </TabsContent>

          <TabsContent value="promotions">
            <EventPromotionManager eventId={currentEventId} />
          </TabsContent>

          <TabsContent value="prizes">
            <PrizeEligibleList eventId={currentEventId} />
          </TabsContent>
        </Tabs>
      </main>

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
