import type { ReactNode } from "react";
import { AlertTriangle, Coins, CreditCard, Mail, MapPin, Package, Phone, ShoppingBag, Truck, User } from "lucide-react";
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
  const paidOrders = (data?.orders || []).filter((order) => order.paymentState === "paid");
  const unpaidOrders = (data?.orders || []).filter((order) => order.paymentState === "unpaid");
  const unpaidCount = unpaidOrders.length;

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
            <h3 className="text-sm font-bold">Pedidos pagos {paidOrders.length ? `(${paidOrders.length})` : ""}</h3>
          </div>
          {unpaidCount > 0 ? (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-bold text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {unpaidCount === 1
                ? "1 pedido sem pagamento confirmado"
                : `${unpaidCount} pedido(s) não pago(s) estão listados abaixo e não entram nas ações`}
            </div>
          ) : null}
          {paidOrders.length ? (
            <div className="space-y-2">
              {paidOrders.map((order) => (
                <OrderCard key={order.id} order={order} statusLabels={statusLabels} renderOrderActions={renderOrderActions} />
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">Nenhum pedido pago encontrado para este cliente.</p>
          )}

          {unpaidCount > 0 ? (
            <div className="mt-6">
              <div className="mb-3 flex items-center gap-2">
                <ShoppingBag className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-bold text-muted-foreground">Não pagos / checkout em aberto {unpaidOrders.length ? `(${unpaidOrders.length})` : ""}</h3>
              </div>
              <div className="space-y-2 opacity-90">
                {unpaidOrders.map((order) => (
                  <OrderCard key={order.id} order={order} statusLabels={statusLabels} renderOrderActions={renderOrderActions} />
                ))}
              </div>
            </div>
          ) : null}
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