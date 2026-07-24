import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Loader2,
  User,
  Mail,
  Phone,
  IdCard,
  MapPin,
  Truck,
  CreditCard,
  Package,
  Instagram,
  Calendar,
  Gift,
  Tag,
  Store,
  ShoppingBag,
  Copy,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { DbOrder } from "@/types/database";

interface OrderFullViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: DbOrder;
}

const fmtMoney = (v: number) => `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;

const fmtDateTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

const fmtCpf = (raw?: string | null) => {
  const d = (raw || "").replace(/\D/g, "");
  if (d.length !== 11) return raw || "—";
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
};

const fmtCep = (raw?: string | null) => {
  const d = (raw || "").replace(/\D/g, "");
  if (d.length !== 8) return raw || "—";
  return `${d.slice(0, 5)}-${d.slice(5)}`;
};

const fmtPhone = (raw?: string | null) => {
  const d = (raw || "").replace(/\D/g, "");
  const local = d.startsWith("55") ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return raw || "—";
};

function copyText(text: string, label: string) {
  navigator.clipboard
    .writeText(text)
    .then(() => toast.success(`${label} copiado`))
    .catch(() => window.prompt(`Copie ${label}:`, text));
}

function Field({
  icon: Icon,
  label,
  value,
  copyable,
}: {
  icon?: React.ElementType;
  label: string;
  value?: string | null;
  copyable?: string | null;
}) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      {Icon && <Icon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />}
      <div className="flex-1 min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-sm font-medium break-words">{value || "—"}</p>
      </div>
      {copyable && (
        <button
          type="button"
          onClick={() => copyText(copyable, label)}
          className="text-muted-foreground hover:text-foreground shrink-0"
          title={`Copiar ${label}`}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
  className,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border p-3 ${className || ""}`}>
      <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </h3>
      {children}
    </section>
  );
}

