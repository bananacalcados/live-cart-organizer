import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Trash2, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { ExpOrder, brl, onlyDigits } from "./expeditionTypes";

interface Props {
  order: ExpOrder | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDeleted: () => void;
}

interface SiblingSale {
  id: string;
  created_at: string;
  total: number;
  status_cancelamento: string | null;
  items: string[];
  signature: string;
  sameItems: boolean;
}

/** Assinatura do conjunto de itens (SKU/nome + tamanho/cor + quantidade), independente da ordem. */
const itemsSignature = (items: { sku?: string | null; product_name?: string | null; variant_name?: string | null; size?: string | null; quantity?: number | null }[]) =>
  items
    .map((i) =>
      [
        (i.sku || i.product_name || "").toString().trim().toLowerCase(),
        (i.variant_name || "").toString().trim().toLowerCase(),
        (i.size || "").toString().trim().toLowerCase(),
        Number(i.quantity || 1),
      ].join("~"),
    )
    .sort()
    .join("||");

const itemLabel = (i: any) =>
  `${i.quantity || 1}x ${i.product_name || i.sku || "Item"}${i.variant_name ? ` · ${i.variant_name}` : ""}${i.size ? ` · ${i.size}` : ""}`;

/**
 * Exclusão (estorno) de pedido da Expedição.
 * Não apaga o histórico: a venda é CANCELADA (sai de todas as etapas) e,
 * opcionalmente, os produtos voltam ao estoque com registro de movimentação.
 *
 * TRAVA DE SEGURANÇA ANTI-DUPLICIDADE: quando o motivo indica "duplicado",
 * o diálogo compara os PRODUTOS deste pedido com os outros pedidos do mesmo
 * cliente. Se nenhum outro pedido tiver exatamente os mesmos itens, a exclusão
 * exige confirmação extra — evita apagar um pedido legítimo por engano.
 */
