import { useCallback, useEffect, useState } from "react";
import { Loader2, Ticket } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listAvailableVouchers, setTargetVoucher, voucherBrl, type AvailableVoucher, type VoucherWriteResult } from "@/lib/vouchers";

export type VoucherSaleOption = { id: string; label: string; total: number };

/** Cartão único do modal do PDV: evita uma consulta de voucher por venda exibida. */
export function POSVoucherPanel({ phone, sales, onChanged }: {
  phone: string;
  sales: VoucherSaleOption[];
  onChanged?: (saleId: string, result: VoucherWriteResult) => void;
}) {
  const [list, setList] = useState<AvailableVoucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedSale, setSelectedSale] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setList(await listAvailableVouchers({ phone }));
    } catch (e: any) {
      console.error("[voucher] consulta do modal PDV", e);
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [phone]);

  useEffect(() => { void load(); }, [load]);

  const write = async (voucher: AvailableVoucher, saleId: string, remove: boolean) => {
    if (!saleId) { toast.error("Escolha a venda que receberá o desconto"); return; }
    setBusy(voucher.id);
    try {
      const result = await setTargetVoucher({ saleId }, remove ? null : voucher.id);
      onChanged?.(saleId, result);
      toast.success(remove ? "Voucher removido e liberado para uso." : `Voucher abatido. Novo total: ${voucherBrl(result.total)}.`);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível alterar o voucher");
    } finally {
      setBusy(null);
    }
  };

  if (!loading && !list.length) return null;

  return (
    <section className="rounded-lg border-2 border-accent bg-accent p-3 text-sm text-accent-foreground space-y-2 shadow-md">
      <p className="flex items-center gap-1.5 text-base font-extrabold"><Ticket className="h-5 w-5" /> Voucher de troca disponível</p>
      {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : list.map((voucher) => {
        const reservedSale = voucher.reserved_sale_id ? sales.find((s) => s.id === voucher.reserved_sale_id) : null;
        const reservedElsewhere = !!(voucher.reserved_order_id || (voucher.reserved_sale_id && !reservedSale));
        const saleId = selectedSale[voucher.id] || (sales.length === 1 ? sales[0].id : "");
        return (
          <div key={voucher.id} className="rounded-md bg-background p-2.5 text-foreground space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-2xl font-black text-accent">{voucherBrl(voucher.saldo)}</span>
              <span className="rounded bg-foreground px-2 py-0.5 font-mono text-sm font-bold text-background">{voucher.codigo}</span>
            </div>
            <div className="text-xs font-semibold">
              <span>{voucher.validade ? `até ${new Date(`${voucher.validade}T12:00:00`).toLocaleDateString("pt-BR")}` : "sem validade"}</span>
            </div>
            {reservedSale ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Abatido em {reservedSale.label}</span>
                <Button size="sm" variant="outline" className="h-7" disabled={!!busy} onClick={() => void write(voucher, reservedSale.id, true)}>
                  {busy === voucher.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Remover"}
                </Button>
              </div>
            ) : reservedElsewhere ? (
              <p className="text-muted-foreground">Reservado em outro pedido.</p>
            ) : sales.length ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                {sales.length > 1 && (
                  <Select value={saleId} onValueChange={(value) => setSelectedSale((old) => ({ ...old, [voucher.id]: value }))}>
                    <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue placeholder="Escolha a venda" /></SelectTrigger>
                    <SelectContent>{sales.map((sale) => <SelectItem key={sale.id} value={sale.id}>{sale.label} · {voucherBrl(sale.total)}</SelectItem>)}</SelectContent>
                  </Select>
                )}
                <Button size="sm" className="h-8" disabled={!!busy || !saleId} onClick={() => void write(voucher, saleId, false)}>
                  {busy === voucher.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Abater na venda"}
                </Button>
              </div>
            ) : <p className="text-muted-foreground">Nenhuma venda em aberto para receber o desconto.</p>}
          </div>
        );
      })}
      <p className="text-xs font-medium">A baixa acontece quando a venda é paga. Depois disso o voucher não fica disponível novamente.</p>
    </section>
  );
}
