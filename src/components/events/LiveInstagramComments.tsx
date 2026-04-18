import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Instagram, ShoppingCart, HelpCircle, MessageSquare, Sparkles, Volume2, VolumeX, ExternalLink } from "lucide-react";

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
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [filter, setFilter] = useState<"all" | "orders" | "carts">("all");
  const [recentlyHighlighted, setRecentlyHighlighted] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const cartByHandleRef = useRef<Map<string, CartCustomerMatch>>(new Map());

  useEffect(() => {
    cartByHandleRef.current = cartByHandle;
  }, [cartByHandle]);

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
      .limit(150);
    if (data) setComments(data as LiveComment[]);
  }, [eventId]);

  const loadCarts = useCallback(async () => {
    if (!eventId) return;
    const { data: orders } = await supabase
      .from("orders")
      .select("id, customer_id, products, stage")
      .eq("event_id", eventId)
      .in("stage", ["incomplete_order", "awaiting_payment", "endereco", "confirmar_endereco", "dados_pessoais", "forma_pagamento", "aguardando_pix", "aguardando_cartao", "aguardando_boleto"]);

    if (!orders || orders.length === 0) {
      setCartByHandle(new Map());
      return;
    }

    const customerIds = [...new Set(orders.map((o: any) => o.customer_id))];
    const { data: customers } = await supabase
      .from("customers")
      .select("id, instagram_handle, whatsapp")
      .in("id", customerIds);

    const customerMap = new Map((customers || []).map((c: any) => [c.id, c]));
    const map = new Map<string, CartCustomerMatch>();

    orders.forEach((o: any) => {
      const cust: any = customerMap.get(o.customer_id);
      if (!cust?.instagram_handle) return;
      const key = cleanHandle(cust.instagram_handle);
      if (!key) return;
      const products = (o.products as any[]) || [];
      const total = products.reduce((s, p: any) => s + Number(p.price || 0) * Number(p.quantity || 1), 0);
      const existing = map.get(key);
      if (!existing || total > existing.total) {
        map.set(key, {
          handle: key,
          customerId: cust.id,
          orderId: o.id,
          productCount: products.length,
          total,
          whatsapp: cust.whatsapp || null,
        });
      }
    });

    setCartByHandle(map);
  }, [eventId]);

  useEffect(() => {
    loadComments();
    loadCarts();
  }, [loadComments, loadCarts]);

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
          return [newComment, ...prev].slice(0, 150);
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

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Instagram className="h-5 w-5 text-pink-400" />
          <h2 className="text-lg font-bold">Comentários do Instagram</h2>
          <Badge className="bg-pink-600/30 text-pink-200">{comments.length}</Badge>
        </div>
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

      <ScrollArea className="flex-1 h-[calc(100vh-440px)]" ref={scrollRef as any}>
        <div className="space-y-2 pr-2">
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
            const isHighlighted = recentlyHighlighted.has(comment.id);
            const classKey = comment.ai_classification || "comment";
            const config = classificationConfig[classKey] || classificationConfig.comment;
            const Icon = config.icon;

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
                <CardContent className="p-3">
                  <div className="flex items-start gap-2">
                    {comment.profile_pic_url ? (
                      <img
                        src={comment.profile_pic_url}
                        alt={comment.username}
                        className="w-8 h-8 rounded-full object-cover border border-border"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-xs font-bold text-white">
                        {comment.username.charAt(0).toUpperCase()}
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-bold text-sm text-pink-500 dark:text-pink-300">@{handle}</span>
                        <span className="text-[10px] text-muted-foreground">{formatTime(comment.created_at)}</span>
                        <Badge variant="outline" className={`text-[9px] py-0 ${config.color}`}>
                          <Icon className="h-2.5 w-2.5 mr-0.5" />
                          {config.label}
                        </Badge>
                      </div>

                      <p className="text-sm text-foreground mb-1 break-words">{comment.comment_text}</p>

                      {hasCart && cart && (
                        <div className="mt-2 flex items-center justify-between gap-2 p-2 rounded bg-orange-600 dark:bg-orange-500/15 border border-orange-700 dark:border-orange-500/30">
                          <div className="flex items-center gap-2 text-xs flex-1 min-w-0">
                            <ShoppingCart className="h-3.5 w-3.5 text-white dark:text-orange-300 shrink-0" />
                            <span className="text-white dark:text-orange-200 truncate font-medium">
                              <strong>{cart.productCount} item(s)</strong> · R$ {cart.total.toFixed(2)}
                            </span>
                          </div>
                          {onOpenOrder && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-[10px] text-white dark:text-orange-200 hover:bg-orange-700 dark:hover:bg-orange-500/30 px-2 gap-1 font-semibold"
                              onClick={() => onOpenOrder(cart.orderId)}
                            >
                              Ver pedido <ExternalLink className="h-3 w-3" />
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
