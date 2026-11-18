import { useCallback, useEffect, useState } from "react";
import { Gift, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listPhoneCashbacks, setSaleCashback, type PhoneCashback } from "@/lib/saleCashback";
import { voucherBrl } from "@/lib/vouchers";
import type { VoucherSaleOption } from "./POSVoucherPanel";

/** Cashback da live no modal do WhatsApp do PDV: uma consulta ao abrir e outra após abater/remover. */
export function POSCashbackPanel({ phone, sales, onChanged }: {
  phone: string; sales: VoucherSaleOption[]; onChanged?: (saleId: string, result: { total: number }) => void;
}) {
  const [list, setList] = useState<PhoneCashback[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedSale, setSelectedSale] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try { setList(await listPhoneCashbacks(phone)); }
    catch (e) { console.error("[cashback] modal PDV", e); setList([]); }
    finally { setLoading(false); }
  }, [phone]);
  useEffect(() => { void load(); }, [load]);

  const write = async (cb: PhoneCashback, saleId: string, remove: boolean) => {
    if (!saleId) { toast.error("Escolha a venda que receberá o desconto"); return; }
    setBusy(cb.id);
    try {
      const r = await setSaleCashback(saleId, remove ? null : cb.id);
      onChanged?.(saleId, r);
      toast.success(remove ? "Cashback removido e liberado." : `Cashback abatido. Novo total: ${voucherBrl(r.total)}.`);
      await load();
    } catch (e: any) { toast.error(e?.message || "Não foi possível alterar o cashback"); }
    finally { setBusy(null); }
  };

  if (!loading && !list.length) return null;
  return (
    <section className="rounded-lg border-2 border-cashback bg-cashback p-3 text-sm text-cashback-foreground space-y-2 shadow-md">
      <p className="flex items-center gap-1.5 text-base font-extrabold"><Gift className="h-5 w-5" /> Cashback disponível</p>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : list.map((cb) => {
        const reservedSale = cb.reserved_sale_id ? sales.find((s) => s.id === cb.reserved_sale_id) : null;
        const elsewhere = !!(cb.reserved_order_id || (cb.reserved_sale_id && !reservedSale));
        const saleId = selectedSale[cb.id] || (sales.length === 1 ? sales[0].id : "");
        return (
          <div key={cb.id} className="rounded-md bg-background p-2.5 text-foreground space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-2xl font-black text-cashback">{voucherBrl(cb.cashback_amount)}</span>
              <span className="rounded bg-foreground px-2 py-0.5 font-mono text-sm font-bold text-background">{cb.coupon_code}</span>
            </div>
            <p className="text-xs font-semibold">Compra mínima {voucherBrl(cb.min_purchase)} · até {new Date(cb.expires_at).toLocaleDateString("pt-BR")} · produtos fora de promoção</p>
            {reservedSale ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">Abatido em {reservedSale.label}</span>
                <Button size="sm" variant="outline" className="h-8" disabled={!!busy} onClick={() => void write(cb, reservedSale.id, true)}>
                  {busy === cb.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Remover"}
                </Button>
              </div>
            ) : elsewhere ? <p className="text-xs font-semibold">Reservado em outro pedido.</p> : sales.length ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                {sales.length > 1 && (
                  <Select value={saleId} onValueChange={(v) => setSelectedSale((o) => ({ ...o, [cb.id]: v }))}>
                    <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue placeholder="Escolha a venda" /></SelectTrigger>
                    <SelectContent>{sales.map((s) => <SelectItem key={s.id} value={s.id}>{s.label} · {voucherBrl(s.total)}</SelectItem>)}</SelectContent>
                  </Select>
                )}
                <Button size="sm" className="h-8 bg-cashback text-cashback-foreground hover:bg-cashback/90" disabled={!!busy || !saleId} onClick={() => void write(cb, saleId, false)}>
                  {busy === cb.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Abater na venda"}
                </Button>
              </div>
            ) : <p className="text-xs">Nenhuma venda em aberto. Use no botão Checkout ao montar o carrinho.</p>}
          </div>
        );
      })}
      <p className="text-xs font-medium">1 cashback por venda. Fica usado quando a venda é paga e não volta a aparecer.</p>
    </section>
  );
}
