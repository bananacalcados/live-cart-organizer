import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useDbOrderStore } from "@/stores/dbOrderStore";
import { MANUAL_PAYMENT_METHODS } from "@/components/MarkOrderPaidDialog";
import { MapPin, Store, CalendarDays, CheckCircle2, Loader2, ArrowLeft, Banknote } from "lucide-react";

const STORES = [
  { id: "1c08a9d8-fc12-4657-8ecf-d442f0c0e9f2", name: "Loja Pérola" },
  { id: "4ade7b44-5043-4ab1-a124-7a6ab5468e29", name: "Loja Centro" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  eventId?: string;
  alreadyPaid?: boolean;
  customerLabel?: string | null;
  total?: number;
}

type Step = "payment" | "method" | "store" | "date";

const fmt = (v?: number) =>
  typeof v === "number" ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "";

export function StorePickupWizard({
  open,
  onOpenChange,
  orderId,
  eventId,
  alreadyPaid,
  customerLabel,
  total,
}: Props) {
  const { updateOrder } = useDbOrderStore();
  const [step, setStep] = useState<Step>(alreadyPaid ? "store" : "payment");
  const [payNow, setPayNow] = useState<boolean>(!!alreadyPaid);
  const [method, setMethod] = useState("PIX");
  const [installments, setInstallments] = useState("2");
  const [storeId, setStoreId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(alreadyPaid ? "store" : "payment");
    setPayNow(!!alreadyPaid);
    setSaving(false);
  }, [open, alreadyPaid]);

  // Pré-seleciona a loja padrão do evento
  useEffect(() => {
    if (!open || !eventId || storeId) return;
    (async () => {
      const { data } = await supabase
        .from("events")
        .select("default_store_id")
        .eq("id", eventId)
        .maybeSingle();
      const def = (data as any)?.default_store_id;
      if (def && STORES.some((s) => s.id === def)) setStoreId(def);
    })();
  }, [open, eventId, storeId]);

  const selectedMethod = MANUAL_PAYMENT_METHODS.find((m) => m.value === method);
  const needsInstallments = !!selectedMethod?.installments;

  const handleConfirm = async () => {
    if (!storeId) { toast.error("Selecione a loja da retirada."); return; }
    if (!date) { toast.error("Informe a data da retirada."); return; }
    setSaving(true);
    try {
      const inst = needsInstallments ? Math.max(2, Number(installments) || 2) : 1;
      const label = needsInstallments ? `${method} ${inst}x` : method;

      const updates: Record<string, unknown> = {
        pickup_store_id: storeId,
        pickup_date: date,
        pickup_pay_at_store: !payNow,
        delivery_method: "pickup",
        stage: payNow || alreadyPaid ? "awaiting_pickup" : "awaiting_payment",
      };

      if (payNow && !alreadyPaid) {
        Object.assign(updates, {
          is_paid: true,
          paid_externally: true,
          paid_at: new Date().toISOString(),
          payment_method_label: label,
          installments: inst,
          payment_confirmed_source: "manual",
        });
      }

      await updateOrder(orderId, updates as any);

      // Roteia para o PDV da loja escolhida
      try {
        await supabase.functions.invoke("event-order-route-to-pos", { body: { order_id: orderId } });
      } catch (e) {
        console.warn("route-to-pos falhou (pode já estar roteado)", e);
      }

      // Garante loja/dados de retirada na venda + cria avisos para o PDV da loja
      const { data: ord } = await supabase
        .from("orders")
        .select("pos_sale_id")
        .eq("id", orderId)
        .maybeSingle();
      const saleId = (ord as any)?.pos_sale_id || null;

      if (saleId) {
        await supabase
          .from("pos_sales")
          .update({
            store_id: storeId,
            pickup_date: date,
            is_store_pickup: true,
            delivery_method: "Retirada na loja",
          } as any)
          .eq("id", saleId);
      }

      const alertBase = {
        store_id: storeId,
        sale_id: saleId,
        order_id: orderId,
        target_date: date,
        customer_name: customerLabel || null,
        total: total ?? null,
      };
      await supabase
        .from("pos_pickup_alerts" as any)
        .upsert(
          [
            { ...alertBase, alert_type: "created" },
            { ...alertBase, alert_type: "due_date" },
          ],
          { onConflict: "sale_id,alert_type", ignoreDuplicates: true } as any,
        );

      const storeName = STORES.find((s) => s.id === storeId)?.name || "loja";
      toast.success(`Retirada agendada em ${storeName} para ${date.split("-").reverse().join("/")}.`);
      onOpenChange(false);
    } catch (e) {
      console.error(e);
      toast.error("Não foi possível agendar a retirada.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-stage-awaiting-pickup" />
            Retirar na loja
          </DialogTitle>
          <DialogDescription>
            {customerLabel ? `${customerLabel} · ` : ""}
            {fmt(total)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {step === "payment" && (
            <div className="space-y-2">
              <Label>Como será o pagamento?</Label>
              <Button
                variant="outline"
                className="w-full justify-start gap-2 h-auto py-3"
                onClick={() => { setPayNow(true); setStep("method"); }}
              >
                <CheckCircle2 className="h-4 w-4 text-stage-paid" />
                <span className="text-left">
                  <span className="block font-semibold">Já foi pago</span>
                  <span className="block text-[11px] text-muted-foreground">Informe a forma de pagamento recebida</span>
                </span>
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start gap-2 h-auto py-3"
                onClick={() => { setPayNow(false); setStep("store"); }}
              >
                <Banknote className="h-4 w-4 text-amber-600" />
                <span className="text-left">
                  <span className="block font-semibold">Vai pagar na loja</span>
                  <span className="block text-[11px] text-muted-foreground">Pedido segue em aberto até a retirada</span>
                </span>
              </Button>
            </div>
          )}

          {step === "method" && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Forma de pagamento</Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MANUAL_PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {needsInstallments && (
                <div className="space-y-2">
                  <Label>Parcelas</Label>
                  <Select value={installments} onValueChange={setInstallments}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
                        <SelectItem key={n} value={String(n)}>{n}x</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {step === "store" && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5"><Store className="h-3.5 w-3.5" /> Em qual loja será a retirada?</Label>
              <Select value={storeId} onValueChange={setStoreId}>
                <SelectTrigger><SelectValue placeholder="Selecione a loja..." /></SelectTrigger>
                <SelectContent>
                  {STORES.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {step === "date" && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" /> Data da retirada</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="rounded-lg border bg-muted/40 p-2 text-[11px] space-y-0.5">
                <p><strong>Pagamento:</strong> {payNow ? (alreadyPaid ? "já pago" : (needsInstallments ? `${method} ${installments}x` : method)) : "na loja, no ato da retirada"}</p>
                <p><strong>Loja:</strong> {STORES.find((s) => s.id === storeId)?.name || "—"}</p>
                <p className="text-muted-foreground">A loja recebe um aviso agora e novamente no dia da retirada.</p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {step !== "payment" && !(alreadyPaid && step === "store") && (
            <Button
              variant="ghost"
              onClick={() => setStep(step === "date" ? "store" : step === "store" ? (payNow ? "method" : "payment") : "payment")}
              disabled={saving}
              className="gap-1"
            >
              <ArrowLeft className="h-4 w-4" /> Voltar
            </Button>
          )}
          {step === "method" && (
            <Button onClick={() => setStep("store")}>Continuar</Button>
          )}
          {step === "store" && (
            <Button onClick={() => setStep("date")} disabled={!storeId}>Continuar</Button>
          )}
          {step === "date" && (
            <Button onClick={handleConfirm} disabled={saving || !date} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Confirmar retirada
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
