import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  User,
  Mail,
  Phone,
  IdCard,
  MapPin,
  Truck,
  CreditCard,
  Copy,
  Package,
  ShieldCheck,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface OrderDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  fallbackWhatsapp?: string;
  fallbackInstagram?: string;
}

interface Registration {
  full_name: string;
  cpf: string;
  email: string;
  whatsapp: string;
  cep: string;
  address: string;
  address_number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
}

interface ShippingInfo {
  carrier?: string;
  service?: string;
  delivery_days?: number | null;
  price?: number;
  type?: string;
}

interface OrderRow {
  id: string;
  products: any[];
  shipping_cost: number | null;
  free_shipping: boolean | null;
  is_pickup: boolean | null;
  pickup_store_id: string | null;
  shipping_info: ShippingInfo | null;
  payment_method_label: string | null;
  installments: number | null;
  discount_type: string | null;
  discount_value: number | null;
}

const fmtMoney = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

const fmtCpf = (raw: string) => {
  const d = (raw || "").replace(/\D/g, "");
  if (d.length !== 11) return raw || "—";
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
};

const fmtCep = (raw: string) => {
  const d = (raw || "").replace(/\D/g, "");
  if (d.length !== 8) return raw || "—";
  return `${d.slice(0, 5)}-${d.slice(5)}`;
};

const fmtPhone = (raw: string) => {
  const d = (raw || "").replace(/\D/g, "");
  const local = d.startsWith("55") ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return raw || "—";
};

function copy(text: string, label: string) {
  navigator.clipboard
    .writeText(text)
    .then(() => toast.success(`${label} copiado`))
    .catch(() => window.prompt(`Copie ${label}:`, text));
}

