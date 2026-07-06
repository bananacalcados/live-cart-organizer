import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Store, Loader2, CheckCircle, AlertTriangle, Radio } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { DbOrder } from "@/types/database";
import { Badge } from "@/components/ui/badge";
import { isVirtualSeller } from "@/lib/pos/virtualSellers";

interface SendToPOSDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: DbOrder;
}

const STORES = [
  { id: "1c08a9d8-fc12-4657-8ecf-d442f0c0e9f2", name: "Loja Pérola" },
  { id: "4ade7b44-5043-4ab1-a124-7a6ab5468e29", name: "Loja Centro" },
];

// Vendedor "Live Shopping" fixo por loja (vendedor virtual da live) — usado como
// fallback quando nenhuma vendedora real é escolhida (ex.: retirada de site).
const LIVE_SELLER_BY_STORE: Record<string, string> = {
  "1c08a9d8-fc12-4657-8ecf-d442f0c0e9f2": "bec7d0b3-a1fd-4611-a165-6cd49f185a0a",
  "4ade7b44-5043-4ab1-a124-7a6ab5468e29": "559b9848-4e76-4942-9c58-b9987c479111",
};

interface SellerOption { id: string; name: string }

export function SendToPOSDialog({ open, onOpenChange, order }: SendToPOSDialogProps) {
  const [selectedStore, setSelectedStore] = useState<string>("");
  const [isSending, setIsSending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [eventChannel, setEventChannel] = useState<string>("site");
  const [manualRouting, setManualRouting] = useState(false);
  const [storeOptions, setStoreOptions] = useState<{ id: string; name: string }[]>(STORES);
  const [sellers, setSellers] = useState<SellerOption[]>([]);
  const [selectedSeller, setSelectedSeller] = useState<string>("");
  const [loadingSellers, setLoadingSellers] = useState(false);
  const [customerData, setCustomerData] = useState<any>(null);
  const [loadingCustomer, setLoadingCustomer] = useState(false);

  const totalValue = order.products.reduce((sum, p) => sum + p.price * p.quantity, 0);
  const discountAmount = order.discount_type && order.discount_value
    ? order.discount_type === "percentage"
      ? totalValue * (order.discount_value / 100)
      : order.discount_value
    : 0;
  const finalValue = Math.max(0, totalValue - discountAmount);

  // Carrega channel do evento + ficha do cliente quando abre
  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoadingCustomer(true);
      try {
        // Busca channel do evento
        if (order.event_id) {
          const { data: ev } = await supabase
            .from("events")
            .select("channel, default_store_id")
            .eq("id", order.event_id)
            .maybeSingle();
          if (ev) {
            setEventChannel((ev as any).channel || "site");
            // Pré-seleciona loja default se evento for físico
            if ((ev as any).default_store_id && !selectedStore) {
              setSelectedStore((ev as any).default_store_id);
            }
          }
        }

        // Busca dados de cadastro mais recente do cliente (nome, CPF, email, endereço)
        if (order.customer_id) {
          const { data: reg } = await supabase
            .rpc("get_customer_last_address", { p_customer_id: order.customer_id });
          if (reg) setCustomerData(reg);
        }
      } catch (e) {
        console.warn("Erro ao carregar dados do cliente:", e);
      } finally {
        setLoadingCustomer(false);
      }
    })();
  }, [open, order.event_id, order.customer_id]);

  const isSiteChannel = eventChannel === "site";

  const handleSend = async () => {
    if (!selectedStore) {
      toast.error("Selecione uma loja");
      return;
    }

    setIsSending(true);
    try {
      const whatsapp = customerData?.whatsapp || order.customer?.whatsapp || "";
      const customerName = customerData?.full_name || order.customer?.instagram_handle || "Cliente Live";
      const cpf = customerData?.cpf || null;
      const email = customerData?.email || null;

      // 1) Upsert pos_customer (vincula/atualiza ficha)
      let posCustomerId: string | null = null;
      if (whatsapp) {
        const phoneSuffix = whatsapp.replace(/\D/g, "").slice(-8);
        // Busca pos_customer existente pelos últimos 8 dígitos
        const { data: existing } = await supabase
          .from("pos_customers")
          .select("id, whatsapp, name, cpf, email, address, address_number, complement, neighborhood, city, state, cep")
          .ilike("whatsapp", `%${phoneSuffix}`)
          .limit(1)
          .maybeSingle();

        const customerPayload: any = {
          name: customerName,
          whatsapp: whatsapp,
          cpf: cpf || existing?.cpf,
          email: email || existing?.email,
          address: customerData?.address || existing?.address,
          address_number: customerData?.address_number || existing?.address_number,
          complement: customerData?.complement || existing?.complement,
          neighborhood: customerData?.neighborhood || existing?.neighborhood,
          city: customerData?.city || existing?.city,
          state: customerData?.state || existing?.state,
          cep: customerData?.cep || existing?.cep,
        };

        if (existing) {
          await supabase.from("pos_customers").update(customerPayload).eq("id", existing.id);
          posCustomerId = existing.id;
        } else {
          const { data: created } = await supabase
            .from("pos_customers")
            .insert(customerPayload)
            .select("id")
            .single();
          posCustomerId = created?.id || null;
        }
      }

      const sellerId = LIVE_SELLER_BY_STORE[selectedStore] || null;

      const shippingAddress = customerData ? {
        full_name: customerData.full_name,
        cpf: customerData.cpf,
        email: customerData.email,
        whatsapp: whatsapp,
        cep: customerData.cep,
        address: customerData.address,
        number: customerData.address_number,
        complement: customerData.complement,
        neighborhood: customerData.neighborhood,
        city: customerData.city,
        state: customerData.state,
      } : null;

      // 2) Create the POS sale record
      const { data: sale, error: saleError } = await supabase
        .from("pos_sales")
        .insert({
          store_id: selectedStore,
          seller_id: sellerId,
          customer_id: posCustomerId,
          customer_name: customerName,
          customer_phone: whatsapp,
          shipping_address: shippingAddress,
          subtotal: totalValue,
          discount: discountAmount,
          total: finalValue,
          status: "pending_pickup",
          sale_type: "live",
          source_order_id: order.id,
          event_id: order.event_id,
          // Site = retirada na loja, NÃO conta no faturamento da loja física
          revenue_attribution: isSiteChannel ? "site_pickup_only" : "store",
          notes: `Venda da Live - ${order.customer?.instagram_handle || ""}. Pedido CRM: ${order.id.slice(0, 8)}${isSiteChannel ? " (Retirada Site)" : ""}`,
          payment_details: {
            source: "live_event",
            event_channel: eventChannel,
            customer_instagram: order.customer?.instagram_handle,
            customer_whatsapp: whatsapp,
          },
        })
        .select("id")
        .single();

      if (saleError) throw saleError;

      // 3) Insert sale items
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

      // 4) Tiny order creation is now MANUAL ONLY (via the "Enviar/Reenviar ao Tiny"
      // button in the POS). The pos_sales row was created above; no automatic Tiny push.

      // 5) Update CRM order with POS sale reference
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

  const hasFullData = customerData?.full_name && customerData?.cpf;

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

            {/* Status do cliente */}
            {loadingCustomer ? (
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Buscando ficha do cliente...
              </div>
            ) : hasFullData ? (
              <div className="rounded-lg border bg-emerald-50 dark:bg-emerald-950/20 p-2 text-xs space-y-0.5">
                <p className="font-medium text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                  <CheckCircle className="h-3 w-3" /> Ficha completa
                </p>
                <p>{customerData.full_name} • CPF: {customerData.cpf}</p>
                {customerData.address && (
                  <p className="text-muted-foreground">{customerData.address}, {customerData.address_number} - {customerData.city}/{customerData.state}</p>
                )}
              </div>
            ) : (
              <div className="rounded-lg border bg-amber-50 dark:bg-amber-950/20 p-2 text-xs flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                <span className="text-amber-700 dark:text-amber-300">
                  Cliente sem cadastro completo. Será enviado apenas com Instagram + WhatsApp.
                </span>
              </div>
            )}

            {/* Badge de canal */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Canal do evento:</span>
              {isSiteChannel ? (
                <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                  Site (não conta no faturamento da loja)
                </Badge>
              ) : (
                <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                  Loja Física
                </Badge>
              )}
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
