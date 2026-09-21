import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, LayoutGrid, PackageCheck, AlertTriangle, RefreshCw } from "lucide-react";
import { ExpGradeReport } from "./ExpGradeReport";
import { ExpItem, ExpOrder, fetchExpeditionOrders, orderChannelLabel } from "./expeditionTypes";
import { expeditionWaitingRank } from "@/lib/expeditionPriority";

interface Props {
  storeId: string;
  onRefresh: () => void;
  /** Recarrega quando a lista da etapa muda. */
  reloadKey?: unknown;
}

interface WaitDep {
  order: ExpOrder;
  item: ExpItem;
  missing: number;
}

interface WaitLine {
  key: string;
  product_name: string;
  variant_name: string | null;
  size: string | null;
  sku: string | null;
  barcode: string | null;
  total: number;
  deps: WaitDep[];
}

const STAGE_LABEL: Record<string, string> = {
  aguardando: "Aguardando",
  conferencia: "Conferência",
};

const lineKey = (it: ExpItem) =>
  [
    (it.product_name || "").trim().toLowerCase(),
    (it.variant_name || "").trim().toLowerCase(),
    (it.size || "").trim().toLowerCase(),
  ].join("|");

const missingOf = (it: ExpItem) =>
  Math.max(0, (Number(it.quantity) || 0) - (Number(it.expedition_picked_qty) || 0));

