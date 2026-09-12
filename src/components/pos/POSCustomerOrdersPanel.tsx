import type { ReactNode } from "react";
import { Coins, CreditCard, Mail, MapPin, Package, Phone, ShoppingBag, Truck, User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

export interface POSCustomerOrder {
  id: string;
  orderName?: string;
  status?: string;
  trackingCode?: string;
  totalPrice?: number;
  createdAt?: string;
  storeName?: string;
  channelLabel?: string;
  modality?: "Presencial" | "Online";
  kind?: "pos_sale" | "expedition";
  /** "paid" = pagamento confirmado, "unpaid" = sem pagamento (checkout/pedido em aberto) */
  paymentState?: "paid" | "unpaid" | "unknown";
  shipped?: boolean;
  items?: { name: string; variant?: string; size?: string; quantity?: number }[];
}

export interface POSCustomerPanelData {
  name?: string;
  instagram?: string;
  tags?: string[];
  cpf?: string;
  address?: string;
  email?: string;
  cashback?: {
    totalAvailable: number;
    count: number;
    couponCode: string;
    amount: number;
    minPurchase: number;
    generatedAt: string;
    expiresAt: string;
  };
  orders: POSCustomerOrder[];
}

interface Props {
  phone: string;
  customerName?: string;
  photoUrl?: string;
  data: POSCustomerPanelData | null;
  statusLabels: Record<string, string>;
  riskBadges?: ReactNode;
  liveOrderPanel?: ReactNode;
  renderOrderActions: (order: POSCustomerOrder) => ReactNode;
}

const initials = (name?: string) =>
  name ? name.split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase() : "?";

export function POSCustomerOrdersPanel({
  phone,
  customerName,
  photoUrl,
  data,
  statusLabels,
  riskBadges,
  liveOrderPanel,
  renderOrderActions,
}: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="shrink-0 border-b bg-primary/5 px-4 py-3">
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10">
            {photoUrl ? <AvatarImage src={photoUrl} /> : null}
            <AvatarFallback className="bg-primary/15 font-bold text-primary">
              {initials(customerName || data?.name || phone)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold">{customerName || data?.name || "Cliente"}</p>
            <p className="truncate text-xs text-muted-foreground">{data?.instagram ? `@${data.instagram}` : phone}</p>
          </div>
          {riskBadges}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {liveOrderPanel}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Info icon={<Phone className="h-4 w-4" />} label="WhatsApp" value={phone} />
          <Info icon={<CreditCard className="h-4 w-4" />} label="CPF" value={data?.cpf || "Não informado"} />
          {data?.email ? <Info icon={<Mail className="h-4 w-4" />} label="E-mail" value={data.email} /> : null}
          <Info className="sm:col-span-2" icon={<MapPin className="h-4 w-4" />} label="Endereço" value={data?.address || "Não informado"} />
        </div>

        {data?.cashback && data.cashback.totalAvailable > 0 ? (
          <div className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold text-emerald-700 dark:text-emerald-400">
                <Coins className="h-4 w-4" /> Cashback disponível
              </div>
              <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                R$ {data.cashback.totalAvailable.toFixed(2).replace(".", ",")}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Detail label="Código" value={data.cashback.couponCode} mono />
              <Detail label="Compra mínima" value={`R$ ${data.cashback.minPurchase.toFixed(2).replace(".", ",")}`} />
              <Detail label="Gerado em" value={new Date(data.cashback.generatedAt).toLocaleDateString("pt-BR")} />
              <Detail label="Válido até" value={new Date(data.cashback.expiresAt).toLocaleDateString("pt-BR")} />
            </div>
          </div>
        ) : null}

        {data?.tags?.length ? (
          <div className="flex flex-wrap gap-1.5">
            {data.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
          </div>
        ) : null}

        <section>
          <div className="mb-3 flex items-center gap-2">
            <ShoppingBag className="h-4 w-4 text-pos-orange" />
            <h3 className="text-sm font-bold">Pedidos {data?.orders.length ? `(${data.orders.length})` : ""}</h3>
          </div>
          {unpaidCount > 0 ? (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-bold text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {unpaidCount === 1
                ? "1 pedido sem pagamento confirmado"
                : `${unpaidCount} pedidos sem pagamento confirmado`}
            </div>
          ) : null}
          {data?.orders.length ? (
            <div className="space-y-2">
              {data.orders.map((order) => (
                <div
                  key={order.id}
                  className={`rounded-lg border bg-card p-3 shadow-sm ${order.paymentState === "unpaid" ? "border-destructive/40 bg-destructive/5" : ""}`}
                >
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-pos-orange/15 text-pos-orange">
                      <Package className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-bold">{order.orderName || "—"}</span>
                        {order.paymentState === "unpaid" ? (
                          <Badge className="bg-destructive text-[10px] font-bold text-destructive-foreground hover:bg-destructive">NÃO PAGO</Badge>
                        ) : order.paymentState === "paid" ? (
                          <Badge className="bg-emerald-600 text-[10px] font-bold text-white hover:bg-emerald-600">PAGO</Badge>
                        ) : null}
                        <Badge variant="outline" className="text-[10px]">{statusLabels[order.status || ""] || order.status}</Badge>
                        {order.modality ? <Badge variant="secondary" className="text-[10px]">{order.modality}</Badge> : null}
                        {order.paymentState === "unpaid" ? (
                          <Badge variant="outline" className="border-destructive/40 text-[10px] text-destructive">
                            {order.shipped ? "Enviado sem pagamento" : "Não enviado"}
                          </Badge>
                        ) : null}
                      </div>
                      {order.createdAt ? <p className="text-xs text-muted-foreground">{new Date(order.createdAt).toLocaleString("pt-BR")}{order.storeName ? ` · ${order.storeName}` : ""}</p> : null}
                      {order.items?.length ? (
                        <ul className="space-y-0.5">
                          {order.items.map((item, index) => (
                            <li key={index} className="flex items-start gap-1 text-xs text-foreground/80">
                              <span className="text-pos-orange">•</span>
                              <span>{item.quantity && item.quantity > 1 ? `${item.quantity}x ` : ""}{item.name}{item.variant ? ` — ${item.variant}` : ""}{item.size ? ` (${item.size})` : ""}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {order.trackingCode ? <p className="flex items-center gap-1 text-xs text-muted-foreground"><Truck className="h-3 w-3" />{order.trackingCode}</p> : null}
                      {order.paymentState === "unpaid" ? (
                        <p className="text-[11px] font-semibold text-destructive">
                          Sem pagamento confirmado — trocas, devoluções e chargeback indisponíveis.
                        </p>
                      ) : (
                        renderOrderActions(order)
                      )}
                    </div>
                    {order.totalPrice != null ? (
                      <span className={`whitespace-nowrap font-bold ${order.paymentState === "unpaid" ? "text-muted-foreground line-through" : "text-emerald-600"}`}>
                        R$ {order.totalPrice.toFixed(2)}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">Nenhum pedido encontrado para este cliente.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function Info({ icon, label, value, className }: { icon: ReactNode; label: string; value: string; className?: string }) {
  return (
    <div className={`flex items-start gap-3 rounded-lg border bg-muted/30 p-3 ${className || ""}`}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">{icon}</span>
      <div className="min-w-0"><p className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</p><p className="break-words text-sm font-semibold">{value}</p></div>
    </div>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return <div><p className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</p><p className={mono ? "break-all font-mono font-bold" : "font-semibold"}>{value}</p></div>;
}