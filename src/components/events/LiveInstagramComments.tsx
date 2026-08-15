import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Instagram, ShoppingCart, HelpCircle, MessageSquare, Sparkles, Volume2, VolumeX, ExternalLink, Radio } from "lucide-react";
import { toast } from "sonner";
import { isPaidOrderStage } from "@/lib/orderPaymentStages";


interface LiveComment {
  id: string;
  comment_id: string;
  username: string;
  comment_text: string;
  profile_pic_url: string | null;
  is_order: boolean | null;
  ai_classification: string | null;
  created_at: string;
}

interface CartCustomerMatch {
  handle: string;
  customerId: string;
  orderId: string;
  productCount: number;
  total: number;
  whatsapp: string | null;
  createdAt: string | null;
  productNames: string[];
}

interface HandleOrderStatus {
  openCurrent: number;
  openOther: number;
  paidCurrent: number;
  paidOther: number;
  cancelledCurrent: number;
  cancelledOther: number;
  hasWhatsapp: boolean;
  hasAnyOrder: boolean;
}



interface LiveInstagramCommentsProps {
  eventId: string;
  onOpenOrder?: (orderId: string) => void;
}

const classificationConfig: Record<string, { label: string; icon: typeof MessageSquare; color: string }> = {
  order: { label: "🛒 Pedido", icon: ShoppingCart, color: "bg-green-500/20 text-green-400 border-green-500/30" },
  question: { label: "❓ Dúvida", icon: HelpCircle, color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  engagement: { label: "✨ Engaj.", icon: Sparkles, color: "bg-pink-500/20 text-pink-400 border-pink-500/30" },
  comment: { label: "💬 Coment.", icon: MessageSquare, color: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30" },
  spam: { label: "🚫 Spam", icon: MessageSquare, color: "bg-zinc-700/20 text-zinc-500 border-zinc-700/30" },
};

const cleanHandle = (h: string) => (h || "").replace(/^@/, "").trim().toLowerCase();

export function LiveInstagramComments({ eventId, onOpenOrder }: LiveInstagramCommentsProps) {
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [cartByHandle, setCartByHandle] = useState<Map<string, CartCustomerMatch>>(new Map());
  const [statusByHandle, setStatusByHandle] = useState<Map<string, HandleOrderStatus>>(new Map());
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [filter, setFilter] = useState<"all" | "orders" | "carts">("all");
  const [recentlyHighlighted, setRecentlyHighlighted] = useState<Set<string>>(new Set());
  const [liveActiveUntil, setLiveActiveUntil] = useState<Date | null>(null);
  const [togglingLive, setTogglingLive] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cartByHandleRef = useRef<Map<string, CartCustomerMatch>>(new Map());
  const commentsRef = useRef<LiveComment[]>([]);
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);


  const isLiveActive = !!liveActiveUntil && liveActiveUntil.getTime() > Date.now();

  // Load current live_active_until + poll every 60s so the "expira em Xh" stays accurate
  const refreshLiveStatus = useCallback(async () => {
    if (!eventId) return;
    const { data } = await supabase
      .from("events")
      .select("live_active_until")
      .eq("id", eventId)
      .maybeSingle();
    setLiveActiveUntil(data?.live_active_until ? new Date(data.live_active_until) : null);
  }, [eventId]);

  useEffect(() => {
    refreshLiveStatus();
    const t = setInterval(refreshLiveStatus, 60000);
    return () => clearInterval(t);
  }, [refreshLiveStatus]);

  const toggleLiveActive = useCallback(async () => {
    if (!eventId || togglingLive) return;
    setTogglingLive(true);
    try {
      if (isLiveActive) {
        const { error } = await supabase.rpc("clear_event_live_active", { p_event_id: eventId });
        if (error) throw error;
        toast.success("Live desativada para este evento");
      } else {
        const { data, error } = await supabase.rpc("set_event_live_active", { p_event_id: eventId });
        if (error) throw error;
        toast.success("Live ativada — expira em 8h");
        if (data) setLiveActiveUntil(new Date(data));
      }
      await refreshLiveStatus();
    } catch (e: any) {
      toast.error("Erro ao alternar Live: " + (e?.message || "desconhecido"));
    } finally {
      setTogglingLive(false);
    }
  }, [eventId, isLiveActive, togglingLive, refreshLiveStatus]);


  useEffect(() => {
    cartByHandleRef.current = cartByHandle;
  }, [cartByHandle]);

  useEffect(() => {
    commentsRef.current = comments;
  }, [comments]);


  const playBeep = useCallback(() => {
    if (!soundEnabled) return;
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 1100;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
    } catch {}
  }, [soundEnabled]);

  const loadComments = useCallback(async () => {
    if (!eventId) return;
    const { data } = await supabase
      .from("live_comments")
      .select("id, comment_id, username, comment_text, profile_pic_url, is_order, ai_classification, created_at")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false })
      .limit(600);
    if (data) setComments(data as LiveComment[]);
  }, [eventId]);

  const loadCarts = useCallback(async () => {
    if (!eventId) return;

    // 1) Carrega base de clientes com Instagram (normaliza @ e maiúsculas)
    const PAGE = 1000;
    const handleToCustomers = new Map<string, any[]>();
    for (let from = 0; ; from += PAGE) {
      const { data } = await supabase
        .from("customers")
        .select("id, instagram_handle, whatsapp")
        .not("instagram_handle", "is", null)
        .range(from, from + PAGE - 1);
      if (!data || data.length === 0) break;
      for (const c of data as any[]) {
        const key = cleanHandle(c.instagram_handle);
        if (!key) continue;
        const arr = handleToCustomers.get(key) || [];
        arr.push(c);
        handleToCustomers.set(key, arr);
      }
      if (data.length < PAGE) break;
    }

    // 2) Só busca pedidos dos @ que aparecem nos comentários (atual + históricos)
    const commentHandles = new Set(
      commentsRef.current.map(c => cleanHandle(c.username)).filter(Boolean)
    );
    const customerIds: string[] = [];
    const customerById = new Map<string, any>();
    commentHandles.forEach(h => {
      (handleToCustomers.get(h) || []).forEach(c => {
        customerIds.push(c.id);
        customerById.set(c.id, c);
      });
    });

    if (customerIds.length === 0) {
      setCartByHandle(new Map());
      setStatusByHandle(new Map());
      return;
    }

    const orders: any[] = [];
    const CHUNK = 200;
    for (let i = 0; i < customerIds.length; i += CHUNK) {
      const { data } = await supabase
        .from("orders")
        .select("id, customer_id, event_id, products, stage, is_paid, created_at")
        .in("customer_id", customerIds.slice(i, i + CHUNK));
      if (data) orders.push(...data);
    }

    const map = new Map<string, CartCustomerMatch>();
    const statusMap = new Map<string, HandleOrderStatus>();

    const OPEN_STAGES = [
      "new", "contacted", "no_response", "awaiting_confirmation",
      "incomplete_order", "awaiting_payment", "endereco", "confirmar_endereco",
      "dados_pessoais", "forma_pagamento", "aguardando_pix", "aguardando_cartao", "aguardando_boleto",
    ];

    orders.forEach((o: any) => {
      const cust: any = customerById.get(o.customer_id);
      if (!cust?.instagram_handle) return;
      const key = cleanHandle(cust.instagram_handle);
      if (!key) return;

      const isCurrent = o.event_id === eventId;
      const products = (o.products as any[]) || [];
      const total = products.reduce((s, p: any) => s + Number(p.price || 0) * Number(p.quantity || 1), 0);
      const whatsapp = (cust.whatsapp || "").trim() || null;

      const st: HandleOrderStatus = statusMap.get(key) || {
        openCurrent: 0, openOther: 0,
        paidCurrent: 0, paidOther: 0,
        cancelledCurrent: 0, cancelledOther: 0,
        hasWhatsapp: false, hasAnyOrder: false,
      };
      if (whatsapp) st.hasWhatsapp = true;
      st.hasAnyOrder = true;

      const isPaid = Boolean(o.is_paid) || isPaidOrderStage(o.stage);
      if (o.stage === "cancelled") {
        if (isCurrent) st.cancelledCurrent += 1; else st.cancelledOther += 1;
      } else if (isPaid) {
        if (isCurrent) st.paidCurrent += 1; else st.paidOther += 1;
      } else if (OPEN_STAGES.includes(o.stage)) {
        if (isCurrent) st.openCurrent += 1; else st.openOther += 1;
      }
      statusMap.set(key, st);

      // Carrinho aberto: apenas do evento atual
      if (isCurrent && o.stage !== "cancelled" && !isPaid && OPEN_STAGES.includes(o.stage)) {
        const existing = map.get(key);
        if (!existing || total > existing.total) {
          map.set(key, {
            handle: key,
            customerId: cust.id,
            orderId: o.id,
            productCount: products.length,
            total,
            whatsapp,
            createdAt: o.created_at || null,
            productNames: products.map((p: any) =>
              [p.title, p.variant].filter(Boolean).join(" · ")
            ).filter(Boolean),
          });
        }
      }
    });

    setCartByHandle(map);
    setStatusByHandle(statusMap);
  }, [eventId]);




  useEffect(() => {
    loadComments();
  }, [loadComments]);

  // Recarrega os status sempre que surgirem novos @ nos comentários
  const handlesKey = useMemo(
    () => [...new Set(comments.map(c => cleanHandle(c.username)).filter(Boolean))].sort().join(","),
    [comments]
  );

  useEffect(() => {
    commentsRef.current = comments;
    loadCarts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handlesKey, loadCarts]);


  useEffect(() => {
    if (!eventId) return;
    const channel = supabase
      .channel(`live-comments-${eventId}-${Date.now()}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "live_comments",
        filter: `event_id=eq.${eventId}`,
      }, (payload) => {
        const newComment = payload.new as LiveComment;
        setComments(prev => {
          if (prev.some(c => c.id === newComment.id || c.comment_id === newComment.comment_id)) return prev;
          return [newComment, ...prev].slice(0, 600);
        });

        const handle = cleanHandle(newComment.username);
        if (cartByHandleRef.current.has(handle)) {
          playBeep();
          setRecentlyHighlighted(prev => new Set(prev).add(newComment.id));
          setTimeout(() => {
            setRecentlyHighlighted(prev => {
              const next = new Set(prev);
              next.delete(newComment.id);
              return next;
            });
          }, 3000);
        }
      })
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "live_comments",
        filter: `event_id=eq.${eventId}`,
      }, (payload) => {
        const updated = payload.new as LiveComment;
        setComments(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c));
      })
      .subscribe((status) => {
        console.log(`[LiveComments] Realtime status: ${status}`);
      });

    // Polling fallback a cada 15s — caso o realtime caia, garante que a UI atualiza sem F5
    const pollInterval = setInterval(() => {
      loadComments();
    }, 15000);

    return () => {
      clearInterval(pollInterval);
      supabase.removeChannel(channel);
    };
  }, [eventId, playBeep, loadComments]);

  useEffect(() => {
    if (!eventId) return;
    const channel = supabase
      .channel(`live-comments-orders-${eventId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "orders",
        filter: `event_id=eq.${eventId}`,
      }, () => {
        loadCarts();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [eventId, loadCarts]);

  const filtered = useMemo(() => {
    if (filter === "all") return comments;
    if (filter === "orders") return comments.filter(c => c.is_order);
    if (filter === "carts") return comments.filter(c => cartByHandle.has(cleanHandle(c.username)));
    return comments;
  }, [comments, filter, cartByHandle]);

  const cartMatchCount = useMemo(
    () => comments.filter(c => cartByHandle.has(cleanHandle(c.username))).length,
    [comments, cartByHandle]
  );
  const orderCount = useMemo(() => comments.filter(c => c.is_order).length, [comments]);

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };

  const formatCartAge = (iso: string | null) => {
    if (!iso) return null;
    const mins = Math.max(0, Math.floor((nowTick - new Date(iso).getTime()) / 60000));
    if (mins < 1) return "agora";
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}min` : `${h}h`;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Instagram className="h-5 w-5 text-pink-400" />
          <h2 className="text-lg font-bold">Comentários do Instagram</h2>
          <Badge className="bg-pink-600/30 text-pink-200">{comments.length}</Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant={isLiveActive ? "default" : "outline"}
            size="sm"
            onClick={toggleLiveActive}
            disabled={togglingLive}
            className={`h-8 text-xs gap-1.5 ${
              isLiveActive
                ? "bg-red-600 hover:bg-red-700 text-white border-red-700 animate-pulse"
                : "border-dashed"
            }`}
            title={
              isLiveActive
                ? `Ativa até ${liveActiveUntil?.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
                : "Marcar este evento como a Live que está rodando agora"
            }
          >
            <Radio className="h-3.5 w-3.5" />
            {isLiveActive ? "AO VIVO" : "Ativar Live"}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="text-foreground hover:bg-muted h-8 w-8"
            title={soundEnabled ? "Desativar som" : "Ativar som"}
          >
            {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Button
          variant={filter === "all" ? "default" : "ghost"}
          size="sm"
          onClick={() => setFilter("all")}
          className="h-7 text-xs"
        >
          Todos ({comments.length})
        </Button>
        <Button
          variant={filter === "orders" ? "default" : "ghost"}
          size="sm"
          onClick={() => setFilter("orders")}
          className="h-7 text-xs"
        >
          🛒 Pedidos ({orderCount})
        </Button>
        <Button
          variant={filter === "carts" ? "default" : "ghost"}
          size="sm"
          onClick={() => setFilter("carts")}
          className={`h-7 text-xs ${cartMatchCount > 0 ? "ring-1 ring-orange-400/50" : ""}`}
        >
          🔥 Com carrinho ({cartMatchCount})
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-[420px] h-[60vh]" ref={scrollRef as any}>
        <div className="space-y-3 pr-2">
          {filtered.length === 0 && (
            <Card className="bg-muted-foreground/10 border-muted-foreground/20">
              <CardContent className="p-6 text-center text-muted-foreground text-sm">
                {comments.length === 0
                  ? "Aguardando comentários do Instagram. Verifique se a extensão Livete está ativa no navegador da live 📲"
                  : "Nenhum comentário neste filtro."}
              </CardContent>
            </Card>
          )}
          {filtered.map(comment => {
            const handle = cleanHandle(comment.username);
            const cart = cartByHandle.get(handle);
            const hasCart = !!cart;
            const status = statusByHandle.get(handle);
            const isHighlighted = recentlyHighlighted.has(comment.id);
            const classKey = comment.ai_classification || "comment";
            const config = classificationConfig[classKey] || classificationConfig.comment;
            const Icon = config.icon;
            const hasAnyOrder = !!status && status.hasAnyOrder;
            const missingWhatsapp = hasAnyOrder && !status!.hasWhatsapp;

            return (
              <Card
                key={comment.id}
                className={`border transition-all ${
                  isHighlighted
                    ? "bg-orange-500/20 border-orange-400 shadow-lg shadow-orange-500/30 animate-pulse"
                    : hasCart
                    ? "bg-orange-500/10 border-orange-500/40"
                    : "bg-card border-border"
                }`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    {comment.profile_pic_url ? (
                      <img
                        src={comment.profile_pic_url}
                        alt={comment.username}
                        className="w-12 h-12 rounded-full object-cover border border-border"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-base font-bold text-white">
                        {comment.username.charAt(0).toUpperCase()}
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-bold text-base text-pink-500 dark:text-pink-300">@{handle}</span>
                        <span className="text-xs text-muted-foreground">{formatTime(comment.created_at)}</span>
                        <Badge variant="outline" className={`text-[11px] py-0 ${config.color}`}>
                          <Icon className="h-3 w-3 mr-1" />
                          {config.label}
                        </Badge>

                        {status && status.openCurrent > 0 && (
                          <span className="rounded-full bg-neutral-900 px-2 py-0.5 text-[11px] font-bold uppercase text-white">
                            Pedido aberto · esta live{status.openCurrent > 1 ? ` (${status.openCurrent})` : ""}
                          </span>
                        )}
                        {status && status.openOther > 0 && (
                          <span className="rounded-full bg-neutral-600 px-2 py-0.5 text-[11px] font-bold uppercase text-white">
                            Pedido aberto · outros eventos ({status.openOther})
                          </span>
                        )}
                        {status && status.paidCurrent > 0 && (
                          <span className="rounded-full bg-green-600 px-2 py-0.5 text-[11px] font-bold uppercase text-white">
                            Concluído · esta live{status.paidCurrent > 1 ? ` (${status.paidCurrent})` : ""}
                          </span>
                        )}
                        {status && status.paidOther > 0 && (
                          <span className="rounded-full bg-emerald-700 px-2 py-0.5 text-[11px] font-bold uppercase text-white">
                            Concluído · outros eventos ({status.paidOther})
                          </span>
                        )}
                        {status && status.cancelledCurrent > 0 && (
                          <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold uppercase text-white">
                            Cancelado · esta live{status.cancelledCurrent > 1 ? ` (${status.cancelledCurrent})` : ""}
                          </span>
                        )}
                        {status && status.cancelledOther > 0 && (
                          <span className="rounded-full bg-red-800 px-2 py-0.5 text-[11px] font-bold uppercase text-white">
                            Cancelado · outros eventos ({status.cancelledOther})
                          </span>
                        )}

                        {missingWhatsapp && (
                          <span
                            className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold uppercase text-black"
                            title="Cliente com pedido sem WhatsApp cadastrado"
                          >
                            📱 Sem WhatsApp
                          </span>
                        )}
                      </div>

                      <p className="text-lg leading-snug font-medium text-foreground mb-1 break-words">{comment.comment_text}</p>

                      {hasCart && cart && (
                        <div className="mt-2 flex items-center justify-between gap-2 p-2.5 rounded bg-orange-600 dark:bg-orange-500/15 border border-orange-700 dark:border-orange-500/30">
                          <div className="flex items-center gap-2 text-sm flex-1 min-w-0">
                            <ShoppingCart className="h-4 w-4 text-white dark:text-orange-300 shrink-0" />
                            <span className="text-white dark:text-orange-200 truncate font-medium">
                              <strong>{cart.productCount} item(s)</strong> · R$ {cart.total.toFixed(2)}
                            </span>
                          </div>
                          {onOpenOrder && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-white dark:text-orange-200 hover:bg-orange-700 dark:hover:bg-orange-500/30 px-2 gap-1 font-semibold"
                              onClick={() => onOpenOrder(cart.orderId)}
                            >
                              Ver pedido <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </ScrollArea>

    </div>
  );
}