export function ExpDeleteOrderDialog({ order, open, onOpenChange, onDeleted }: Props) {
  const [reason, setReason] = useState("");
  const [restoreStock, setRestoreStock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [siblings, setSiblings] = useState<SiblingSale[]>([]);
  const [loadingSiblings, setLoadingSiblings] = useState(false);
  const [overrideChecked, setOverrideChecked] = useState(false);

  const orderId = order?.id || null;
  const phone8 = onlyDigits(order?.customer_phone || order?.resolved_phone || "").slice(-8);
  const cpf = onlyDigits(order?.customer_cpf || "");
  const mySignature = useMemo(() => itemsSignature(order?.items || []), [order?.items]);

  useEffect(() => {
    if (!open || !orderId) return;
    setReason("");
    setOverrideChecked(false);
    setSiblings([]);

    let cancelled = false;
    (async () => {
      setLoadingSiblings(true);
      try {
        let q = supabase
          .from("pos_sales")
          .select("id, created_at, total, status_cancelamento, customer_phone, customer_cpf")
          .neq("id", orderId)
          .order("created_at", { ascending: false })
          .limit(30);

        const filters: string[] = [];
        if (phone8.length === 8) filters.push(`customer_phone.ilike.%${phone8}`);
        if (cpf.length === 11) filters.push(`customer_cpf.eq.${cpf}`);
        if (!filters.length) {
          setSiblings([]);
          return;
        }
        q = q.or(filters.join(","));

        const { data: sales, error } = await q;
        if (error) throw error;
        const ids = (sales || []).map((s: any) => s.id);
        if (!ids.length) {
          if (!cancelled) setSiblings([]);
          return;
        }
        const { data: items } = await supabase
          .from("pos_sale_items")
          .select("sale_id, sku, product_name, variant_name, size, quantity")
          .in("sale_id", ids);

        const byId = new Map<string, any[]>();
        (items || []).forEach((it: any) => {
          const arr = byId.get(it.sale_id) || [];
          arr.push(it);
          byId.set(it.sale_id, arr);
        });

        const result: SiblingSale[] = (sales || []).map((s: any) => {
          const its = byId.get(s.id) || [];
          const sig = itemsSignature(its);
          return {
            id: s.id,
            created_at: s.created_at,
            total: Number(s.total || 0),
            status_cancelamento: s.status_cancelamento,
            items: its.map(itemLabel),
            signature: sig,
            sameItems: !!sig && sig === mySignature,
          };
        });
        if (!cancelled) setSiblings(result);
      } catch {
        if (!cancelled) setSiblings([]);
      } finally {
        if (!cancelled) setLoadingSiblings(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orderId]);

  if (!order) return null;

  const ids = order.group_order_ids?.length ? order.group_order_ids : [order.id];
  const reasonValid = reason.trim().length >= 3;
  const claimsDuplicate = /duplic/i.test(reason);
  const twin = siblings.find((s) => s.sameItems && s.status_cancelamento !== "cancelado");
  const needsOverride = claimsDuplicate && !loadingSiblings && !twin;
  const canDelete = reasonValid && (!needsOverride || overrideChecked);

  const run = async () => {
    if (!reasonValid) {
      toast.error("Informe o motivo da exclusão (mínimo 3 caracteres)");
      return;
    }
    if (needsOverride && !overrideChecked) {
      toast.error("Nenhum pedido igual foi encontrado. Confirme a conferência para excluir.");
      return;
    }
    setBusy(true);
    try {
      for (const id of ids) {
        const { error } = await supabase.rpc("expedition_cancel_sale" as any, {
          p_sale_id: id,
          p_reason: reason.trim(),
          p_restore_stock: restoreStock,
        });
        if (error) throw error;
      }
      toast.success(
        ids.length > 1 ? `${ids.length} pedidos excluídos da expedição` : "Pedido excluído da expedição",
      );
      setReason("");
      onDeleted();
    } catch (e: any) {
      toast.error(e.message || "Erro ao excluir pedido");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-destructive" /> Excluir pedido da expedição
          </DialogTitle>
          <DialogDescription className="text-base font-semibold">
            {order.customer_name || "Sem nome"} · {brl(order.total)}
            {ids.length > 1 ? ` · ${ids.length} pedidos unificados` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border-2 border-destructive/40 bg-destructive/10 p-3 text-sm font-semibold">
            A venda será <b>cancelada</b> e sai de todas as etapas da expedição. O histórico é
            preservado (nada é apagado do banco).
          </div>

          {/* Produtos deste pedido */}
          <div className="rounded-lg border-2 p-3">
            <p className="text-xs font-black uppercase text-muted-foreground mb-1">
              Produtos deste pedido
            </p>
            <ul className="text-sm font-semibold space-y-0.5">
              {(order.items || []).map((i) => (
                <li key={i.id} className="break-words">
                  {itemLabel(i)}
                </li>
              ))}
              {!order.items?.length && <li className="text-muted-foreground">Sem itens</li>}
            </ul>
          </div>

          {/* Comparação com outros pedidos do mesmo cliente */}
          <div className="rounded-lg border-2 p-3">
            <p className="text-xs font-black uppercase text-muted-foreground mb-1">
              Outros pedidos deste cliente
            </p>
            {loadingSiblings ? (
              <p className="text-sm font-semibold flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Conferindo...
              </p>
            ) : siblings.length === 0 ? (
              <p className="text-sm font-semibold text-muted-foreground">
                Nenhum outro pedido encontrado para este cliente.
              </p>
            ) : (
              <ul className="space-y-2 max-h-48 overflow-y-auto">
                {siblings.slice(0, 8).map((s) => (
                  <li
                    key={s.id}
                    className={`rounded-md border p-2 text-sm ${
                      s.sameItems ? "border-destructive/60 bg-destructive/10" : "border-border"
                    }`}
                  >
                    <div className="flex items-center gap-2 font-bold">
                      {s.sameItems ? (
                        <XCircle className="h-4 w-4 text-destructive shrink-0" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                      <span>
                        {new Date(s.created_at).toLocaleDateString("pt-BR")} · {brl(s.total)}
                        {s.status_cancelamento === "cancelado" ? " · cancelado" : ""}
                      </span>
                      {s.sameItems && (
                        <span className="ml-auto text-xs font-black text-destructive">
                          MESMOS PRODUTOS
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-semibold text-muted-foreground break-words">
                      {s.items.join(" · ") || "Sem itens"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <Checkbox checked={restoreStock} onCheckedChange={(v) => setRestoreStock(!!v)} />
            <span className="text-base font-bold">Devolver produtos ao estoque</span>
          </label>

          <div className="space-y-1">
            <Label className="text-base font-bold">
              Motivo <span className="text-destructive">*</span>
            </Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: cliente desistiu / venda estornada"
              aria-invalid={!reasonValid}
            />
            <p className="text-xs font-semibold text-muted-foreground">
              Obrigatório. O motivo e o usuário que excluiu ficam registrados no histórico.
            </p>
          </div>

          {claimsDuplicate && !loadingSiblings && twin && (
            <div className="rounded-lg border-2 border-destructive/50 bg-destructive/10 p-3 text-sm font-bold">
              Confirmado: existe outro pedido ativo deste cliente com exatamente os mesmos produtos
              ({new Date(twin.created_at).toLocaleDateString("pt-BR")} · {brl(twin.total)}).
            </div>
          )}

          {needsOverride && (
            <div className="rounded-lg border-2 border-amber-500 bg-amber-500/15 p-3 space-y-2">
              <p className="text-sm font-black">
                ATENÇÃO: nenhum outro pedido deste cliente tem os mesmos produtos. Este pedido
                provavelmente NÃO é duplicado.
              </p>
              <label className="flex items-start gap-3 cursor-pointer">
                <Checkbox
                  checked={overrideChecked}
                  onCheckedChange={(v) => setOverrideChecked(!!v)}
                  className="mt-0.5"
                />
                <span className="text-sm font-bold">
                  Conferi os produtos e confirmo que quero excluir mesmo assim.
                </span>
              </label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            className="font-black"
            onClick={run}
            disabled={busy || !canDelete}
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin mr-1" /> : <Trash2 className="h-5 w-5 mr-1" />}
            EXCLUIR PEDIDO
          </Button>
        </DialogFooter>

      </DialogContent>
    </Dialog>
  );
}
