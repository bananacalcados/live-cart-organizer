import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RotateCcw, ShieldAlert } from "lucide-react";
import { MarkChargebackDialog } from "@/components/expedition/MarkChargebackDialog";
import { NewExchangePicker } from "./NewExchangePicker";
import { PresentialExchangePicker } from "./PresentialExchangePicker";
import { CustomerChargebackBadge } from "./CustomerChargebackBadge";
import { CustomerExchangeBadge } from "./CustomerExchangeBadge";
import type { ChargebackRecord } from "@/hooks/useCustomerChargebacks";
import type { ExchangeRecord } from "@/hooks/useExchangeRegistry";

interface Props {
  /** pos_sales.id da venda. */
  saleId: string;
  saleLabel: string;
  saleTotal?: number | null;
  sellerId?: string | null;
  sellerName?: string | null;
  customer: {
    name?: string | null;
    phone?: string | null;
    cpf?: string | null;
    email?: string | null;
    unifiedId?: string | null;
  };
  chargebacks: ChargebackRecord[];
  exchanges: ExchangeRecord[];
  /** Após criar troca/devolução ou chargeback (recarregar registros). */
  onChanged?: () => void;
}

/**
 * Selos + ações de uma venda dentro do modal do cliente (chat do PDV):
 * TROCAS E DEVOLUÇÕES (reaproveita os mesmos fluxos da aba Vendas) e MARCAR CHARGEBACK.
 */
export function CustomerOrderActions({
  saleId,
  saleLabel,
  saleTotal,
  sellerId,
  sellerName,
  customer,
  chargebacks,
  exchanges,
  onChanged,
}: Props) {
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [presentialOpen, setPresentialOpen] = useState(false);
  const [shippingOpen, setShippingOpen] = useState(false);

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" onClick={stop}>
      {exchanges.length > 0 && <CustomerExchangeBadge exchanges={exchanges} size="sm" />}
      {chargebacks.length > 0 && <CustomerChargebackBadge chargebacks={chargebacks} size="sm" />}

      <button
        type="button"
        onClick={() => setTypePickerOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border border-purple-400/50 bg-purple-500/10 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-purple-700 hover:bg-purple-500/20 transition-colors dark:text-purple-300"
        title="Abrir troca/devolução desta venda (mesmo fluxo da aba Vendas)"
      >
        <RotateCcw className="h-3 w-3" /> Trocas e Devoluções
      </button>

      {chargebacks.length === 0 && (
        <MarkChargebackDialog
          onCreated={onChanged}
          prefill={{
            source: "pos",
            pos_sale_id: saleId,
            source_order_id: saleId,
            source_order_name: saleLabel,
            customer_unified_id: customer.unifiedId || null,
            customer_name: customer.name || "",
            customer_phone: customer.phone || "",
            customer_cpf: customer.cpf || "",
            customer_email: customer.email || "",
            amount: Number(saleTotal || 0),
          }}
          trigger={
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-destructive hover:bg-destructive/15 transition-colors"
              title="Registrar chargeback nesta venda — o cliente passa a ser avisado/bloqueado em novas compras"
            >
              <ShieldAlert className="h-3 w-3" /> Marcar chargeback
            </button>
          }
        />
      )}

      {/* Sub-seletor: Presencial vs Com Envio (idêntico ao da aba Vendas) */}
      <Dialog open={typePickerOpen} onOpenChange={(o) => { if (!o) setTypePickerOpen(false); }}>
        <DialogContent className="bg-pos-black border-purple-500/40 max-w-lg" onClick={stop}>
          <DialogHeader>
            <DialogTitle className="text-pos-white text-xl">Como será essa troca?</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-pos-white/60 -mt-1">{saleLabel}</p>
          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              onClick={() => { setTypePickerOpen(false); setPresentialOpen(true); }}
              className="rounded-2xl border-2 border-emerald-400/40 bg-emerald-500/5 hover:bg-emerald-500/15 hover:border-emerald-400 p-5 flex flex-col items-center gap-3 transition-all"
            >
              <div className="h-14 w-14 rounded-full bg-emerald-500/20 flex items-center justify-center text-2xl">🏬</div>
              <p className="font-bold text-pos-white text-center">Troca Presencial</p>
              <p className="text-[11px] text-pos-white/60 text-center">Cliente na loja · finaliza tudo agora</p>
            </button>
            <button
              onClick={() => { setTypePickerOpen(false); setShippingOpen(true); }}
              className="rounded-2xl border-2 border-purple-400/40 bg-purple-500/5 hover:bg-purple-500/15 hover:border-purple-400 p-5 flex flex-col items-center gap-3 transition-all"
            >
              <div className="h-14 w-14 rounded-full bg-purple-500/20 flex items-center justify-center text-2xl">📦</div>
              <p className="font-bold text-pos-white text-center">Troca com Envio</p>
              <p className="text-[11px] text-pos-white/60 text-center">Enviar reposição para o cliente</p>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {shippingOpen && (
      <NewExchangePicker
        open={shippingOpen}
        sellerId={sellerId || undefined}
        initialSaleId={saleId}
        onCancel={() => setShippingOpen(false)}
        onDone={() => { setShippingOpen(false); onChanged?.(); }}
      />
      )}

      {presentialOpen && (
      <PresentialExchangePicker
        open={presentialOpen}
        sellerId={sellerId || undefined}
        sellerName={sellerName || undefined}
        initialSaleId={saleId}
        onCancel={() => setPresentialOpen(false)}
        onDone={() => { setPresentialOpen(false); onChanged?.(); }}
      />
      )}
    </div>
  );
}