export function OrderFullViewDialog({ open, onOpenChange, order }: OrderFullViewDialogProps) {
  const [loading, setLoading] = useState(false);
  const [reg, setReg] = useState<any | null>(null);
  const [row, setRow] = useState<any | null>(null);
  const [storeName, setStoreName] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !order?.id) return;
    (async () => {
      setLoading(true);
      try {
        const [{ data: orderRow }, { data: regRow }] = await Promise.all([
          supabase.from("orders").select("*").eq("id", order.id).maybeSingle(),
          supabase
            .from("customer_registrations")
            .select("full_name,cpf,email,whatsapp,cep,address,address_number,complement,neighborhood,city,state")
            .eq("order_id", order.id)
            .maybeSingle(),
        ]);

        setRow(orderRow || null);

        if (regRow) {
          setReg(regRow);
        } else if (order.customer_id) {
          const { data: prev } = await supabase
            .rpc("get_latest_registration_by_customer", { p_customer_id: order.customer_id })
            .maybeSingle();
          setReg(prev || null);
        } else {
          setReg(null);
        }

        const storeId = (orderRow as any)?.pickup_store_id;
        if (storeId) {
          const { data: store } = await supabase
            .from("pos_stores")
            .select("name")
            .eq("id", storeId)
            .maybeSingle();
          setStoreName((store as any)?.name || null);
        } else {
          setStoreName(null);
        }
      } catch (e) {
        console.error("[OrderFullView] load error:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, order?.id, order?.customer_id]);

  const data = { ...(order as any), ...(row || {}) };
  const products: any[] = Array.isArray(data.products) ? data.products : [];

  const productsTotal = products.reduce(
    (s, p) => s + (Number(p.price) || 0) * (Number(p.quantity) || 0),
    0,
  );
  const totalItems = products.reduce((s, p) => s + (Number(p.quantity) || 0), 0);
  const discountAmount =
    data.discount_type && data.discount_value
      ? data.discount_type === "percentage"
        ? productsTotal * (Number(data.discount_value) / 100)
        : Number(data.discount_value)
      : 0;

  const si = data.shipping_info || null;
  const isPickup = data.is_pickup || si?.type === "pickup";
  const shippingCost = data.free_shipping || isPickup ? 0 : Number(data.shipping_cost ?? si?.price ?? 0);
  const total = Math.max(0, productsTotal - discountAmount + shippingCost);

  // ── Pagamento ──
  const payLabel: string = data.payment_method_label || "";
  const isCard = /cart/i.test(payLabel);
  const isPix = /pix/i.test(payLabel);
  const isBoleto = /boleto/i.test(payLabel);
  const installments = Number(data.installments || 0);
  const paymentText = payLabel
    ? isCard
      ? `Cartão de crédito — ${installments > 1 ? `${installments}x parcelado` : "1x à vista"}`
      : isPix
        ? "PIX (à vista)"
        : isBoleto
          ? "Boleto"
          : payLabel
    : "Não informado";

  const gateways: string[] = [];
  if (data.mercadopago_payment_id) gateways.push(`Mercado Pago · ${data.mercadopago_payment_id}`);
  if (data.pagarme_order_id) gateways.push(`Pagar.me · ${data.pagarme_order_id}`);
  if (data.appmax_order_id) gateways.push(`AppMax · ${data.appmax_order_id}`);
  if (data.vindi_transaction_id) gateways.push(`Vindi · ${data.vindi_transaction_id}`);

  const paymentSource =
    data.payment_confirmed_source === "gateway_webhook"
      ? "Confirmado pelo gateway (webhook)"
      : data.payment_confirmed_source
        ? `Manual (${data.payment_confirmed_source})`
        : data.paid_externally
          ? "Pago fora do checkout (manual)"
          : "—";

  const fullAddress = reg
    ? `${reg.address}, ${reg.address_number}${reg.complement ? ` - ${reg.complement}` : ""} — ${reg.neighborhood}, ${reg.city}/${reg.state} — CEP ${fmtCep(reg.cep)}`
    : "—";

  const deliveryText = isPickup
    ? `Retirada na loja${storeName ? ` — ${storeName}` : ""}`
    : si?.carrier
      ? `${si.carrier}${si.service ? ` — ${si.service}` : ""}`
      : data.delivery_method === "mototaxi"
        ? "Mototaxista"
        : data.free_shipping
          ? "Frete grátis"
          : "Envio padrão";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Pedido completo
            <Badge variant={data.is_paid || data.paid_externally ? "default" : "secondary"} className="ml-1">
              {data.is_paid || data.paid_externally ? "Pago" : "Não pago"}
            </Badge>
            <span className="text-xs font-mono text-muted-foreground">#{String(data.id).slice(0, 8)}</span>
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {/* Cliente */}
            <Section title="Cliente" icon={User}>
              <Field icon={User} label="Nome completo" value={reg?.full_name} copyable={reg?.full_name} />
              <Field
                icon={Instagram}
                label="Instagram"
                value={order.customer?.instagram_handle}
                copyable={order.customer?.instagram_handle}
              />
              <Field
                icon={Phone}
                label="WhatsApp"
                value={fmtPhone(reg?.whatsapp || order.customer?.whatsapp)}
                copyable={reg?.whatsapp || order.customer?.whatsapp}
              />
              <Field icon={IdCard} label="CPF" value={fmtCpf(reg?.cpf)} copyable={reg?.cpf} />
              <Field icon={Mail} label="E-mail" value={reg?.email} copyable={reg?.email} />
            </Section>

            {/* Endereço + entrega */}
            <Section title="Endereço e entrega" icon={MapPin}>
              <Field icon={MapPin} label="Endereço" value={fullAddress} copyable={reg ? fullAddress : undefined} />
              <Field icon={Truck} label="Forma de entrega" value={deliveryText} />
              <Field
                icon={Truck}
                label="Prazo"
                value={si?.delivery_days ? `${si.delivery_days} dia(s) úteis` : isPickup ? "Imediato (retirada)" : "—"}
              />
              <Field icon={Truck} label="Valor do frete" value={shippingCost > 0 ? fmtMoney(shippingCost) : "Grátis"} />
              {isPickup && storeName && <Field icon={Store} label="Loja de retirada" value={storeName} />}
            </Section>

            {/* Produtos */}
            <Section title={`Produtos (${totalItems} ${totalItems === 1 ? "item" : "itens"})`} icon={ShoppingBag} className="lg:col-span-2">
              {products.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">Nenhum produto no pedido.</p>
              ) : (
                <div className="space-y-2">
                  {products.map((p, i) => (
                    <div key={p.id || i} className="flex items-center gap-3 rounded-md bg-secondary/40 p-2">
                      {p.image && (
                        <img src={p.image} alt={p.title} className="h-12 w-12 rounded object-cover shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{p.title}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {p.variant || "—"}
                          {p.sku ? ` · SKU ${p.sku}` : ""}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-medium">
                          {p.quantity}x {fmtMoney(Number(p.price) || 0)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {fmtMoney((Number(p.price) || 0) * (Number(p.quantity) || 0))}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Valores */}
            <Section title="Valores" icon={Tag}>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal dos produtos</span>
                  <span>{fmtMoney(productsTotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Desconto</span>
                  <span className={discountAmount > 0 ? "text-emerald-600" : ""}>
                    {discountAmount > 0
                      ? `- ${fmtMoney(discountAmount)}${data.discount_type === "percentage" ? ` (${data.discount_value}%)` : ""}`
                      : "Sem desconto"}
                  </span>
                </div>
                {data.coupon_code && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cupom</span>
                    <span className="font-mono">{data.coupon_code}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Frete</span>
                  <span>{shippingCost > 0 ? `+ ${fmtMoney(shippingCost)}` : "Grátis"}</span>
                </div>
                <Separator className="my-1" />
                <div className="flex justify-between text-base font-bold">
                  <span>Total</span>
                  <span className="text-primary">{fmtMoney(total)}</span>
                </div>
                {data.has_gift && (
                  <p className="flex items-center gap-1 text-xs text-stage-contacted pt-1">
                    <Gift className="h-3.5 w-3.5" /> Pedido com brinde
                  </p>
                )}
              </div>
            </Section>

            {/* Pagamento */}
            <Section title="Pagamento" icon={CreditCard}>
              <Field icon={CreditCard} label="Forma de pagamento" value={paymentText} />
              <div className="flex flex-wrap gap-1 py-1">
                {isPix && <Badge variant="secondary" className="text-[10px]">PIX</Badge>}
                {isCard && <Badge variant="secondary" className="text-[10px]">Cartão</Badge>}
                {isBoleto && <Badge variant="secondary" className="text-[10px]">Boleto</Badge>}
                {isCard && installments > 1 && (
                  <Badge variant="outline" className="text-[10px]">Parcelado {installments}x</Badge>
                )}
                {isCard && installments <= 1 && (
                  <Badge variant="outline" className="text-[10px]">À vista</Badge>
                )}
              </div>
              <Field
                icon={CreditCard}
                label="Gateway / transação"
                value={gateways.length ? gateways.join(" | ") : "Nenhuma transação vinculada"}
                copyable={gateways.length ? gateways.join(" | ") : undefined}
              />
              <Field icon={CreditCard} label="Origem da confirmação" value={paymentSource} />
              <Field icon={Calendar} label="Pago em" value={fmtDateTime(data.paid_at)} />
            </Section>

            {/* Datas e status */}
            <Section title="Datas e status" icon={Calendar} className="lg:col-span-2">
              <div className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-4">
                <Field icon={Calendar} label="Pedido criado em" value={fmtDateTime(data.created_at)} />
                <Field icon={Calendar} label="Checkout iniciado em" value={fmtDateTime(data.checkout_started_at)} />
                <Field icon={Calendar} label="Última atualização" value={fmtDateTime(data.updated_at)} />
                <Field icon={Package} label="Etapa atual" value={data.stage} />
                <Field
                  icon={Store}
                  label="Venda no PDV"
                  value={data.pos_sale_id ? `Enviado (${String(data.pos_sale_id).slice(0, 8)})` : "Não enviado"}
                />
                <Field icon={Tag} label="Elegível a prêmio" value={data.eligible_for_prize ? "Sim" : "Não"} />
                <Field icon={Package} label="Link do carrinho" value={data.cart_link} copyable={data.cart_link} />
                <Field icon={Package} label="ID do pedido" value={data.id} copyable={data.id} />
              </div>
              {data.notes && (
                <>
                  <Separator className="my-2" />
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Observações</p>
                  <p className="text-sm italic">"{data.notes}"</p>
                </>
              )}
            </Section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
