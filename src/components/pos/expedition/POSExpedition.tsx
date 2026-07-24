import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw, Search, Package, Truck, ScanBarcode, CheckCircle2, PlayCircle, Layers, ChevronRight, MapPin, Store } from "lucide-react";
import {
  EXP_STAGES,
  ExpOrder,
  ExpStage,
  ORIGIN_LABEL,
  brl,
  customerKey,
  fetchExpeditionOrders,
  nextStage,
  trackingLink,
} from "./expeditionTypes";
import { ExpConferenceDialog } from "./ExpConferenceDialog";

interface Props {
  storeId: string;
  storeName?: string;
}

const stageStyles: Record<ExpStage, { chip: string; ring: string; text: string }> = {
  novo: { chip: "bg-exp-new", ring: "border-exp-new/40", text: "text-exp-new" },
  preparacao: { chip: "bg-exp-prep", ring: "border-exp-prep/40", text: "text-exp-prep" },
  separacao: { chip: "bg-exp-pick", ring: "border-exp-pick/40", text: "text-exp-pick" },
  conferencia: { chip: "bg-exp-check", ring: "border-exp-check/40", text: "text-exp-check" },
  concluido: { chip: "bg-exp-done", ring: "border-exp-done/40", text: "text-exp-done" },
};

const stageIcon: Record<ExpStage, any> = {
  novo: PlayCircle,
  preparacao: Layers,
  separacao: Package,
  conferencia: ScanBarcode,
  concluido: CheckCircle2,
};