/** Painel de faltas da etapa AGUARDANDO: produtos aguardados + pedidos que dependem deles. */
export function ExpWaitingPanel({ storeId, onRefresh, reloadKey }: Props) {
  const [orders, setOrders] = useState<ExpOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [gradeOpen, setGradeOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [waiting, conf] = await Promise.all([
        fetchExpeditionOrders(storeId, "aguardando"),
        fetchExpeditionOrders(storeId, "conferencia").catch(() => [] as ExpOrder[]),
      ]);
      const flagged = conf.filter((o) => (o as any).expedition_waiting_products);
      setOrders([...waiting, ...flagged]);
    } catch (e: any) {
      toast.error(e?.message || "Erro ao carregar produtos aguardados");
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const lines = useMemo<WaitLine[]>(() => {
    const map = new Map<string, WaitLine>();
    for (const o of orders) {
      for (const item of o.items) {
        const missing = missingOf(item);
        if (missing <= 0) continue;
        const k = lineKey(item);
        const cur =
          map.get(k) ||
          ({
            key: k,
            product_name: item.product_name || "Produto",
            variant_name: item.variant_name,
            size: item.size,
            sku: item.sku,
            barcode: item.barcode,
            total: 0,
            deps: [],
          } as WaitLine);
        cur.total += missing;
        cur.sku = cur.sku || item.sku;
        cur.barcode = cur.barcode || item.barcode;
        cur.deps.push({ order: o, item, missing });
        map.set(k, cur);
      }
    }
    const rank = (l: WaitLine) => Math.min(...l.deps.map((d) => expeditionWaitingRank(d.order)));
    const oldest = (l: WaitLine) =>
      Math.min(...l.deps.map((d) => new Date(d.order.created_at).getTime()));
    return [...map.values()]
      .map((l) => ({
        ...l,
        deps: [...l.deps].sort(
          (a, b) =>
            expeditionWaitingRank(a.order) - expeditionWaitingRank(b.order) ||
            +new Date(a.order.created_at) - +new Date(b.order.created_at),
        ),
      }))
      .sort((a, b) => rank(a) - rank(b) || oldest(a) - oldest(b));
  }, [orders]);

  const saleIds = useMemo(() => [...new Set(orders.map((o) => o.id))], [orders]);

  /** Marca o produto como chegado/separado em todos os pedidos que dependem dele. */
  const markArrived = async (deps: WaitDep[], label: string) => {
    setBusy(label);
    try {
      await Promise.all(
        deps.map((d) =>
          supabase
            .from("pos_sale_items")
            .update({ expedition_picked_qty: Number(d.item.quantity) || 0 } as any)
            .eq("id", d.item.id),
        ),
      );
      // Pedido que ficou completo perde o aviso de espera.
      const done: string[] = [];
      for (const o of new Map(deps.map((d) => [d.order.id, d.order])).values()) {
        const ids = new Set(deps.filter((d) => d.order.id === o.id).map((d) => d.item.id));
        const stillMissing = o.items.some((it) => !ids.has(it.id) && missingOf(it) > 0);
        if (!stillMissing) done.push(o.id);
      }
      if (done.length) {
        await supabase
          .from("pos_sales")
          .update({ expedition_waiting_products: false } as any)
          .in("id", done);
      }
      toast.success("Produto marcado como separado");
      await load();
      onRefresh();
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível marcar o produto");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-lg font-black text-pos-text">
          {lines.length} produto(s) aguardado(s) · {lines.reduce((s, l) => s + l.total, 0)} peça(s)
        </span>
        <Button variant="outline" onClick={load} className="font-bold" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
          Atualizar
        </Button>
        <Button
          variant="outline"
          onClick={() => setGradeOpen(true)}
          className="font-bold ml-auto"
          disabled={!saleIds.length}
        >
          <LayoutGrid className="h-4 w-4 mr-1" /> Grades · Reposição
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
        </div>
      ) : lines.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-pos-border p-6 text-center text-lg font-bold text-pos-muted-text">
          Nenhum produto aguardando reposição.
        </div>
      ) : (
        lines.map((l) => (
          <div key={l.key} className="rounded-xl bg-pos-card border-2 border-amber-500/50 p-4">
            <div className="flex items-start gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-xl font-black text-pos-text">{l.product_name}</p>
                <p className="text-base font-semibold text-pos-muted-text">
                  {[l.variant_name, l.size && `Tam ${l.size}`, l.sku, l.barcode].filter(Boolean).join(" • ")}
                </p>
              </div>
              <Badge className="bg-amber-500 text-white text-base font-black">
                FALTAM {l.total} PEÇA(S)
              </Badge>
              <Button
                className="bg-exp-done hover:bg-exp-done/90 text-white font-black"
                disabled={busy === l.key}
                onClick={() => markArrived(l.deps, l.key)}
              >
                {busy === l.key ? (
                  <Loader2 className="h-5 w-5 animate-spin mr-1" />
                ) : (
                  <PackageCheck className="h-5 w-5 mr-1" />
                )}
                CHEGOU / SEPARADO
              </Button>
            </div>

            <div className="mt-3 space-y-1.5">
              <p className="text-sm font-black uppercase text-pos-muted-text">
                Pedidos que dependem deste produto
              </p>
              {l.deps.map((d, i) => (
                <div
                  key={`${d.item.id}-${i}`}
                  className="flex items-center gap-2 flex-wrap text-base font-semibold text-pos-text border-b border-pos-border/50 last:border-0 py-1"
                >
                  <span className="font-black">{d.order.customer_name || "Sem nome"}</span>
                  <Badge variant="outline" className="text-xs font-bold">
                    {orderChannelLabel(d.order)}
                  </Badge>
                  <Badge
                    className={`text-xs font-black text-white ${
                      d.order.expedition_stage === "conferencia" ? "bg-exp-check" : "bg-amber-500"
                    }`}
                  >
                    {STAGE_LABEL[d.order.expedition_stage] || d.order.expedition_stage}
                  </Badge>
                  {expeditionWaitingRank(d.order) <= 3 && (
                    <Badge variant="outline" className="text-xs font-black border-orange-500 text-orange-600">
                      PRIORIDADE
                    </Badge>
                  )}
                  <span className="text-sm text-pos-muted-text">
                    {d.missing}x · {new Date(d.order.created_at).toLocaleDateString("pt-BR")}
                  </span>
                  {d.order.expedition_stage === "conferencia" && (
                    <span className="flex items-center gap-1 text-sm font-black text-destructive">
                      <AlertTriangle className="h-4 w-4" /> NÃO CONCLUIR
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto font-bold border-exp-done text-exp-done"
                    disabled={busy === `${l.key}-${i}`}
                    onClick={() => markArrived([d], `${l.key}-${i}`)}
                  >
                    Separado só deste pedido
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      <Dialog open={gradeOpen} onOpenChange={setGradeOpen}>
        <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-black">Grades · Reposição — Aguardando</DialogTitle>
          </DialogHeader>
          <ExpGradeReport saleIds={saleIds} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
