import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Store, Loader2, CheckCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { DbOrder } from "@/types/database";

interface SendToPOSDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: DbOrder;
}

const STORES = [
  { id: "1c08a9d8-fc12-4657-8ecf-d442f0c0e9f2", name: "Loja Pérola" },
  { id: "4ade7b44-5043-4ab1-a124-7a6ab5468e29", name: "Loja Centro" },
];

export function SendToPOSDialog({ open, onOpenChange, order }: SendToPOSDialogProps) {
  const [selectedStore, setSelectedStore] = useState<string>("");
  const [isSending, setIsSending] = useState(false);
  const [success, setSuccess] = useState(false);

  const totalValue = order.products.reduce((sum, p) => sum + p.price * p.quantity, 0);
  const discountAmount = order.discount_type && order.discount_value
    ? order.discount_type === "percentage"
      ? totalValue * (order.discount_value / 100)
      : order.discount_value
    : 0;
  const finalValue = Math.max(0, totalValue - discountAmount);

  const handleSend = async () => {
    if (!selectedStore) {
      toast.error("Selecione uma loja");
      return;
    }

    setIsSending(true);
    try {
      // Create the POS sale record with status 'pending_pickup' (awaiting customer pickup & payment)
      const { data: sale, error: saleError } = await supabase
        .from("pos_sales")
        .insert({
          store_id: selectedStore,
          subtotal: totalValue,
          discount: discountAmount,
          total: finalValue,
          status: "pending_pickup",
          source_order_id: order.id,
          notes: `Retirada na loja - Live ${order.customer?.instagram_handle || ""}. Pedido CRM: ${order.id.slice(0, 8)}`,
          payment_details: {
            source: "live_event",
            customer_instagram: order.customer?.instagram_handle,
            customer_whatsapp: order.customer?.whatsapp,
          },
        })
        .select("id")
        .single();

      if (saleError) throw saleError;

      // Insert sale items
      const items = order.products.map((p) => ({
        sale_id: sale.id,
        product_name: p.title,
        variant_name: p.variant,
        sku: p.sku || null,
        unit_price: p.price,
        quantity: p.quantity,
        total_price: p.price * p.quantity,
      }));

      const { error: itemsError } = await supabase
        .from("pos_sale_items")
        .insert(items);

      if (itemsError) throw itemsError;

      // Update the CRM order with the POS sale reference
      await supabase
        .from("orders")
        .update({ pos_sale_id: sale.id })
        .eq("id", order.id);

      setSuccess(true);
      toast.success(`Pedido enviado para ${STORES.find(s => s.id === selectedStore)?.name}!`);
      
      setTimeout(() => {
        setSuccess(false);
        setSelectedStore("");
        onOpenChange(false);
      }, 1500);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Erro ao enviar ao PDV";
      toast.error(msg);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => {
      if (!isSending) {
        setSuccess(false);
        setSelectedStore("");
        onOpenChange(v);
      }
    }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Store className="h-5 w-5" />
            Enviar ao PDV - Retirada na Loja
          </DialogTitle>
        </DialogHeader>

        {success ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle className="h-12 w-12 text-stage-paid" />
            <p className="text-sm font-medium">Pedido enviado com sucesso!</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-secondary/50 rounded-lg p-3 space-y-1">
              <p className="text-sm font-medium">{order.customer?.instagram_handle}</p>
              <p className="text-xs text-muted-foreground">
                {order.products.length} {order.products.length === 1 ? "item" : "itens"}
              </p>
              <div className="space-y-0.5">
                {order.products.map((p) => (
                  <p key={p.id} className="text-xs text-muted-foreground">
                    • {p.quantity}x {p.title} {p.variant ? `(${p.variant})` : ""} - R$ {(p.price * p.quantity).toFixed(2)}
                  </p>
                ))}
              </div>
              {discountAmount > 0 && (
                <p className="text-xs text-stage-contacted">Desconto: -R$ {discountAmount.toFixed(2)}</p>
              )}
              <p className="text-sm font-bold text-accent mt-1">Total: R$ {finalValue.toFixed(2)}</p>
            </div>

            <div className="space-y-2">
              <Label>Loja para retirada</Label>
              <Select value={selectedStore} onValueChange={setSelectedStore}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a loja..." />
                </SelectTrigger>
                <SelectContent>
                  {STORES.map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {!success && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSending}>
              Cancelar
            </Button>
            <Button onClick={handleSend} disabled={isSending || !selectedStore}>
              {isSending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Enviando...</>
              ) : (
                <><Store className="h-4 w-4" /> Enviar ao PDV</>
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