export function POSExpedition({ storeId, storeName }: Props) {
  const [stage, setStage] = useState<ExpStage>("novo");
  const [orders, setOrders] = useState<ExpOrder[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [conferenceOrder, setConferenceOrder] = useState<ExpOrder | null>(null);
  const [stockByBarcode, setStockByBarcode] = useState<Record<string, { store: string; stock: number }[]>>({});

  const loadCounts = async () => {
    const { data } = await supabase
      .from("pos_sales")
      .select("expedition_stage")
      .eq("store_id", storeId)
      .in("sale_type", ["live", "online"])
      .neq("status", "cancelled")
      .in("expedition_stage", ["novo", "preparacao", "separacao", "conferencia"]);
    const c: Record<string, number> = {};
    for (const r of (data || []) as any[]) c[r.expedition_stage] = (c[r.expedition_stage] || 0) + 1;
    setCounts(c);
  };

  const load = async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const rows = await fetchExpeditionOrders(storeId, stage);
      setOrders(rows);
      await loadCounts();
    } catch (e: any) {
      toast.error(e.message || "Erro ao carregar expedição");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, stage]);

  useEffect(() => {
    if (!storeId) return;
    const ch = supabase
      .channel(`pos-expedition-${storeId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pos_sales", filter: `store_id=eq.${storeId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, stage]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter(
      (o) =>
        (o.customer_name || "").toLowerCase().includes(q) ||
        (o.customer_phone || "").includes(q) ||
        (o.tracking_code || "").toLowerCase().includes(q) ||
        o.items.some((i) => (i.product_name || "").toLowerCase().includes(q) || (i.sku || "").toLowerCase().includes(q)),
    );
  }, [orders, search]);

  const groups = useMemo(() => {
    const map = new Map<string, ExpOrder[]>();
    for (const o of filtered) {
      const key = o.expedition_group_id || customerKey(o);
      const arr = map.get(key) || [];
      arr.push(o);
      map.set(key, arr);
    }
    return [...map.entries()];
  }, [filtered]);

  const advance = async (o: ExpOrder, target?: ExpStage) => {
    const to = target || nextStage(o.expedition_stage);
    if (!to) return;
    setBusyId(o.id);
    try {
      const patch: any = { expedition_stage: to };
      if (to === "concluido") patch.expedition_finished_at = new Date().toISOString();
      const { error } = await supabase.from("pos_sales").update(patch).eq("id", o.id);
      if (error) throw error;
      toast.success(`Pedido movido para ${EXP_STAGES.find((s) => s.id === to)?.label}`);
      load();
    } catch (e: any) {
      toast.error(e.message || "Erro ao avançar etapa");
    } finally {
      setBusyId(null);
    }
  };

  const unifyGroup = async (list: ExpOrder[]) => {
    if (list.length < 2) return;
    const gid = list[0].expedition_group_id || crypto.randomUUID();
    try {
      const { error } = await supabase
        .from("pos_sales")
        .update({ expedition_group_id: gid })
        .in("id", list.map((o) => o.id));
      if (error) throw error;
      toast.success(`${list.length} pedidos unificados em 1 envio`);
      load();
    } catch (e: any) {
      toast.error(e.message || "Erro ao unificar");
    }
  };

  const undoUnify = async (list: ExpOrder[]) => {
    try {
      const { error } = await supabase
        .from("pos_sales")
        .update({ expedition_group_id: null })
        .in("id", list.map((o) => o.id));
      if (error) throw error;
      toast.success("Unificação desfeita");
      load();
    } catch (e: any) {
      toast.error(e.message || "Erro ao desfazer");
    }
  };

  const loadStock = async (o: ExpOrder) => {
    const barcodes = o.items.map((i) => i.barcode).filter(Boolean) as string[];
    if (!barcodes.length) return;
    const { data } = await supabase
      .from("pos_products")
      .select("barcode, stock, store_id, pos_stores(name)")
      .in("barcode", barcodes)
      .gt("stock", 0);
    const map: Record<string, { store: string; stock: number }[]> = {};
    for (const r of (data || []) as any[]) {
      const arr = map[r.barcode] || [];
      arr.push({ store: r.pos_stores?.name || "Loja", stock: r.stock });
      map[r.barcode] = arr;
    }
    setStockByBarcode((prev) => ({ ...prev, ...map }));
  };

  const toggleExpand = (o: ExpOrder) => {
    const open = expanded === o.id ? null : o.id;
    setExpanded(open);
    if (open && stage === "separacao") loadStock(o);
  };

  return (
    <div className="flex flex-col h-full bg-pos-bg">
      {/* Header */}
      <div className="px-4 py-4 border-b border-pos-border bg-pos-card">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-3xl font-black tracking-tight text-pos-text flex items-center gap-2">
              <Truck className="h-8 w-8 text-exp-prep" /> EXPEDIÇÃO
            </h2>
            <p className="text-base font-semibold text-pos-muted-text">
              Envios online e de lives {storeName ? `— ${storeName}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-pos-muted-text" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar cliente, produto, rastreio..."
                className="pl-9 h-12 w-72 text-base"
              />
            </div>
            <Button variant="outline" size="lg" onClick={load} disabled={loading}>
              <RefreshCw className={`h-5 w-5 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* Stage bar */}
        <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-2">
          {EXP_STAGES.map((s) => {
            const Icon = stageIcon[s.id];
            const active = stage === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setStage(s.id)}
                className={`rounded-xl px-3 py-4 text-left transition-all border-2 ${
                  active
                    ? `${stageStyles[s.id].chip} text-white border-transparent shadow-lg scale-[1.02]`
                    : `bg-pos-elevated ${stageStyles[s.id].ring} hover:scale-[1.01]`
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon className={`h-6 w-6 ${active ? "text-white" : stageStyles[s.id].text}`} />
                  <span className={`text-lg font-black uppercase leading-tight ${active ? "text-white" : "text-pos-text"}`}>
                    {s.label}
                  </span>
                </div>
                {s.id !== "concluido" && (
                  <div className={`mt-1 text-2xl font-black ${active ? "text-white" : stageStyles[s.id].text}`}>
                    {counts[s.id] || 0}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-10 w-10 animate-spin text-exp-prep" />
          </div>
        ) : groups.length === 0 ? (
          <div className="text-center py-20">
            <Package className="h-16 w-16 mx-auto text-pos-muted-text/40" />
            <p className="mt-3 text-xl font-bold text-pos-muted-text">Nenhum pedido nesta etapa</p>
          </div>
        ) : (
          groups.map(([key, list]) => {
            const unified = list.length > 1 && !!list[0].expedition_group_id;
            const canUnify = stage === "preparacao" && list.length > 1 && !unified;
            return (
              <div key={key} className="space-y-2">
                {(unified || canUnify) && (
                  <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-exp-prep/10 border-2 border-exp-prep/30">
                    <Layers className="h-5 w-5 text-exp-prep" />
                    <span className="text-base font-bold text-pos-text">
                      {list.length} pedidos de {list[0].customer_name || "mesmo cliente"}
                      {unified ? " — ENVIO UNIFICADO" : ""}
                    </span>
                    {canUnify ? (
                      <Button size="sm" className="ml-auto bg-exp-prep hover:bg-exp-prep/90 text-white font-bold" onClick={() => unifyGroup(list)}>
                        Unificar em 1 envio
                      </Button>
                    ) : (
                      unified && (
                        <Button size="sm" variant="outline" className="ml-auto" onClick={() => undoUnify(list)}>
                          Desfazer unificação
                        </Button>
                      )
                    )}
                  </div>
                )}

                {list.map((o) => (
                  <div
                    key={o.id}
                    className={`rounded-xl bg-pos-card border-2 ${stageStyles[stage].ring} shadow-pos-card overflow-hidden`}
                  >
                    <div className="p-4 cursor-pointer" onClick={() => toggleExpand(o)}>
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-2xl font-black text-pos-text truncate">
                              {o.customer_name || "Sem nome"}
                            </span>
                            <Badge className={`${stageStyles[stage].chip} text-white text-sm font-bold`}>
                              {ORIGIN_LABEL[o.origin]}
                            </Badge>
                            {o.event_name && (
                              <Badge variant="outline" className="text-sm font-bold">{o.event_name}</Badge>
                            )}
                          </div>
                          <div className="mt-1 text-base font-semibold text-pos-muted-text flex items-center gap-3 flex-wrap">
                            <span>{o.items.length} item(ns)</span>
                            <span>{brl(o.total)}</span>
                            <span>{new Date(o.created_at).toLocaleString("pt-BR")}</span>
                            {o.delivery_method && (
                              <span className="flex items-center gap-1">
                                <Truck className="h-4 w-4" /> {o.delivery_method}
                              </span>
                            )}
                          </div>
                          {o.shipping_address?.city && (
                            <div className="mt-1 text-sm font-medium text-pos-muted-text flex items-center gap-1">
                              <MapPin className="h-4 w-4" />
                              {o.shipping_address.address}, {o.shipping_address.number} — {o.shipping_address.neighborhood}, {o.shipping_address.city}/{o.shipping_address.state}
                            </div>
                          )}
                          {o.tracking_code && (
                            <a
                              href={trackingLink(o.tracking_code)}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="mt-1 inline-block text-base font-bold text-exp-done underline"
                            >
                              Rastreio: {o.tracking_code}
                            </a>
                          )}
                        </div>

                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          {stage === "novo" && (
                            <Button
                              size="lg"
                              className="bg-exp-new hover:bg-exp-new/90 text-white text-base font-black"
                              disabled={busyId === o.id}
                              onClick={() => advance(o)}
                            >
                              {busyId === o.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <PlayCircle className="h-5 w-5 mr-1" />}
                              INICIAR EXPEDIÇÃO
                            </Button>
                          )}
                          {stage === "preparacao" && (
                            <Button
                              size="lg"
                              className="bg-exp-prep hover:bg-exp-prep/90 text-white text-base font-black"
                              disabled={busyId === o.id}
                              onClick={() => advance(o)}
                            >
                              IR PARA SEPARAÇÃO <ChevronRight className="h-5 w-5" />
                            </Button>
                          )}
                          {stage === "separacao" && (
                            <Button
                              size="lg"
                              className="bg-exp-pick hover:bg-exp-pick/90 text-white text-base font-black"
                              disabled={busyId === o.id}
                              onClick={() => advance(o)}
                            >
                              SEPARADO <ChevronRight className="h-5 w-5" />
                            </Button>
                          )}
                          {stage === "conferencia" && (
                            <Button
                              size="lg"
                              className="bg-exp-check hover:bg-exp-check/90 text-white text-base font-black"
                              onClick={() => setConferenceOrder(o)}
                            >
                              <ScanBarcode className="h-5 w-5 mr-1" /> CONFERIR E FINALIZAR
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>

                    {expanded === o.id && (
                      <div className="border-t-2 border-pos-border bg-pos-elevated p-4 space-y-2">
                        {o.items.map((it) => (
                          <div key={it.id} className="flex items-start justify-between gap-3 py-2 border-b border-pos-border/60 last:border-0">
                            <div>
                              <p className="text-lg font-bold text-pos-text">{it.product_name}</p>
                              <p className="text-base font-semibold text-pos-muted-text">
                                {[it.variant_name, it.size && `Tam ${it.size}`, it.sku].filter(Boolean).join(" • ")}
                              </p>
                              {stage === "separacao" && it.barcode && (
                                <p className="text-sm font-bold text-exp-pick flex items-center gap-1 mt-1">
                                  <Store className="h-4 w-4" />
                                  {(stockByBarcode[it.barcode] || []).length
                                    ? stockByBarcode[it.barcode].map((s) => `${s.store}: ${s.stock}`).join(" | ")
                                    : "Sem estoque localizado"}
                                </p>
                              )}
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-lg font-black text-pos-text">{it.quantity}x</p>
                              <p className="text-base font-semibold text-pos-muted-text">{brl(it.total_price)}</p>
                            </div>
                          </div>
                        ))}
                        {o.notes && <p className="text-base font-semibold text-pos-muted-text">Obs: {o.notes}</p>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>

      {conferenceOrder && (
        <ExpConferenceDialog
          order={conferenceOrder}
          open={!!conferenceOrder}
          onOpenChange={(v) => !v && setConferenceOrder(null)}
          onFinished={() => {
            setConferenceOrder(null);
            load();
          }}
        />
      )}
    </div>
  );
}

export default POSExpedition;
