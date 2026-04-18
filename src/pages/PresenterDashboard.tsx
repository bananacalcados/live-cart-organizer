import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Bell, BellRing, DollarSign, ShoppingCart, Clock, AlertTriangle,
  Eye, CheckCircle, X, Volume2, VolumeX, ArrowLeft, Users, TrendingUp, Package,
  MessageCircle, CheckCheck, MessageSquareX, Send
} from "lucide-react";
import { ActiveProductBar } from "@/components/events/ActiveProductBar";
import { WhatsAppChat } from "@/components/WhatsAppChat";
import { LiveInstagramComments } from "@/components/events/LiveInstagramComments";
import { Instagram } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";

interface PresenterAlert {
  id: string;
  alert_type: string;
  message: string;
  product_title: string | null;
  customer_name: string | null;
  phone: string;
  is_read: boolean;
  created_at: string;
}

interface OrderSummary {
  id: string;
  customer_name: string;
  products: any[];
  total: number;
  stage: string;
  stage_atendimento: string;
  created_at: string;
  whatsapp: string | null;
  customerReplied: boolean;
  lastSentAt: string | null;
  lastCustomerAt: string | null;
}

const alertTypeConfig: Record<string, { label: string; color: string; icon: typeof Bell }> = {
  show_product_again: { label: "Mostrar Produto", color: "bg-blue-500/20 text-blue-400 border-blue-500/30", icon: Eye },
  new_order_unpaid: { label: "Novo Pedido", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", icon: ShoppingCart },
  customer_issue: { label: "Problema", color: "bg-red-500/20 text-red-400 border-red-500/30", icon: AlertTriangle },
  returning_desistente: { label: "Desistente Retornou", color: "bg-orange-500/20 text-orange-400 border-orange-500/30", icon: AlertTriangle },
  missing_whatsapp: { label: "📱 Sem WhatsApp", color: "bg-pink-500/20 text-pink-400 border-pink-500/30", icon: AlertTriangle },
  general: { label: "Geral", color: "bg-gray-500/20 text-gray-400 border-gray-500/30", icon: Bell },
};

export default function PresenterDashboard() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<PresenterAlert[]>([]);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [metrics, setMetrics] = useState({ totalPaid: 0, totalRevenue: 0, avgTicket: 0, pendingCount: 0 });
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [eventName, setEventName] = useState("");
  const [chatOrder, setChatOrder] = useState<OrderSummary | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Create audio element for notifications
  useEffect(() => {
    const audio = new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=");
    audioRef.current = audio;
    // Use Web Audio API for a simple notification beep
    return () => { audioRef.current = null; };
  }, []);

  const playNotificationSound = useCallback(() => {
    if (!soundEnabled) return;
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
    } catch {}
  }, [soundEnabled]);

  // Load event info
  useEffect(() => {
    if (!eventId) return;
    supabase.from("events").select("name").eq("id", eventId).single().then(({ data }) => {
      if (data) setEventName(data.name);
    });
  }, [eventId]);

  // Load alerts
  const loadAlerts = useCallback(async () => {
    if (!eventId) return;
    const { data } = await supabase
      .from("livete_presenter_alerts")
      .select("*")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (data) setAlerts(data as PresenterAlert[]);
  }, [eventId]);

  // Load orders and metrics
  const loadOrders = useCallback(async () => {
    if (!eventId) return;
    const { data: ordersData } = await supabase
      .from("orders")
      .select("id, customer_id, products, stage, stage_atendimento, is_paid, paid_at, free_shipping, shipping_cost, discount_type, discount_value, created_at, last_customer_message_at, last_sent_message_at")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false });

    if (!ordersData) return;

    // Get customer info
    const customerIds = [...new Set(ordersData.map(o => o.customer_id))];
    const { data: customers } = await supabase
      .from("customers")
      .select("id, instagram_handle, whatsapp")
      .in("id", customerIds);

    const customerMap = new Map((customers || []).map(c => [c.id, { name: c.instagram_handle, whatsapp: c.whatsapp }]));

    const mapped: OrderSummary[] = ordersData.map(o => {
      const products = (o.products as any[]) || [];
      const subtotal = products.reduce((s: number, p: any) => s + Number(p.price || 0) * Number(p.quantity || 1), 0);
      const cust = customerMap.get(o.customer_id);
      const lastSent = o.last_sent_message_at as string | null;
      const lastCustomer = o.last_customer_message_at as string | null;
      return {
        id: o.id,
        customer_name: cust?.name || "Cliente",
        whatsapp: cust?.whatsapp || null,
        products,
        total: subtotal,
        stage: o.stage,
        stage_atendimento: o.stage_atendimento || "",
        created_at: o.created_at,
        customerReplied: !!lastCustomer && !!lastSent && new Date(lastCustomer) > new Date(lastSent),
        lastSentAt: lastSent,
        lastCustomerAt: lastCustomer,
      };
    });

    setOrders(mapped);

    // Metrics
    const paidOrders = ordersData.filter(o => o.is_paid);
    const totalRevenue = paidOrders.reduce((s, o) => {
      const prods = (o.products as any[]) || [];
      return s + prods.reduce((ps: number, p: any) => ps + Number(p.price || 0) * Number(p.quantity || 1), 0);
    }, 0);
    const pendingOrders = ordersData.filter(o => !o.is_paid && o.stage !== "cancelled");

    setMetrics({
      totalPaid: paidOrders.length,
      totalRevenue,
      avgTicket: paidOrders.length > 0 ? totalRevenue / paidOrders.length : 0,
      pendingCount: pendingOrders.length,
    });
  }, [eventId]);

  useEffect(() => {
    loadAlerts();
    loadOrders();
  }, [loadAlerts, loadOrders]);

  // Realtime subscription for alerts
  useEffect(() => {
    if (!eventId) return;
    const channel = supabase
      .channel(`presenter-alerts-${eventId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "livete_presenter_alerts",
        filter: `event_id=eq.${eventId}`,
      }, (payload) => {
        const newAlert = payload.new as PresenterAlert;
        setAlerts(prev => [newAlert, ...prev]);
        playNotificationSound();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [eventId, playNotificationSound]);

  // Realtime for orders
  useEffect(() => {
    if (!eventId) return;
    const channel = supabase
      .channel(`presenter-orders-${eventId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "orders",
        filter: `event_id=eq.${eventId}`,
      }, () => {
        loadOrders();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [eventId, loadOrders]);

  const markAsRead = async (alertId: string) => {
    await supabase.from("livete_presenter_alerts").update({ is_read: true }).eq("id", alertId);
    setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, is_read: true } : a));
  };

  const dismissAlert = async (alertId: string) => {
    setAlerts(prev => prev.filter(a => a.id !== alertId));
    await supabase.from("livete_presenter_alerts").update({ is_read: true }).eq("id", alertId);
  };

  const unreadCount = alerts.filter(a => !a.is_read).length;
  const pendingPaymentOrders = orders.filter(o => o.stage !== "cancelled" && o.stage !== "paid" && o.stage_atendimento !== "pago");

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };

  const stageLabel = (stage: string) => {
    const map: Record<string, string> = {
      endereco: "📍 Endereço",
      confirmar_endereco: "✅ Confirmar End.",
      dados_pessoais: "👤 Dados",
      forma_pagamento: "💳 Pagamento",
      aguardando_pix: "⏳ Aguard. PIX",
      aguardando_cartao: "💳 Aguard. Cartão",
      aguardando_boleto: "📄 Aguard. Boleto",
      aguardando_pagamento_loja: "🏪 Pagar na Loja",
      pago: "✅ Pago",
      cancelado: "❌ Cancelado",
    };
    return map[stage] || stage;
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      {/* Main content */}
      <div className="flex-1 p-4 md:p-6 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/events")} className="text-foreground hover:bg-muted">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl md:text-2xl font-bold">🎬 Painel da Apresentadora</h1>
            <p className="text-sm text-muted-foreground">{eventName || "Carregando..."}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="text-foreground hover:bg-muted"
          >
            {soundEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
          </Button>
          {unreadCount > 0 && (
            <Badge className="bg-destructive text-destructive-foreground animate-pulse text-lg px-3 py-1">
              <BellRing className="h-4 w-4 mr-1" /> {unreadCount}
            </Badge>
          )}
        </div>
      </div>

      {/* Metrics Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Card className="bg-green-900/30 border-green-700/50">
          <CardContent className="p-4 flex items-center gap-3">
            <DollarSign className="h-8 w-8 text-green-400" />
            <div>
              <p className="text-xs text-green-300">Faturamento</p>
              <p className="text-xl font-bold text-green-100">R$ {metrics.totalRevenue.toFixed(0)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-blue-900/30 border-blue-700/50">
          <CardContent className="p-4 flex items-center gap-3">
            <CheckCircle className="h-8 w-8 text-blue-400" />
            <div>
              <p className="text-xs text-blue-300">Pedidos Pagos</p>
              <p className="text-xl font-bold text-blue-100">{metrics.totalPaid}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-purple-900/30 border-purple-700/50">
          <CardContent className="p-4 flex items-center gap-3">
            <TrendingUp className="h-8 w-8 text-purple-400" />
            <div>
              <p className="text-xs text-purple-300">Ticket Médio</p>
              <p className="text-xl font-bold text-purple-100">R$ {metrics.avgTicket.toFixed(0)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-yellow-900/30 border-yellow-700/50">
          <CardContent className="p-4 flex items-center gap-3">
            <Clock className="h-8 w-8 text-yellow-400" />
            <div>
              <p className="text-xs text-yellow-300">Aguardando</p>
              <p className="text-xl font-bold text-yellow-100">{metrics.pendingCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="live" className="flex-1">
        <TabsList className="mb-4 bg-muted-foreground/10">
          <TabsTrigger value="live" className="gap-1 data-[state=active]:bg-primary/20">
            <Bell className="h-4 w-4" /> Alertas & Pedidos
          </TabsTrigger>
          <TabsTrigger value="instagram" className="gap-1 data-[state=active]:bg-primary/20">
            <Instagram className="h-4 w-4" /> Comentários IG
          </TabsTrigger>
          <TabsTrigger value="catalog" className="gap-1 data-[state=active]:bg-primary/20">
            <Package className="h-4 w-4" /> Catálogo da Live
          </TabsTrigger>
        </TabsList>

        <TabsContent value="live">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Alerts Column */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Bell className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-bold">Alertas</h2>
                {unreadCount > 0 && (
                  <Badge variant="destructive" className="animate-pulse">{unreadCount} novos</Badge>
                )}
              </div>
              <ScrollArea className="h-[calc(100vh-380px)]">
                <div className="space-y-3 pr-2">
                  {alerts.length === 0 && (
                    <Card className="bg-muted-foreground/10 border-muted-foreground/20">
                      <CardContent className="p-6 text-center text-muted-foreground">
                        Nenhum alerta ainda. Os alertas da IA aparecerão aqui em tempo real 🔔
                      </CardContent>
                    </Card>
                  )}
                  {alerts.map(alert => {
                    const config = alertTypeConfig[alert.alert_type] || alertTypeConfig.general;
                    const Icon = config.icon;
                    return (
                      <Card
                        key={alert.id}
                        className={`border transition-all ${
                          !alert.is_read
                            ? "bg-primary/10 border-primary/40 shadow-lg shadow-primary/10"
                            : "bg-muted-foreground/5 border-muted-foreground/15"
                        }`}
                      >
                        <CardContent className="p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2 flex-1">
                              <div className={`p-1.5 rounded-lg border ${config.color} mt-0.5`}>
                                <Icon className="h-4 w-4" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <Badge variant="outline" className={`text-[10px] ${config.color}`}>
                                    {config.label}
                                  </Badge>
                                  <span className="text-[10px] text-muted-foreground">{formatTime(alert.created_at)}</span>
                                </div>
                                <p className="text-sm font-medium">{alert.message}</p>
                                {alert.product_title && (
                                  <p className="text-xs text-muted-foreground mt-1">🏷️ {alert.product_title}</p>
                                )}
                                {alert.customer_name && (
                                  <p className="text-xs text-muted-foreground">👤 {alert.customer_name}</p>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-1">
                              {!alert.is_read && (
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-primary hover:bg-primary/20" onClick={() => markAsRead(alert.id)}>
                                  <CheckCircle className="h-4 w-4" />
                                </Button>
                              )}
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:bg-destructive/20 hover:text-destructive" onClick={() => dismissAlert(alert.id)}>
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>

            {/* Pending Orders Column */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Users className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-bold">Pedidos Pendentes</h2>
                <Badge className="bg-yellow-600">{pendingPaymentOrders.length}</Badge>
              </div>
              <ScrollArea className="h-[calc(100vh-380px)]">
                <div className="space-y-2 pr-2">
                  {pendingPaymentOrders.length === 0 && (
                    <Card className="bg-muted-foreground/10 border-muted-foreground/20">
                      <CardContent className="p-6 text-center text-muted-foreground">
                        Nenhum pedido pendente 🎉
                      </CardContent>
                    </Card>
                  )}
                  {pendingPaymentOrders.map(order => {
                    const replyStatus = !order.lastSentAt
                      ? "not_sent"
                      : order.customerReplied
                        ? "replied"
                        : "awaiting";
                    return (
                    <Card key={order.id} className="bg-muted-foreground/5 border-muted-foreground/15 hover:bg-muted-foreground/10 transition-colors">
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-base text-yellow-400">@{order.customer_name}</span>
                          <span className="text-[10px] text-muted-foreground">{formatTime(order.created_at)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px]">
                              {stageLabel(order.stage_atendimento || order.stage)}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {order.products.length} item(s)
                            </span>
                          </div>
                          <span className="font-bold text-sm text-primary">
                            R$ {order.total.toFixed(2)}
                          </span>
                        </div>

                        {/* Reply status + WhatsApp button */}
                        <div className="flex items-center justify-between mt-2">
                          <div className="flex items-center gap-1.5">
                            {replyStatus === "replied" && (
                              <Badge className="bg-green-600/20 text-green-400 border-green-600/30 text-[10px] gap-1">
                                <CheckCheck className="h-3 w-3" /> Respondeu
                              </Badge>
                            )}
                            {replyStatus === "awaiting" && (
                              <Badge className="bg-orange-600/20 text-orange-400 border-orange-600/30 text-[10px] gap-1">
                                <Send className="h-3 w-3" /> Aguardando resposta
                              </Badge>
                            )}
                            {replyStatus === "not_sent" && (
                              <Badge className="bg-zinc-600/20 text-zinc-400 border-zinc-600/30 text-[10px] gap-1">
                                <MessageSquareX className="h-3 w-3" /> Não contatada
                              </Badge>
                            )}
                          </div>
                          {order.whatsapp && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-[10px] text-green-400 hover:bg-green-500/20 gap-1 px-2"
                              onClick={() => setChatOrder(order)}
                            >
                              <MessageCircle className="h-3.5 w-3.5" />
                              Ver conversa
                            </Button>
                          )}
                        </div>

                        {order.products.length > 0 && (
                          <p className="text-[10px] text-muted-foreground mt-1 truncate">
                            {order.products.map((p: any) => p.title).join(", ")}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="instagram">
          <Card className="bg-muted-foreground/5 border-muted-foreground/15">
            <CardContent className="p-4">
              <LiveInstagramComments
                eventId={eventId!}
                onOpenOrder={(orderId) => {
                  const order = orders.find(o => o.id === orderId);
                  if (order) setChatOrder(order);
                }}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="catalog">
          <div className="space-y-4">
            <Card className="bg-muted-foreground/5 border-muted-foreground/15">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground mb-4">
                  Gerencie os produtos do catálogo da live diretamente daqui. Adicione, remova e destaque produtos em tempo real.
                </p>
                <ActiveProductBar eventId={eventId!} eventName={eventName} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
      </div>

      {/* Live Instagram Comments Sidebar - always visible */}
      <div className="w-80 lg:w-96 border-l border-border bg-card/50 flex flex-col h-screen sticky top-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-3">
          <LiveInstagramComments
            eventId={eventId!}
            onOpenOrder={(orderId) => {
              const order = orders.find(o => o.id === orderId);
              if (order) setChatOrder(order);
            }}
          />
        </div>
      </div>

      {/* WhatsApp Chat Dialog */}
      <Dialog open={!!chatOrder} onOpenChange={(open) => !open && setChatOrder(null)}>
        <DialogContent className="max-w-md h-[600px] p-0 overflow-hidden gap-0 border-0 bg-transparent shadow-2xl">
          {chatOrder?.whatsapp && (
            <WhatsAppChat
              order={{
                id: chatOrder.id,
                instagramHandle: chatOrder.customer_name,
                whatsapp: chatOrder.whatsapp,
                products: chatOrder.products,
                stage: chatOrder.stage,
              } as any}
              onBack={() => setChatOrder(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
