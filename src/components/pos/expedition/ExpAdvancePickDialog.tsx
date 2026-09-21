import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Check, X, PackageCheck } from "lucide-react";
import { ExpOrder, ExpItem, brl } from "./expeditionTypes";

interface Props {
  /** Pedido (ou todos os pedidos do envio unificado) que está avançando da Separação. */
  orders: ExpOrder[] | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}

type Row = { order: ExpOrder; item: ExpItem };

/**
 * Pergunta ao avançar da SEPARAÇÃO: "Possui todos os produtos?".
 * - Tem todos  → Conferência normal.
 * - Tem parte  → Conferência com a marcação AGUARDANDO PRODUTO PRA FAZER ENVIO.
 * - Não tem nenhum → fica na etapa AGUARDANDO.
 */
export function ExpAdvancePickDialog({ orders, open, onOpenChange, onDone }: Props) {
  const list = orders || [];
  const rows = useMemo<Row[]>(
    () => list.flatMap((o) => o.items.map((item) => ({ order: o, item }))),
    [list],
  );
  const [have, setHave] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setHave(Object.fromEntries(rows.map((r) => [r.item.id, true])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rows.length]);

  const haveCount = rows.filter((r) => have[r.item.id]).length;
  const single = rows.length === 1;
  const multiOrder = list.length > 1;

  const confirm = async () => {
    if (!rows.length) return;
    setSaving(true);
    try {
      const missing = rows.length - haveCount;
      const stage = haveCount === 0 ? "aguardando" : "conferencia";

      // 1) grava quanto de cada item foi separado
      const updates = rows.map((r) => ({
        id: r.item.id,
        qty: have[r.item.id] ? Number(r.item.quantity) || 0 : 0,
      }));
      for (let i = 0; i < updates.length; i += 20) {
        await Promise.all(
          updates
            .slice(i, i + 20)
            .map((u) =>
              supabase.from("pos_sale_items").update({ expedition_picked_qty: u.qty } as any).eq("id", u.id),
            ),
        );
      }

      // 2) move os pedidos (grupo inteiro junto) e marca a espera por produto
      const ids = list.map((o) => o.id);
      const { error } = await supabase
        .from("pos_sales")
        .update({ expedition_stage: stage, expedition_waiting_products: missing > 0 } as any)
        .in("id", ids);
      if (error) throw error;

      toast.success(
        missing === 0
          ? `${ids.length} pedido(s) enviados para Conferência`
          : haveCount === 0
            ? `${ids.length} pedido(s) em Aguardando — nenhum produto disponível`
            : `${ids.length} pedido(s) em Conferência aguardando ${missing} produto(s)`,
      );
      onOpenChange(false);
      onDone();
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível avançar o pedido");
    } finally {
      setSaving(false);
    }
  };

  const setAll = (v: boolean) => setHave(Object.fromEntries(rows.map((r) => [r.item.id, v])));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black">
            {single ? "VOCÊ POSSUI ESSE PRODUTO?" : "POSSUI TODOS OS PRODUTOS?"}
          </DialogTitle>
        </DialogHeader>

        {multiOrder && (
          <p className="text-sm font-bold text-amber-600">
            Envio unificado — {list.length} pedidos de {list[0]?.customer_name || "mesmo cliente"} seguem juntos.
          </p>
        )}

        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {rows.map(({ order, item }) => {
            const ok = !!have[item.id];
            return (
              <div
                key={item.id}
                className={`rounded-xl border-2 p-3 flex items-center gap-3 flex-wrap ${
                  ok ? "border-exp-done/60 bg-exp-done/5" : "border-destructive/60 bg-destructive/5"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-black text-pos-text">{item.product_name}</p>
                  <p className="text-sm font-semibold text-pos-muted-text">
                    {[item.variant_name, item.size && `Tam ${item.size}`, item.sku, item.barcode]
                      .filter(Boolean)
                      .join(" • ")}
                  </p>
                  <p className="text-sm font-bold text-pos-muted-text">
                    {item.quantity}x · {brl(item.total_price)}
                    {multiOrder ? ` · ${order.customer_name || "pedido"}` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="lg"
                    className={`font-black ${ok ? "bg-exp-done text-white" : "bg-muted text-pos-muted-text"}`}
                    onClick={() => setHave((p) => ({ ...p, [item.id]: true }))}
                  >
                    <Check className="h-5 w-5 mr-1" /> {single ? "SIM" : "TEMOS"}
                  </Button>
                  <Button
                    size="lg"
                    className={`font-black ${!ok ? "bg-destructive text-white" : "bg-muted text-pos-muted-text"}`}
                    onClick={() => setHave((p) => ({ ...p, [item.id]: false }))}
                  >
                    <X className="h-5 w-5 mr-1" /> {single ? "NÃO" : "NÃO TEMOS"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-2 flex-wrap pt-2">
          {!single && (
            <>
              <Button variant="outline" className="font-bold" onClick={() => setAll(true)}>
                Tenho todos
              </Button>
              <Button variant="outline" className="font-bold" onClick={() => setAll(false)}>
                Não tenho nenhum
              </Button>
            </>
          )}
          <Badge className="bg-pos-elevated text-pos-text font-bold">
            {haveCount} de {rows.length} disponível(is)
          </Badge>
          <Button
            size="lg"
            className="ml-auto font-black bg-exp-pick hover:bg-exp-pick/90 text-white"
            disabled={saving}
            onClick={confirm}
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin mr-1" /> : <PackageCheck className="h-5 w-5 mr-1" />}
            {haveCount === 0
              ? "MANDAR PARA AGUARDANDO"
              : haveCount === rows.length
                ? "AVANÇAR PARA CONFERÊNCIA"
                : "AVANÇAR E AGUARDAR O QUE FALTA"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
