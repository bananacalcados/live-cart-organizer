import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, AlertTriangle } from "lucide-react";
import { brl } from "./expeditionTypes";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orders: { id: string; customer_name: string | null; total: number }[];
  onDone: () => void;
}

type Item = { id: string; sale_id: string; product_name: string | null; unit_price: number; quantity: number };

const REASONS = ["Cashback não aplicado", "Negociação específica", "Outro"];
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Mesma lógica da RPC apply_sale_price_adjustment, só para a prévia. */
function previewSale(items: Item[], mode: "percent" | "fixed", value: number) {
  const priced = items.filter((i) => i.unit_price > 0).sort((a, b) => a.unit_price * a.quantity - b.unit_price * b.quantity || a.id.localeCompare(b.id));
  const gross = priced.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  if (gross <= 0 || !(value > 0)) return null;
  if (mode === "fixed" && value >= gross) return { error: "redução maior que o valor dos produtos" } as const;
  if (mode === "percent" && value >= 100) return { error: "percentual deve ser menor que 100" } as const;
  const ratio = mode === "percent" ? value / 100 : value / gross;
  let remaining = value;
  let red = 0;
  const lines = priced.map((it, idx) => {
    let nu = idx === priced.length - 1 && mode === "fixed" && it.quantity === 1 ? r2(it.unit_price - remaining) : r2(it.unit_price * (1 - ratio));
    if (nu < 0.01) nu = 0.01;
    remaining -= (it.unit_price - nu) * it.quantity;
    red += (it.unit_price - nu) * it.quantity;
    return { ...it, new_price: nu };
  });
  return { lines, reduction: r2(red) } as const;
}

export function ExpPriceAdjustmentDialog({ open, onOpenChange, orders, onDone }: Props) {
  const [mode, setMode] = useState<"percent" | "fixed">("percent");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState(REASONS[0]);
  const [reasonText, setReasonText] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [blocked, setBlocked] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const idsKey = orders.map((o) => o.id).sort().join(",");

  useEffect(() => {
    if (!open || !idsKey) return;
    const ids = idsKey.split(",");
    setLoading(true);
    Promise.all([
      supabase.from("pos_sale_items").select("id, sale_id, product_name, unit_price, quantity").in("sale_id", ids),
      supabase.from("fiscal_documents").select("pos_sale_id, status, finalidade").in("pos_sale_id", ids).in("status", ["authorized", "pending"]),
      supabase.from("pos_sale_price_adjustments" as any).select("sale_id").in("sale_id", ids).is("reverted_at", null),
    ]).then(([it, fd, adj]) => {
      setItems(((it.data as any[]) || []).map((r) => ({ ...r, unit_price: Number(r.unit_price) || 0, quantity: Number(r.quantity) || 0 })));
      const b: Record<string, string> = {};
      for (const f of (fd.data as any[]) || []) if ((f.finalidade ?? 1) === 1) b[f.pos_sale_id] = "nota fiscal já emitida";
      for (const a of (adj.data as any[]) || []) b[a.sale_id] = b[a.sale_id] || "já tem redução ativa";
      setBlocked(b);
      setLoading(false);
    });
  }, [open, idsKey]);

  const num = Number(String(value).replace(",", "."));
  const previews = useMemo(
    () => orders.map((o) => ({ o, p: blocked[o.id] ? null : previewSale(items.filter((i) => i.sale_id === o.id), mode, num) })),
    [orders, items, mode, num, blocked],
  );
  const applicable = previews.filter((x) => x.p && !("error" in x.p));
  const totalRefund = applicable.reduce((s, x) => s + ((x.p as any).reduction || 0), 0);
  const finalReason = reason === "Outro" ? reasonText.trim() : reason + (reasonText.trim() ? ` — ${reasonText.trim()}` : "");

  const submit = async () => {
    if (!applicable.length || !finalReason) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("apply_sale_price_adjustment" as any, {
        p_sale_ids: applicable.map((x) => x.o.id), p_mode: mode, p_value: num, p_reason: finalReason,
      });
      if (error) throw error;
      const d = data as any;
      toast.success(`Valor reduzido em ${d?.applied?.length || 0} pedido(s). Estornar ao cliente: ${brl((d?.applied || []).reduce((s: number, a: any) => s + Number(a.refund), 0))}`);
      if (d?.skipped?.length) toast.warning(`${d.skipped.length} pedido(s) pulado(s): ${d.skipped.map((s: any) => s.motivo).join(", ")}`);
      onOpenChange(false);
      setValue("");
      onDone();
    } catch (e: any) {
      toast.error(e?.message || "Erro ao reduzir valor");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Reduzir valor da venda</DialogTitle>
          <DialogDescription>
            O preço de cada produto é reduzido (ex.: R$ 360 com 20% vira R$ 288). A nota fiscal sai com o preço novo. O estorno ao cliente é feito por você no banco.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Tipo</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="percent">Porcentagem (%)</SelectItem>
                <SelectItem value="fixed">Valor fixo (R$) por pedido</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{mode === "percent" ? "Percentual" : "Valor por pedido"}</Label>
            <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={mode === "percent" ? "20" : "50,00"} />
          </div>
          <div>
            <Label>Motivo</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>{reason === "Outro" ? "Descreva o motivo" : "Observação (opcional)"}</Label>
            <Input value={reasonText} onChange={(e) => setReasonText(e.target.value)} />
          </div>
        </div>

        {mode === "fixed" && orders.length > 1 && (
          <p className="text-sm text-muted-foreground">O valor fixo é aplicado em <b>cada</b> pedido selecionado.</p>
        )}

        {loading ? (
          <div className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <div className="space-y-2">
            {previews.map(({ o, p }) => (
              <div key={o.id} className="rounded-lg border p-3 text-sm">
                <div className="flex justify-between font-semibold">
                  <span>{o.customer_name || "Sem nome"}</span>
                  {p && !("error" in p) ? (
                    <span>{brl(o.total)} → {brl(Number(o.total) - p.reduction)} · estornar {brl(p.reduction)}</span>
                  ) : (
                    <span>{brl(o.total)}</span>
                  )}
                </div>
                {blocked[o.id] && <p className="text-destructive flex items-center gap-1 mt-1"><AlertTriangle className="h-4 w-4" />Não pode: {blocked[o.id]}</p>}
                {p && "error" in p && <p className="text-destructive mt-1">Não pode: {p.error}</p>}
                {p && !("error" in p) && (
                  <ul className="mt-1 text-muted-foreground">
                    {p.lines.map((l) => (
                      <li key={l.id}>{l.quantity}× {l.product_name} — {brl(l.unit_price)} → <b className="text-foreground">{brl(l.new_price)}</b></li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="items-center gap-2">
          <span className="text-sm mr-auto">Total a estornar: <b>{brl(totalRefund)}</b></span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={busy || loading || !applicable.length || !finalReason}>
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Aplicar em {applicable.length} pedido(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