function Row({
  icon: Icon,
  label,
  value,
  copyable,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  copyable?: string;
}) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <Icon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-sm font-medium break-words">{value || "—"}</p>
      </div>
      {copyable && value && value !== "—" && (
        <button
          type="button"
          onClick={() => copy(copyable, label)}
          className="text-muted-foreground hover:text-foreground shrink-0"
          title={`Copiar ${label}`}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export function OrderDetailsDialog({
  open,
  onOpenChange,
  orderId,
  fallbackWhatsapp,
  fallbackInstagram,
}: OrderDetailsDialogProps) {
  const [loading, setLoading] = useState(false);
  const [reg, setReg] = useState<Registration | null>(null);
  const [order, setOrder] = useState<OrderRow | null>(null);

  useEffect(() => {
    if (!open || !orderId) return;
    (async () => {
      setLoading(true);
      try {
        const [{ data: orderRow }, { data: regRow }] = await Promise.all([
          supabase
            .from("orders")
            .select(
              "id,products,shipping_cost,free_shipping,is_pickup,pickup_store_id,shipping_info,payment_method_label,installments,discount_type,discount_value,customer_id",
            )
            .eq("id", orderId)
            .maybeSingle(),
          supabase
            .from("customer_registrations")
            .select(
              "full_name,cpf,email,whatsapp,cep,address,address_number,complement,neighborhood,city,state",
            )
            .eq("order_id", orderId)
            .maybeSingle(),
        ]);

        setOrder(orderRow as unknown as OrderRow);

        if (regRow) {
          setReg(regRow as unknown as Registration);
        } else if ((orderRow as any)?.customer_id) {
          // Fallback: última ficha do cliente
          const { data: prev } = await supabase
            .rpc("get_latest_registration_by_customer", {
              p_customer_id: (orderRow as any).customer_id,
            })
            .maybeSingle();
          if (prev) setReg(prev as unknown as Registration);
          else setReg(null);
        } else {
          setReg(null);
        }
      } catch (e) {
        console.error("[OrderDetails] load error:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, orderId]);

  // ── Payment ──
  const payLabel = order?.payment_method_label || "";
  const isCard = /cart/i.test(payLabel);
  const isPix = /pix/i.test(payLabel);
  const paymentText = payLabel
    ? isCard
      ? `Cartão de Crédito${order?.installments && order.installments > 1 ? ` — ${order.installments}x` : " — 1x"}`
      : isPix
        ? "PIX"
        : payLabel
    : "—";

  // ── Shipping ──
  const si = order?.shipping_info || null;
  const isPickup = order?.is_pickup || si?.type === "pickup";
  let shippingText = "—";
  let deliveryText = "—";
  if (isPickup) {
    shippingText = "Retirada na Loja";
    deliveryText = "Retirada na Loja";
  } else if (si?.carrier) {
    shippingText = `${si.carrier}${si.service ? ` — ${si.service}` : ""}`;
    if (si.delivery_days && si.delivery_days > 0) {
      deliveryText = `${si.delivery_days} dia${si.delivery_days > 1 ? "s" : ""} úteis`;
    } else if (si.type === "pickup") {
      deliveryText = "Retirada";
    } else {
      deliveryText = "Prazo não informado";
    }
  } else if (order?.free_shipping) {
    shippingText = "Frete Grátis";
  }

  const shippingCost = order?.free_shipping || isPickup ? 0 : Number(order?.shipping_cost || si?.price || 0);

  // ── Total ──
  const productsTotal = (order?.products || []).reduce(
    (s, p: any) => s + (Number(p.price) || 0) * (Number(p.quantity) || 0),
    0,
  );
  const discountAmount =
    order?.discount_type && order?.discount_value
      ? order.discount_type === "percentage"
        ? productsTotal * (Number(order.discount_value) / 100)
        : Number(order.discount_value)
      : 0;
  const total = Math.max(0, productsTotal - discountAmount + shippingCost);

  const fullAddress = reg
    ? `${reg.address}, ${reg.address_number}${reg.complement ? ` - ${reg.complement}` : ""} — ${reg.neighborhood}, ${reg.city}/${reg.state} — CEP ${fmtCep(reg.cep)}`
    : "—";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Detalhes do Pedido
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4 py-1">
            {/* Cliente */}
            <section className="rounded-lg border p-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">
                Cliente
              </h3>
              <Row icon={User} label="Nome" value={reg?.full_name || fallbackInstagram || "—"} copyable={reg?.full_name} />
              <Row icon={IdCard} label="CPF" value={fmtCpf(reg?.cpf || "")} copyable={reg?.cpf} />
              <Row icon={Mail} label="Email" value={reg?.email || "—"} copyable={reg?.email} />
              <Row
                icon={Phone}
                label="WhatsApp"
                value={fmtPhone(reg?.whatsapp || fallbackWhatsapp || "")}
                copyable={reg?.whatsapp || fallbackWhatsapp}
              />
            </section>

            {/* Endereço */}
            <section className="rounded-lg border p-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">
                Endereço de Entrega
              </h3>
              <Row icon={MapPin} label="Endereço" value={fullAddress} copyable={reg ? fullAddress : undefined} />
            </section>

            {/* Envio */}
            <section className="rounded-lg border p-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">
                Envio
              </h3>
              <Row icon={Truck} label="Meio de Envio / Transportadora" value={shippingText} />
              <Row icon={Truck} label="Prazo de Envio" value={deliveryText} />
              <Row icon={Truck} label="Valor do Frete" value={shippingCost > 0 ? fmtMoney(shippingCost) : "Grátis"} />
            </section>

            {/* Pagamento */}
            <section className="rounded-lg border p-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">
                Pagamento
              </h3>
              <div className="flex items-center gap-2 py-1.5">
                <CreditCard className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Forma de Pagamento</p>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{paymentText}</p>
                    {isPix && <Badge variant="secondary" className="text-[10px]">PIX</Badge>}
                    {isCard && <Badge variant="secondary" className="text-[10px]">Cartão</Badge>}
                  </div>
                </div>
              </div>
              <div className="mt-1 border-t pt-2 flex items-center justify-between">
                <span className="text-sm font-semibold">Total do Pedido</span>
                <span className="text-base font-bold text-primary">{fmtMoney(total)}</span>
              </div>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
