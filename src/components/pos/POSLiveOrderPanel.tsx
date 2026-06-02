import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STAGES, OrderStage } from "@/types/order";
import { useDbOrderStore } from "@/stores/dbOrderStore";
import { DbOrder, DbOrderProduct } from "@/types/database";
import { OrderDialogDb } from "@/components/OrderDialogDb";
import { Radio, RefreshCw, Check, X, Pencil, Loader2, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

interface Props {
  orderId: string;
  eventId: string;
  eventName?: string;
}

const COLLAPSE_KEY = "pos_live_order_panel_collapsed";

export function POSLiveOrderPanel({ orderId, eventId, eventName }: Props) {
  const [order, setOrder] = useState<DbOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; }
  });
  const { updateOrder, moveOrder, deleteOrder, regenerateCartLink } = useDbOrderStore();

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };


  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("orders")
      .select("*, customer:customers(*)")
      .eq("id", orderId)
      .maybeSingle();
    setOrder(data as any);
    setLoading(false);
  };

  useEffect(() => { load(); }, [orderId]);

  // Realtime sync for this single order
  useEffect(() => {
    const ch = supabase
      .channel(`live-order-${orderId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${orderId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [orderId]);

  const total = useMemo(() => {
    if (!order) return 0;
    const products = (order.products as unknown as DbOrderProduct[]) || [];
    const sub = products.reduce((s, p) => s + (Number(p.price) || 0) * (Number(p.quantity) || 0), 0);
    const ship = Number(order.shipping_cost || 0);
    const disc = order.discount_type === "percentage"
      ? (sub * Number(order.discount_value || 0)) / 100
      : Number(order.discount_value || 0);
    return Math.max(0, sub - disc + (order.free_shipping ? 0 : ship));
  }, [order]);

  if (loading) {
    return (
      <div className="px-3 py-2 bg-fuchsia-500/5 border-b border-fuchsia-500/20 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Carregando pedido da Live…
      </div>
    );
  }
  if (!order) return null;

  const products = (order.products as unknown as DbOrderProduct[]) || [];
  const stageMeta = STAGES.find(s => s.id === order.stage);

  const doMarkPaid = async () => {
    setBusy("pay");
    try { await moveOrder(orderId, "paid"); toast.success("Pedido marcado como pago"); }
    finally { setBusy(null); }
  };
  const doCancel = async () => {
    if (!confirm("Cancelar este pedido? Esta ação remove o card da Live.")) return;
    setBusy("cancel");
    try {
      await updateOrder(orderId, { stage: "cancelled" } as any);
      toast.success("Pedido cancelado");
    } finally { setBusy(null); }
  };
  const doRegen = async () => {
    setBusy("regen");
    try { await regenerateCartLink(orderId); toast.success("Novo link gerado"); await load(); }
    catch { toast.error("Falha ao gerar link"); }
    finally { setBusy(null); }
  };
  const doMove = async (newStage: OrderStage) => {
    setBusy("move");
    try { await moveOrder(orderId, newStage); toast.success("Etapa atualizada"); }
    finally { setBusy(null); }
  };

  return (
    <>
      <div className="border-b border-fuchsia-500/30 bg-fuchsia-500/5 dark:bg-fuchsia-500/10 px-3 py-2 flex-shrink-0 space-y-1.5">
        <div className="flex items-center gap-2">
          <Radio className="h-3.5 w-3.5 text-fuchsia-500" />
          <span className="text-[11px] font-bold text-fuchsia-700 dark:text-fuchsia-300 uppercase tracking-wide">
            Pedido da Live
          </span>
          {eventName && (
            <Badge variant="outline" className="text-[9px] border-fuchsia-500/40 text-fuchsia-600 dark:text-fuchsia-300">
              {eventName}
            </Badge>
          )}
          {order.created_at && (
            <span className="text-[9px] text-muted-foreground whitespace-nowrap">
              {new Date(order.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
            </span>
          )}
          {stageMeta && (
            <Badge className="text-[9px] bg-fuchsia-500/20 text-fuchsia-700 dark:text-fuchsia-200 border-0">
              {stageMeta.title}
            </Badge>
          )}
          {order.is_paid ? (
            <Badge className="text-[9px] bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-0">PAGO</Badge>
          ) : (
            <Badge className="text-[9px] bg-amber-500/20 text-amber-700 dark:text-amber-300 border-0">A PAGAR</Badge>
          )}
          <span className="ml-auto text-[11px] font-bold text-fuchsia-700 dark:text-fuchsia-200">
            R$ {total.toFixed(2)}
          </span>
        </div>

        {products.length > 0 && (
          <div className="text-[10px] text-muted-foreground space-y-0.5 max-h-20 overflow-y-auto">
            {products.slice(0, 4).map((p, i) => (
              <div key={i} className="flex items-center gap-1 truncate">
                <span className="font-mono">{p.quantity}x</span>
                <span className="truncate">{p.title}</span>
                {p.variant && <span className="opacity-60">· {p.variant}</span>}
              </div>
            ))}
            {products.length > 4 && (
              <div className="opacity-60">+ {products.length - 4} item(ns)</div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1">
          <Select value={order.stage as string} onValueChange={(v) => doMove(v as OrderStage)} disabled={busy === "move"}>
            <SelectTrigger className="h-6 text-[10px] w-auto min-w-[140px] bg-white dark:bg-[#202c33]">
              <SelectValue placeholder="Mover etapa" />
            </SelectTrigger>
            <SelectContent>
              {STAGES.map(s => (
                <SelectItem key={s.id} value={s.id} className="text-[11px]">{s.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] gap-1" onClick={() => setShowEdit(true)}>
            <Pencil className="h-3 w-3" /> Editar
          </Button>
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] gap-1 text-blue-600" onClick={doRegen} disabled={busy === "regen"}>
            {busy === "regen" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Novo link
          </Button>
          {order.cart_link && (
            <a href={order.cart_link} target="_blank" rel="noreferrer" className="text-[10px] text-blue-600 hover:underline flex items-center gap-0.5">
              <ExternalLink className="h-3 w-3" /> abrir
            </a>
          )}
          {!order.is_paid && (
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] gap-1 text-emerald-600" onClick={doMarkPaid} disabled={busy === "pay"}>
              <Check className="h-3 w-3" /> Pago
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] gap-1 text-destructive" onClick={doCancel} disabled={busy === "cancel"}>
            <X className="h-3 w-3" /> Cancelar
          </Button>
        </div>
      </div>

      {showEdit && (
        <OrderDialogDb
          open={showEdit}
          onOpenChange={(o) => { setShowEdit(o); if (!o) load(); }}
          editingOrder={order}
          eventId={eventId}
        />
      )}
    </>
  );
}
