import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Calendar, Trash2, Edit2, Play, Users, ShoppingBag, AlertCircle, MessageCircle, Truck, Home } from "lucide-react";
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
import { useEventStore } from "@/stores/eventStore";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface EventStats {
  eventId: string;
  totalOrders: number;
  unpaidOrders: number;
  paidOrders: number;
}

const Events = () => {
  const navigate = useNavigate();
  const { events, isLoading, fetchEvents, createEvent, updateEvent, deleteEvent, setCurrentEvent } = useEventStore();
  
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [shippingCost, setShippingCost] = useState("");
  const [eventStats, setEventStats] = useState<EventStats[]>([]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    // Fetch stats for all events
    const fetchStats = async () => {
      if (events.length === 0) return;
      
      const stats: EventStats[] = [];
      
      for (const event of events) {
        const { data } = await supabase
          .from('orders')
          .select('is_paid')
          .eq('event_id', event.id);
        
        const orders = data || [];
        stats.push({
          eventId: event.id,
          totalOrders: orders.length,
          unpaidOrders: orders.filter((o) => !o.is_paid).length,
          paidOrders: orders.filter((o) => o.is_paid).length,
        });
      }
      
      setEventStats(stats);
    };
    
    fetchStats();
  }, [events]);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    
    const shippingValue = shippingCost ? parseFloat(shippingCost) : undefined;
    
    if (editingEvent) {
      await updateEvent(editingEvent, { 
        name, 
        description,
        default_shipping_cost: shippingValue ?? null
      } as any);
    } else {
      // Create event then update shipping cost
      const eventId = await createEvent(name, description);
      if (eventId && shippingValue) {
        await updateEvent(eventId, { default_shipping_cost: shippingValue } as any);
      }
    }
    
    setDialogOpen(false);
    resetForm();
  };

  const resetForm = () => {
    setName("");
    setDescription("");
    setShippingCost("");
    setEditingEvent(null);
  };

  const handleEdit = (event: { id: string; name: string; description?: string; default_shipping_cost?: number }) => {
    setEditingEvent(event.id);
    setName(event.name);
    setDescription(event.description || "");
    setShippingCost(event.default_shipping_cost?.toString() || "");
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
      paidOrders: 0
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
                    
                    <div className="grid grid-cols-3 gap-2 text-center">
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
      </main>
    </div>
  );
};

export default Events;
