import { memo, useEffect, useState, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Instagram, ShoppingCart, HelpCircle, MessageSquare, Sparkles, Volume2, VolumeX, ExternalLink, Radio, Search, X, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { matchesSearch, normalizeSearch } from "@/lib/liveCommentSearch";
import {
  buildPresenterHandleData,
  cleanPresenterHandle,
  type IgHandleSummary,
  type PresenterCommentOrder,
  type PresenterHandleData,
  type PresenterSelfServiceAccess,
} from "@/lib/presenterCommentSummaries";

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

interface WhatsAppTarget {
  handle: string;
  whatsapp: string;
  orderId?: string;
}

interface LiveInstagramCommentsProps {
  eventId: string;
  currentEventName?: string;
  currentOrders: PresenterCommentOrder[];
  onOpenOrder?: (orderId: string) => void;
  onOpenWhatsApp?: (target: WhatsAppTarget) => void;
}

const classificationConfig: Record<string, { label: string; icon: typeof MessageSquare; color: string }> = {
  order: { label: "🛒 Pedido", icon: ShoppingCart, color: "bg-green-500/20 text-green-400 border-green-500/30" },
  question: { label: "❓ Dúvida", icon: HelpCircle, color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  engagement: { label: "✨ Engaj.", icon: Sparkles, color: "bg-pink-500/20 text-pink-400 border-pink-500/30" },
  comment: { label: "💬 Coment.", icon: MessageSquare, color: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30" },
  spam: { label: "🚫 Spam", icon: MessageSquare, color: "bg-zinc-700/20 text-zinc-500 border-zinc-700/30" },
};

const ACCESS_COLUMNS = "id, event_id, order_ids, phone_key, confirmed_phone_key, instagram, registered_at";
const presenterHandleCache = new Map<string, { summary: IgHandleSummary; checkedAt: number }>();
const PRESENTER_NEGATIVE_TTL_MS = 45_000;

const formatTime = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const formatPurchaseDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
const formatCartAge = (iso: string | null, now: number) => {
  if (!iso) return null;
  const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
};

function normalizeSummary(row: any): IgHandleSummary {
  return {
    handle: cleanPresenterHandle(row.handle),
    customer_id: row.customer_id || null,
    whatsapp: row.whatsapp || null,
    open_other: Number(row.open_other || 0),
    unconfirmed_other: Number(row.unconfirmed_other || 0),
    paid_other: Number(row.paid_other || 0),
    cancelled_other: Number(row.cancelled_other || 0),
    paid_other_events: Array.isArray(row.paid_other_events) ? row.paid_other_events : [],
    cancelled_other_events: Array.isArray(row.cancelled_other_events) ? row.cancelled_other_events : [],
    purchases: Array.isArray(row.purchases) ? row.purchases : [],
  };
}

interface CommentCardProps {
  comment: LiveComment;
  data?: PresenterHandleData;
  isHighlighted: boolean;
  nowTick: number;
  onOpenOrder?: (orderId: string) => void;
  onOpenWhatsApp?: (target: WhatsAppTarget) => void;
}

const CommentCard = memo(function CommentCard({
  comment,
  data,
  isHighlighted,
  nowTick,
  onOpenOrder,
  onOpenWhatsApp,
}: CommentCardProps) {
  const [showAllPurchases, setShowAllPurchases] = useState(false);
  const handle = cleanPresenterHandle(comment.username);
  const cart = data?.cart || null;
  const classKey = comment.ai_classification || "comment";
  const config = classificationConfig[classKey] || classificationConfig.comment;
  const Icon = config.icon;
  const missingWhatsapp = !!data?.hasAnyOrder && !data.hasWhatsapp;
  const registrationAlert = cart && cart.productCount > 0 ? data?.registrationAlert : "none";
  const purchases = data?.purchases || [];
  const visiblePurchases = showAllPurchases ? purchases : purchases.slice(0, 2);

  return (
    <Card
      className={`border transition-all ${
        isHighlighted
          ? "bg-orange-500/20 border-orange-400 shadow-lg shadow-orange-500/30 animate-pulse"
          : cart
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
              onError={(event) => { (event.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-base font-bold text-white">
              {comment.username.charAt(0).toUpperCase()}
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-bold text-base text-pink-500 dark:text-pink-300">@{handle}</span>
              {data?.whatsapp && onOpenWhatsApp && (
                <Button
                  size="sm"
                  className="h-6 gap-1 bg-green-600 px-2 text-[10px] font-bold text-white hover:bg-green-700"
                  onClick={() => onOpenWhatsApp({ handle, whatsapp: data.whatsapp!, orderId: data.latestOrderId || undefined })}
                >
                  <MessageCircle className="h-3 w-3" /> WhatsApp
                </Button>
              )}
              <span className="text-xs text-muted-foreground">{formatTime(comment.created_at)}</span>
              <Badge variant="outline" className={`text-[11px] py-0 ${config.color}`}>
                <Icon className="h-3 w-3 mr-1" />
                {config.label}
              </Badge>

              {!!data?.unconfirmedCurrent && (
                <span className="rounded-full bg-orange-600 px-2 py-0.5 text-[11px] font-bold uppercase text-white" title="Carrinho montado, mas a cliente ainda não confirmou o pedido">
                  ⚠️ Pedido não confirmado · esta live{data.unconfirmedCurrent > 1 ? ` (${data.unconfirmedCurrent})` : ""}
                </span>
              )}
              {!!data?.unconfirmedOther && (
                <span className="rounded-full bg-orange-800 px-2 py-0.5 text-[11px] font-bold uppercase text-white">
                  ⚠️ Pedido não confirmado · outros eventos ({data.unconfirmedOther})
                </span>
              )}
              {!!data?.openCurrent && (
                <span className="rounded-full bg-neutral-900 px-2 py-0.5 text-[11px] font-bold uppercase text-white">
                  Pedido aberto · esta live{data.openCurrent > 1 ? ` (${data.openCurrent})` : ""}
                </span>
              )}
              {!!data?.openOther && (
                <span className="rounded-full bg-neutral-600 px-2 py-0.5 text-[11px] font-bold uppercase text-white">
                  Pedido aberto · outros eventos ({data.openOther})
                </span>
              )}
              {!!data?.paidCurrent && (
                <span className="rounded-full bg-green-600 px-2 py-0.5 text-[11px] font-bold uppercase text-white">
                  Concluído · esta live{data.paidCurrent > 1 ? ` (${data.paidCurrent})` : ""}
                </span>
              )}
              {!!data?.paidOther && (
                <span className="rounded-full bg-emerald-700 px-2 py-0.5 text-[11px] font-bold uppercase text-white" title={data.paidOtherEvents.join(" • ")}>
                  Concluído ({data.paidOther}) · {data.paidOtherEvents.slice(0, 2).join(" • ") || "outros eventos"}
                  {data.paidOtherEvents.length > 2 ? ` +${data.paidOtherEvents.length - 2}` : ""}
                </span>
              )}
              {!!data?.cancelledCurrent && (
                <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold uppercase text-white">
                  Cancelado · esta live{data.cancelledCurrent > 1 ? ` (${data.cancelledCurrent})` : ""}
                </span>
              )}
              {!!data?.cancelledOther && (
                <span className="rounded-full bg-red-800 px-2 py-0.5 text-[11px] font-bold uppercase text-white" title={data.cancelledOtherEvents.join(" • ")}>
                  Cancelado ({data.cancelledOther}) · {data.cancelledOtherEvents.slice(0, 2).join(" • ") || "outros eventos"}
                  {data.cancelledOtherEvents.length > 2 ? ` +${data.cancelledOtherEvents.length - 2}` : ""}
                </span>
              )}
              {missingWhatsapp && (
                <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold uppercase text-black" title="Cliente com pedido sem WhatsApp cadastrado">
                  📱 Sem WhatsApp
                </span>
              )}
            </div>

            <p className="text-lg leading-snug font-medium text-foreground mb-1 break-words">{comment.comment_text}</p>

            {cart && registrationAlert === "not_opened" && cart.productCount === 1 && (
              <div className="mt-2 rounded-md bg-orange-500 px-3 py-2 text-sm font-black uppercase text-white">
                ⚠️ 1 item · NÃO ABRIU O CADASTRO
              </div>
            )}
            {cart && registrationAlert === "opened_unfinished" && cart.productCount === 1 && (
              <div className="mt-2 rounded-md bg-orange-500 px-3 py-2 text-sm font-black uppercase text-white">
                ⚠️ 1 item · ABRIU, NÃO TERMINOU O CADASTRO
              </div>
            )}
            {cart && registrationAlert !== "none" && cart.productCount >= 2 && (
              <div className="mt-3 w-full rounded-lg border-2 border-red-400 bg-red-600 px-4 py-3 text-base font-black uppercase leading-snug text-white shadow-lg md:text-lg">
                🚨 {cart.productCount} ITENS NO CARRINHO E {registrationAlert === "not_opened" ? "AINDA NÃO ABRIU O CADASTRO" : "ABRIU MAS NÃO TERMINOU O CADASTRO"} — COBRE ANTES DE ADICIONAR MAIS
              </div>
            )}

            {cart && (
              <div className="mt-2 gap-2 rounded border border-orange-700 bg-orange-600 p-2.5 dark:border-orange-500/30 dark:bg-orange-500/15">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm">
                    <ShoppingCart className="h-4 w-4 shrink-0 text-white dark:text-orange-300" />
                    <span className="font-medium text-white dark:text-orange-200">
                      <strong>{cart.productCount} {cart.productCount === 1 ? "item" : "itens"}</strong> · R$ {cart.total.toFixed(2)}
                    </span>
                    {cart.createdAt && (
                      <span className="rounded-full bg-black/30 px-2 py-0.5 text-[11px] font-bold text-white dark:bg-orange-500/20 dark:text-orange-200">
                        ⏱ aberto há {formatCartAge(cart.createdAt, nowTick)}
                      </span>
                    )}
                  </div>
                  {onOpenOrder && (
                    <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 px-2 text-xs font-semibold text-white hover:bg-orange-700 dark:text-orange-200 dark:hover:bg-orange-500/30" onClick={() => onOpenOrder(cart.orderId)}>
                      Ver pedido <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                {cart.productNames.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 text-[13px] text-white/90 dark:text-orange-100/90">
                    {cart.productNames.map((name, index) => <li key={`${cart.orderId}-${index}`} className="break-words">• {name}</li>)}
                  </ul>
                )}
              </div>
            )}

            {purchases.length > 0 && (
              <div className="mt-2 rounded-md border border-border bg-muted/40 p-2.5">
                <p className="mb-1.5 text-xs font-bold text-foreground">🛍️ Compras anteriores ({purchases.length})</p>
                <div className="space-y-2">
                  {visiblePurchases.map((purchase) => (
                    <div key={purchase.order_id} className="text-xs">
                      <p className="font-semibold text-foreground">{formatPurchaseDate(purchase.paid_at)} · {purchase.event_name}</p>
                      <ul className="mt-0.5 space-y-0.5 text-muted-foreground">
                        {purchase.items.map((item, index) => (
                          <li key={`${purchase.order_id}-${index}`} className="break-words">
                            • {item.quantity > 1 ? `${item.quantity}x ` : ""}{item.title}{item.variant ? ` · ${item.variant}` : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
                {purchases.length > 2 && (
                  <Button variant="ghost" size="sm" className="mt-1 h-6 px-1 text-[11px]" onClick={() => setShowAllPurchases((value) => !value)}>
                    {showAllPurchases ? "ver menos" : `ver todas (${purchases.length})`}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
});

export function LiveInstagramComments({ eventId, currentEventName = "Esta live", currentOrders, onOpenOrder, onOpenWhatsApp }: LiveInstagramCommentsProps) {
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [historyByHandle, setHistoryByHandle] = useState<Map<string, IgHandleSummary>>(new Map());
  const [accesses, setAccesses] = useState<Map<string, PresenterSelfServiceAccess>>(new Map());
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [filter, setFilter] = useState<"all" | "orders" | "carts">("all");
  const [search, setSearch] = useState("");
  const [recentlyHighlighted, setRecentlyHighlighted] = useState<Set<string>>(new Set());
  const [liveActiveUntil, setLiveActiveUntil] = useState<Date | null>(null);
  const [togglingLive, setTogglingLive] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const scrollRef = useRef<HTMLDivElement>(null);
  const realtimeStatusRef = useRef("IDLE");
  const dataRef = useRef<Map<string, PresenterHandleData>>(new Map());

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const isLiveActive = !!liveActiveUntil && liveActiveUntil.getTime() > Date.now();
  const refreshLiveStatus = useCallback(async () => {
    if (!eventId) return;
    const { data } = await supabase.from("events").select("live_active_until").eq("id", eventId).maybeSingle();
    setLiveActiveUntil(data?.live_active_until ? new Date(data.live_active_until) : null);
  }, [eventId]);

  useEffect(() => {
    void refreshLiveStatus();
    const timer = setInterval(refreshLiveStatus, 60000);
    return () => clearInterval(timer);
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
    } catch (error: any) {
      toast.error("Erro ao alternar Live: " + (error?.message || "desconhecido"));
    } finally {
      setTogglingLive(false);
    }
  }, [eventId, isLiveActive, togglingLive, refreshLiveStatus]);

  const playBeep = useCallback(() => {
    if (!soundEnabled) return;
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(ctx.destination);
      osc.frequency.value = 1100;
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
      osc.start();
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

  useEffect(() => { void loadComments(); }, [loadComments]);

  const handles = useMemo(
    () => [...new Set(comments.map((comment) => cleanPresenterHandle(comment.username)).filter(Boolean))].sort(),
    [comments],
  );
  const handlesKey = handles.join(",");

  // Histórico em lote: somente @ novos (ou sem cadastro há 45 s). Pedidos da live
  // não entram nas dependências, portanto nunca disparam nova consulta histórica.
  useEffect(() => {
    let cancelled = false;
    const wanted = handlesKey ? handlesKey.split(",") : [];
    const now = Date.now();
    const cached = new Map<string, IgHandleSummary>();
    const toResolve: string[] = [];
    for (const handle of wanted) {
      const key = `${eventId}:${handle}`;
      const entry = presenterHandleCache.get(key);
      if (entry) cached.set(handle, entry.summary);
      if (!entry || (!entry.summary.customer_id && now - entry.checkedAt > PRESENTER_NEGATIVE_TTL_MS)) toResolve.push(handle);
    }
    setHistoryByHandle(cached);
    if (!toResolve.length) return () => { cancelled = true; };

    const load = async () => {
      for (let index = 0; index < toResolve.length; index += 300) {
        const batch = toResolve.slice(index, index + 300);
        const { data, error } = await supabase.rpc("get_ig_handle_summaries", { _event_id: eventId, _handles: batch });
        if (error) {
          console.warn("[LiveComments] Falha no resumo de Instagram:", error.message);
          break;
        }
        const found = new Set<string>();
        for (const row of (data || []) as any[]) {
          const summary = normalizeSummary(row);
          if (!summary.handle) continue;
          found.add(summary.handle);
          presenterHandleCache.set(`${eventId}:${summary.handle}`, { summary, checkedAt: Date.now() });
        }
        for (const handle of batch) {
          if (!found.has(handle)) {
            const summary = normalizeSummary({ handle });
            presenterHandleCache.set(`${eventId}:${handle}`, { summary, checkedAt: Date.now() });
          }
        }
        if (cancelled) break;
        setHistoryByHandle((previous) => {
          const next = new Map(previous);
          for (const handle of batch) next.set(handle, presenterHandleCache.get(`${eventId}:${handle}`)!.summary);
          return next;
        });
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [eventId, handlesKey]);

  // Uma carga na abertura; depois entra/sai somente o acesso alterado.
  useEffect(() => {
    let active = true;
    const apply = (row: PresenterSelfServiceAccess) => {
      setAccesses((previous) => {
        const next = new Map(previous);
        next.set(row.id, row);
        return next;
      });
    };
    void (supabase as any)
      .from("live_selfservice_accesses")
      .select(ACCESS_COLUMNS)
      .eq("event_id", eventId)
      .order("created_at", { ascending: false })
      .limit(5000)
      .then(({ data }: any) => {
        if (!active) return;
        setAccesses(new Map(((data || []) as PresenterSelfServiceAccess[]).map((row) => [row.id, row])));
      });
    const channel = supabase
      .channel(`presenter-selfservice-accesses-${eventId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "live_selfservice_accesses", filter: `event_id=eq.${eventId}` }, (payload) => apply(payload.new as PresenterSelfServiceAccess))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "live_selfservice_accesses", filter: `event_id=eq.${eventId}` }, (payload) => apply(payload.new as PresenterSelfServiceAccess))
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "live_selfservice_accesses", filter: `event_id=eq.${eventId}` }, (payload) => {
        const id = (payload.old as any)?.id;
        if (!id) return;
        setAccesses((previous) => {
          const next = new Map(previous);
          next.delete(id);
          return next;
        });
      })
      .subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, [eventId]);

  useEffect(() => {
    const channel = supabase
      .channel(`live-comments-${eventId}-${Date.now()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "live_comments", filter: `event_id=eq.${eventId}` }, (payload) => {
        const newComment = payload.new as LiveComment;
        setComments((previous) => {
          if (previous.some((comment) => comment.id === newComment.id || comment.comment_id === newComment.comment_id)) return previous;
          return [newComment, ...previous].slice(0, 600);
        });
        if (dataRef.current.get(cleanPresenterHandle(newComment.username))?.cart) {
          playBeep();
          setRecentlyHighlighted((previous) => new Set(previous).add(newComment.id));
          setTimeout(() => {
            setRecentlyHighlighted((previous) => {
              const next = new Set(previous);
              next.delete(newComment.id);
              return next;
            });
          }, 3000);
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "live_comments", filter: `event_id=eq.${eventId}` }, (payload) => {
        const updated = payload.new as LiveComment;
        setComments((previous) => previous.map((comment) => comment.id === updated.id ? { ...comment, ...updated } : comment));
      })
      .subscribe((status) => {
        realtimeStatusRef.current = status;
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") void loadComments();
      });

    const pollInterval = setInterval(() => {
      if (!document.hidden && realtimeStatusRef.current !== "SUBSCRIBED") void loadComments();
    }, 30000);
    return () => {
      clearInterval(pollInterval);
      void supabase.removeChannel(channel);
    };
  }, [eventId, playBeep, loadComments]);

  const accessRows = useMemo(() => [...accesses.values()], [accesses]);
  dataRef.current = useMemo(
    () => buildPresenterHandleData(eventId, currentEventName, handles, currentOrders, historyByHandle, accessRows, dataRef.current),
    [eventId, currentEventName, handles, currentOrders, historyByHandle, accessRows],
  );

  const searchNorm = useMemo(() => normalizeSearch(search), [search]);
  const searched = useMemo(
    () => (searchNorm ? comments.filter((comment) => matchesSearch(comment, searchNorm)) : comments),
    [comments, searchNorm],
  );
  const filtered = useMemo(() => {
    if (filter === "all") return searched;
    if (filter === "orders") return searched.filter((comment) => comment.is_order);
    return searched.filter((comment) => !!dataRef.current.get(cleanPresenterHandle(comment.username))?.cart);
  }, [searched, filter, dataRef.current]);
  const cartMatchCount = useMemo(
    () => searched.filter((comment) => !!dataRef.current.get(cleanPresenterHandle(comment.username))?.cart).length,
    [searched, dataRef.current],
  );
  const orderCount = useMemo(() => searched.filter((comment) => comment.is_order).length, [searched]);

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
            className={`h-8 text-xs gap-1.5 ${isLiveActive ? "bg-red-600 hover:bg-red-700 text-white border-red-700 animate-pulse" : "border-dashed"}`}
            title={isLiveActive ? `Ativa até ${liveActiveUntil?.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "Marcar este evento como a Live que está rodando agora"}
          >
            <Radio className="h-3.5 w-3.5" />
            {isLiveActive ? "AO VIVO" : "Ativar Live"}
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setSoundEnabled(!soundEnabled)} className="h-8 w-8 text-foreground hover:bg-muted" title={soundEnabled ? "Desativar som" : "Ativar som"}>
            {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar por @ ou pelo que a cliente escreveu" className="h-9 pl-9 pr-9 text-sm bg-background" aria-label="Pesquisar comentários" />
        {search && (
          <Button variant="ghost" size="icon" onClick={() => setSearch("")} className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground hover:text-foreground" title="Limpar busca">
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Button variant={filter === "all" ? "default" : "ghost"} size="sm" onClick={() => setFilter("all")} className="h-7 text-xs">Todos ({searched.length})</Button>
        <Button variant={filter === "orders" ? "default" : "ghost"} size="sm" onClick={() => setFilter("orders")} className="h-7 text-xs">🛒 Pedidos ({orderCount})</Button>
        <Button variant={filter === "carts" ? "default" : "ghost"} size="sm" onClick={() => setFilter("carts")} className={`h-7 text-xs ${cartMatchCount > 0 ? "ring-1 ring-orange-400/50" : ""}`}>🔥 Com carrinho ({cartMatchCount})</Button>
      </div>

      <ScrollArea className="flex-1 min-h-[420px] h-[60vh]" ref={scrollRef as any}>
        <div className="space-y-3 pr-2">
          {filtered.length === 0 && (
            <Card className="bg-muted-foreground/10 border-muted-foreground/20">
              <CardContent className="p-6 text-center text-muted-foreground text-sm">
                {comments.length === 0 ? "Aguardando comentários do Instagram. Verifique se a extensão Livete está ativa no navegador da live 📲" : searchNorm ? `Nenhum comentário encontrado para "${search.trim()}".` : "Nenhum comentário neste filtro."}
              </CardContent>
            </Card>
          )}
          {filtered.map((comment) => (
            <CommentCard
              key={comment.id}
              comment={comment}
              data={dataRef.current.get(cleanPresenterHandle(comment.username))}
              isHighlighted={recentlyHighlighted.has(comment.id)}
              nowTick={nowTick}
              onOpenOrder={onOpenOrder}
              onOpenWhatsApp={onOpenWhatsApp}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
