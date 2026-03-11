import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useWhatsAppNumberStore } from "@/stores/whatsappNumberStore";
import { Plus, Calendar, Trash2, Edit2, Play, Users, ShoppingBag, AlertCircle, MessageCircle, Truck, Home, AlertTriangle, Search, Loader2, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ThemeToggle } from "@/components/ThemeToggle";
import { EventsDashboard } from "@/components/events/EventsDashboard";
import { EventTeamManager } from "@/components/events/EventTeamManager";
import { EventTeamSelector } from "@/components/events/EventTeamSelector";
import { EventTeamDisplay } from "@/components/events/EventTeamSelector";
import { useEventStore } from "@/stores/eventStore";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Phone } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface EventStats {
  eventId: string;
  totalOrders: number;
  unpaidOrders: number;
  paidOrders: number;
  missingShopify: number;
}

const Events = () => {
  const navigate = useNavigate();
  const { events, isLoading, fetchEvents, createEvent, updateEvent, deleteEvent, setCurrentEvent } = useEventStore();
  const { numbers: whatsappNumbers, fetchNumbers: fetchWhatsAppNumbers } = useWhatsAppNumberStore();
  
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [shippingCost, setShippingCost] = useState("");
  const [selectedWhatsAppId, setSelectedWhatsAppId] = useState<string>("");
  const [eventStats, setEventStats] = useState<EventStats[]>([]);
  const [verifyingEventId, setVerifyingEventId] = useState<string | null>(null);

  useEffect(() => {
    fetchEvents();
    fetchWhatsAppNumbers();
  }, [fetchEvents]);

  useEffect(() => {
    // Fetch stats for all events and auto-verify Shopify
    const fetchStats = async () => {
      if (events.length === 0) return;
      
      const stats: EventStats[] = [];
      
      for (const event of events) {
        const { data } = await supabase
          .from('orders')
          .select('id, is_paid, paid_externally')
          .eq('event_id', event.id);
        
        const orders = data || [];
        const paidOrders = orders.filter((o) => o.is_paid || o.paid_externally);
        
        stats.push({
          eventId: event.id,
          totalOrders: orders.length,
          unpaidOrders: orders.filter((o) => !o.is_paid && !o.paid_externally).length,
          paidOrders: paidOrders.length,
          missingShopify: -1, // -1 = loading
        });
      }
      
      setEventStats(stats);

      // Auto-verify Shopify for events that have paid orders
      for (const stat of stats) {
        if (stat.paidOrders === 0) {
          setEventStats(prev => prev.map(s => s.eventId === stat.eventId ? { ...s, missingShopify: 0 } : s));
          continue;
        }
        try {
          const { data, error } = await supabase.functions.invoke('shopify-verify-event-orders', {
            body: { eventId: stat.eventId },
          });
          if (error || data?.error) {
            setEventStats(prev => prev.map(s => s.eventId === stat.eventId ? { ...s, missingShopify: 0 } : s));
            continue;
          }
          const results = data.results as { orderId: string; hasShopify: boolean; shopifyOrderName?: string }[];
          const missing = results.filter(r => !r.hasShopify).length;
          sessionStorage.setItem(`shopify-verify-${stat.eventId}`, JSON.stringify(results));
          setEventStats(prev => prev.map(s => s.eventId === stat.eventId ? { ...s, missingShopify: missing } : s));
        } catch {
          setEventStats(prev => prev.map(s => s.eventId === stat.eventId ? { ...s, missingShopify: 0 } : s));
        }
      }
    };
    
    fetchStats();
  }, [events]);

  const handleVerifyShopify = async (eventId: string) => {
    setVerifyingEventId(eventId);
    try {
      const { data, error } = await supabase.functions.invoke('shopify-verify-event-orders', {
        body: { eventId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const results = data.results as { orderId: string; hasShopify: boolean; shopifyOrderName?: string }[];
      const missing = results.filter(r => !r.hasShopify).length;

      // Update stats
      setEventStats(prev => prev.map(s =>
        s.eventId === eventId ? { ...s, missingShopify: missing } : s
      ));

      // Store results in sessionStorage so OrderCardDb can read them
      sessionStorage.setItem(`shopify-verify-${eventId}`, JSON.stringify(results));

      if (missing === 0) {
        toast.success(`✅ Todos os ${results.length} pedidos pagos têm pedido na Shopify!`);
      } else {
        toast.warning(`⚠️ ${missing} de ${results.length} pedidos pagos NÃO foram encontrados na Shopify.`);
      }
    } catch (error: any) {
      toast.error(`Erro ao verificar: ${error.message}`);
    } finally {
      setVerifyingEventId(null);
    }
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    
    const shippingValue = shippingCost ? parseFloat(shippingCost) : undefined;
    const whatsappId = selectedWhatsAppId || null;
    
    if (editingEvent) {
      await updateEvent(editingEvent, { 
        name, 
        description,
        default_shipping_cost: shippingValue ?? null,
        whatsapp_number_id: whatsappId,
      } as any);
    } else {
      const eventId = await createEvent(name, description);
      if (eventId) {
        const updates: any = {};
        if (shippingValue) updates.default_shipping_cost = shippingValue;
        if (whatsappId) updates.whatsapp_number_id = whatsappId;
        if (Object.keys(updates).length > 0) await updateEvent(eventId, updates);
      }
    }
    
    setDialogOpen(false);
    resetForm();
  };

  const resetForm = () => {
    setName("");
    setDescription("");
    setShippingCost("");
    setSelectedWhatsAppId("");
    setEditingEvent(null);
  };

  const handleEdit = (event: { id: string; name: string; description?: string; default_shipping_cost?: number; whatsapp_number_id?: string }) => {
    setEditingEvent(event.id);
    setName(event.name);
    setDescription(event.description || "");
    setShippingCost(event.default_shipping_cost?.toString() || "");
    setSelectedWhatsAppId((event as any).whatsapp_number_id || "");
    setDialogOpen(true);
  };

  const handleOpenEvent = (eventId: string) => {
    setCurrentEvent(eventId);
    navigate("/dashboard");
  };

  const getStats = (eventId: string) => {
    return eventStats.find((s) => s.eventId === eventId) || {
      totalOrders: 0,
      unpaidOrders: 0,
      paidOrders: 0,
      missingShopify: 0,
    };
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="h-6 w-6 text-accent" />
            <h1 className="text-xl font-bold">Eventos / Lives</h1>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={() => navigate('/')} className="gap-1">
              <Home className="h-4 w-4" />
              Início
            </Button>
            <Button variant="outline" onClick={() => navigate('/chat')} className="gap-2">
              <MessageCircle className="h-4 w-4" />
              Chat
            </Button>
            <Dialog open={dialogOpen} onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) resetForm();
            }}>
              <DialogTrigger asChild>
                <Button className="btn-accent">
                  <Plus className="h-4 w-4 mr-2" />
                  Nova Live
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {editingEvent ? "Editar Evento" : "Novo Evento"}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Nome do Evento *</Label>
                    <Input
                      id="name"
                      placeholder="Ex: Live de Verão 2024"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">Descrição</Label>
                    <Textarea
                      id="description"
                      placeholder="Descrição opcional..."
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                  />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="shipping" className="flex items-center gap-2">
                      <Truck className="h-4 w-4" />
                      Frete Fixo (R$)
                    </Label>
                    <Input
                      id="shipping"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Ex: 19.99 (deixe vazio se não cobrar)"
                      value={shippingCost}
                      onChange={(e) => setShippingCost(e.target.value)}
                    />
                     <p className="text-xs text-muted-foreground">
                       Se definido, será aplicado automaticamente ao primeiro pedido de cada cliente. A partir do 2º pedido no mesmo evento, o frete é grátis.
                     </p>
                   </div>
                   <div className="space-y-2">
                     <Label className="flex items-center gap-2">
                       <Phone className="h-4 w-4" />
                       WhatsApp do Evento
                     </Label>
                     <Select value={selectedWhatsAppId} onValueChange={setSelectedWhatsAppId}>
                       <SelectTrigger>
                         <SelectValue placeholder="Selecione o número WhatsApp..." />
                       </SelectTrigger>
                       <SelectContent>
                         <SelectItem value="none">Nenhum (padrão)</SelectItem>
                         {whatsappNumbers.map(n => (
                           <SelectItem key={n.id} value={n.id}>
                             {n.label} ({n.phone_display})
                           </SelectItem>
                         ))}
                       </SelectContent>
                     </Select>
                     <p className="text-xs text-muted-foreground">
                       Número WhatsApp que será usado para disparos automáticos neste evento (ex: agente de cobrança).
                     </p>
                   </div>
                  {editingEvent && (
                    <EventTeamSelector eventId={editingEvent} />
                  )}
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        setDialogOpen(false);
                        resetForm();
                      }}
                    >
                      Cancelar
                    </Button>
                    <Button
                      className="flex-1 btn-accent"
                      onClick={handleSubmit}
                      disabled={!name.trim()}
                    >
                      {editingEvent ? "Salvar" : "Criar Evento"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </header>

      <main className="container py-6">
        <Tabs defaultValue="events">
          <TabsList className="mb-4">
            <TabsTrigger value="events" className="gap-1">
              <Calendar className="h-4 w-4" /> Eventos
            </TabsTrigger>
            <TabsTrigger value="team" className="gap-1">
              <UserCheck className="h-4 w-4" /> Equipe
            </TabsTrigger>
          </TabsList>

          <TabsContent value="events">
            <EventsDashboard />
            
            {isLoading ? (
              <div className="text-center py-12 text-muted-foreground">
                Carregando eventos...
              </div>
            ) : events.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">Nenhum evento criado</h3>
                  <p className="text-muted-foreground text-center mb-4">
                    Crie seu primeiro evento para começar a organizar os pedidos das lives.
                  </p>
                  <Button className="btn-accent" onClick={() => setDialogOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Criar Primeiro Evento
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {events.map((event) => {
                  const stats = getStats(event.id);
                  return (
                    <Card key={event.id} className="hover:shadow-lg transition-shadow">
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between">
                          <div>
                            <CardTitle className="text-lg">{event.name}</CardTitle>
                            <CardDescription>
                              {format(new Date(event.created_at), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
                            </CardDescription>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleEdit(event)}
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive hover:text-destructive"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Excluir evento?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Esta ação não pode ser desfeita. Todos os pedidos deste evento serão excluídos permanentemente.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                  <AlertDialogAction
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    onClick={() => deleteEvent(event.id)}
                                  >
                                    Excluir
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {event.description && (
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {event.description}
                          </p>
                        )}
                        {(event as any).default_shipping_cost && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Truck className="h-4 w-4" />
                            <span>Frete fixo: <strong>R$ {Number((event as any).default_shipping_cost).toFixed(2)}</strong></span>
                          </div>
                        )}
                        {(event as any).whatsapp_number_id && (() => {
                          const wn = whatsappNumbers.find(n => n.id === (event as any).whatsapp_number_id);
                          return wn ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Phone className="h-4 w-4" />
                              <span>WhatsApp: <strong>{wn.label}</strong></span>
                            </div>
                          ) : null;
                        })()}

                        {/* Team avatars */}
                        <EventTeamDisplay eventId={event.id} />
                        
                        <div className="grid grid-cols-4 gap-2 text-center">
                          <div className="bg-secondary/50 rounded-lg p-2">
                            <ShoppingBag className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                            <p className="text-lg font-bold">{stats.totalOrders}</p>
                            <p className="text-xs text-muted-foreground">Total</p>
                          </div>
                          <div className="bg-stage-awaiting/20 rounded-lg p-2">
                            <AlertCircle className="h-4 w-4 mx-auto mb-1 text-stage-awaiting" />
                            <p className="text-lg font-bold text-stage-awaiting">{stats.unpaidOrders}</p>
                            <p className="text-xs text-muted-foreground">Não Pagos</p>
                          </div>
                          <div className="bg-stage-paid/20 rounded-lg p-2">
                            <Users className="h-4 w-4 mx-auto mb-1 text-stage-paid" />
                            <p className="text-lg font-bold text-stage-paid">{stats.paidOrders}</p>
                            <p className="text-xs text-muted-foreground">Pagos</p>
                          </div>
                          {stats.missingShopify >= 0 ? (
                            <div className={`rounded-lg p-2 cursor-pointer ${stats.missingShopify > 0 ? 'bg-destructive/10 animate-pulse' : 'bg-stage-paid/10'}`} onClick={() => handleVerifyShopify(event.id)}>
                              <AlertTriangle className={`h-4 w-4 mx-auto mb-1 ${stats.missingShopify > 0 ? 'text-destructive' : 'text-stage-paid'}`} />
                              <p className={`text-lg font-bold ${stats.missingShopify > 0 ? 'text-destructive' : 'text-stage-paid'}`}>{stats.missingShopify}</p>
                              <p className="text-xs text-muted-foreground">Sem Shopify</p>
                            </div>
                          ) : (
                            <div className="rounded-lg p-2 bg-secondary/50">
                              <Loader2 className="h-4 w-4 mx-auto mb-1 text-muted-foreground animate-spin" />
                              <p className="text-xs font-medium text-muted-foreground mt-1">Verificando...</p>
                            </div>
                          )}
                        </div>

                        <Button
                          className="w-full btn-accent"
                          onClick={() => handleOpenEvent(event.id)}
                        >
                          <Play className="h-4 w-4 mr-2" />
                          Abrir Evento
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="team">
            <EventTeamManager />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Events;
