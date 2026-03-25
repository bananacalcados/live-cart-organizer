import { useState, useEffect, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { DashboardChatPanel } from "@/components/DashboardChatPanel";
import { Header } from "@/components/Header";
import { KanbanBoardDb } from "@/components/KanbanBoardDb";
import { OrderDialogDb } from "@/components/OrderDialogDb";
import { StatsBar } from "@/components/StatsBar";
import { StageNavigation } from "@/components/StageNavigation";
import { OrderReportDialog } from "@/components/OrderReportDialog";

import { PrizeEligibleList } from "@/components/PrizeEligibleList";
import { EventPromotionManager } from "@/components/EventPromotionManager";
import { MetaTemplateCreator } from "@/components/MetaTemplateCreator";
import { ActiveProductBar } from "@/components/events/ActiveProductBar";
import { EventTeamDisplay } from "@/components/events/EventTeamSelector";
import { EventStockAlerts } from "@/components/events/EventStockAlerts";
import { EventCartsPanel } from "@/components/events/EventCartsPanel";
import { useEventStore } from "@/stores/eventStore";
import { useCustomerStore } from "@/stores/customerStore";
import { useDbOrderStore } from "@/stores/dbOrderStore";
import { DbOrder } from "@/types/database";
import { OrderStage } from "@/types/order";
import { Calendar, Search, Trophy, Tag, MessageSquare, ShoppingCart, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

const Index = () => {
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<DbOrder | null>(null);
  const [selectedStage, setSelectedStage] = useState<OrderStage | "all" | "unpaid">("all");
  const [searchQuery, setSearchQuery] = useState("");
  
  const { currentEventId, getCurrentEvent, fetchEvents, updateEvent } = useEventStore();
  const { fetchCustomers } = useCustomerStore();
  const { orders, isLoading, fetchOrdersByEvent, checkNoResponseOrders, getUnpaidOrdersCount, subscribeToEventOrders } = useDbOrderStore();

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

  useEffect(() => {
    if (!currentEventId) return;

    const unsubscribe = subscribeToEventOrders(currentEventId);
    return unsubscribe;
  }, [currentEventId, subscribeToEventOrders]);

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
    <div className="min-h-screen bg-background flex">
      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <Header onNewOrder={handleNewOrder} />
        
        {currentEvent && (
          <div className="container py-2">
            <div className="flex items-center justify-between bg-secondary/50 rounded-lg px-4 py-2">
              <div className="flex items-center gap-3">
                <Calendar className="h-4 w-4 text-accent" />
                <span className="font-medium">{currentEvent.name}</span>
                {unpaidCount > 0 && (
                  <span className="text-sm text-stage-awaiting">
                    ({unpaidCount} não pago{unpaidCount !== 1 ? 's' : ''})
                  </span>
                )}
                <EventTeamDisplay eventId={currentEventId} />
                <div 
                  className={`flex items-center gap-2 rounded-full px-4 py-1.5 cursor-pointer transition-colors ${
                    currentEvent.automation_enabled 
                      ? 'bg-green-100 dark:bg-green-900/40 border-2 border-green-500' 
                      : 'bg-muted border-2 border-border'
                  }`}
                  onClick={async () => {
                    const newVal = !currentEvent.automation_enabled;
                    await updateEvent(currentEventId, { automation_enabled: newVal } as any);
                    toast.success(newVal ? 'Modo automatizado ativado!' : 'Modo automatizado desativado');
                  }}
                >
                  <Zap className={`h-5 w-5 ${currentEvent.automation_enabled ? 'text-green-600' : 'text-muted-foreground'}`} />
                  <span className={`text-sm font-bold ${currentEvent.automation_enabled ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground'}`}>
                    {currentEvent.automation_enabled ? '⚡ AUTOMAÇÃO ATIVADA' : 'AUTOMAÇÃO DESATIVADA'}
                  </span>
                </div>
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

        {currentEventId && currentEvent && (
          <ActiveProductBar eventId={currentEventId} eventName={currentEvent.name} />
        )}
        
        <StageNavigation 
          selectedStage={selectedStage} 
          onSelectStage={setSelectedStage} 
        />

        {currentEventId && (
          <div className="container py-2">
            <EventStockAlerts eventId={currentEventId} />
          </div>
        )}

        <main className="container py-6 flex-1">
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
                <TabsTrigger value="meta-templates" className="gap-1">
                  <MessageSquare className="h-3 w-3" />
                  Templates API
                </TabsTrigger>
                {currentEvent?.catalog_lead_page_id && (
                  <TabsTrigger value="carts" className="gap-1">
                    <ShoppingCart className="h-3 w-3" />
                    Carrinhos
                  </TabsTrigger>
                )}
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

            <TabsContent value="meta-templates">
              <MetaTemplateCreator />
            </TabsContent>

            {currentEvent?.catalog_lead_page_id && (
              <TabsContent value="carts">
                <EventCartsPanel catalogLeadPageId={currentEvent.catalog_lead_page_id} />
              </TabsContent>
            )}
          </Tabs>
        </main>

        <OrderDialogDb
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          editingOrder={editingOrder}
          eventId={currentEventId}
        />
      </div>

      {/* Fixed WhatsApp Chat Panel - Right Side */}
      <div className="hidden xl:flex w-[420px] flex-shrink-0 h-screen sticky top-0">
        <DashboardChatPanel />
      </div>
    </div>
  );
};

export default Index;
