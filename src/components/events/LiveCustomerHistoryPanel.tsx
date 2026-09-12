import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { POSCustomerOrdersPanel, type POSCustomerOrder, type POSCustomerPanelData } from "@/components/pos/POSCustomerOrdersPanel";
import { CustomerOrderActions } from "@/components/pos/CustomerOrderActions";
import { CustomerChargebackBadge } from "@/components/pos/CustomerChargebackBadge";
import { CustomerExchangeBadge } from "@/components/pos/CustomerExchangeBadge";
import { useChargebackRegistry } from "@/hooks/useChargebackRegistry";
import { invalidateExchangeRegistry, useExchangeRegistry } from "@/hooks/useExchangeRegistry";
import { getOrderFinalValue } from "@/lib/orderTotal";
import { isSalePaid } from "@/lib/salePaymentState";
import type { DbOrder } from "@/types/database";

interface Props {
  order: DbOrder;
  fallbackPhone?: string;
  fallbackInstagram?: string;
}

const statusLabels: Record<string, string> = {
  pending: "Pendente",
  picking: "Separando",
  packing: "Embalando",
  ready_to_ship: "Pronto p/ envio",
  shipped: "Enviado",
  delivered: "Entregue",
  cancelled: "Cancelado",
  canceled: "Cancelado",
  paid: "Pago",
  completed: "Concluído",
  refunded: "Estornado",
  awaiting_payment: "Aguardando pagamento",
  cart: "Pedido aberto",
  new: "Pedido aberto",
  online_pending: "Checkout não finalizado",
};

const cleanHandle = (value?: string | null) => String(value || "").replace(/^@/, "").trim().toLowerCase();
const cleanValue = (value?: unknown) => {
  const text = String(value ?? "").trim();
  return !text || text === "Pendente" || text === "00000000" || text === "0" ? undefined : text;
};

export function LiveCustomerHistoryPanel({ order, fallbackPhone, fallbackInstagram }: Props) {
  const phone = order.customer?.whatsapp || fallbackPhone || "";
  const handle = cleanHandle(order.customer?.instagram_handle || fallbackInstagram);
  const suffix = phone.replace(/\D/g, "").slice(-8);
  const [data, setData] = useState<POSCustomerPanelData | null>(null);
  const [unifiedId, setUnifiedId] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const { byPhone: cbByPhone, byCpf: cbByCpf, byHandle: cbByHandle, refresh: refreshChargebacks } = useChargebackRegistry();
  const { byPhone: exByPhone, byCpf: exByCpf, byHandle: exByHandle, bySale: exBySale, refresh: refreshExchanges } = useExchangeRegistry();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const customerFilters: string[] = [];
        if (order.customer_id) customerFilters.push(`id.eq.${order.customer_id}`);
        if (handle) customerFilters.push(`instagram_handle.ilike.${handle}`);
        if (suffix) customerFilters.push(`whatsapp.ilike.%${suffix}%`);

        const [customerRes, posCustomerRes, unifiedRes, expeditionRes, posSalesRes] = await Promise.all([
          customerFilters.length
            ? supabase.from("customers").select("id,instagram_handle,whatsapp,full_name,tags").or(customerFilters.join(",")).limit(10)
            : Promise.resolve({ data: [] as any[] }),
          suffix
            ? supabase.from("pos_customers").select("name,whatsapp,email,cpf,address,address_number,neighborhood,city,state,cep,complement").or(`whatsapp.ilike.%${suffix}%`).limit(1).maybeSingle()
            : Promise.resolve({ data: null as any }),
          suffix
            ? supabase.from("crm_customers_v").select("id,first_name,last_name,email,instagram_handle").eq("phone_suffix8", suffix).limit(1).maybeSingle()
            : Promise.resolve({ data: null as any }),
          suffix
            ? supabase.from("expedition_orders").select("id,shopify_order_name,expedition_status,freight_tracking_code,total_price,shopify_created_at,customer_cpf,shipping_address").or(`customer_phone.ilike.%${suffix}%`).order("shopify_created_at", { ascending: false }).limit(10)
            : Promise.resolve({ data: [] as any[] }),
          suffix
            ? supabase.from("pos_sales").select("id,sale_type,status,total,tracking_code,tiny_order_number,nfce_number,invoice_number,customer_cpf,created_at,store_id,paid_at,shipped_at").eq("phone_suffix8", suffix).order("created_at", { ascending: false }).limit(20)
            : Promise.resolve({ data: [] as any[] }),
        ]);

        const customers = (customerRes.data || []) as any[];
        const customerIds = Array.from(new Set([order.customer_id, ...customers.map((item) => item.id)].filter(Boolean))) as string[];
        const liveOrdersRes = customerIds.length
          ? await supabase.from("orders").select("*,customer:customers(*)").in("customer_id", customerIds).order("created_at", { ascending: false }).limit(30)
          : { data: [order] as DbOrder[] };
        const liveOrders = ((liveOrdersRes.data || []) as unknown as DbOrder[]);
        if (!liveOrders.some((item) => item.id === order.id)) liveOrders.unshift(order);
        const liveIds = liveOrders.map((item) => item.id);
        const registrationsRes = liveIds.length
          ? await supabase.from("customer_registrations").select("order_id,full_name,cpf,email,whatsapp,cep,address,address_number,complement,neighborhood,city,state").in("order_id", liveIds)
          : { data: [] as any[] };
        const registrations = (registrationsRes.data || []) as any[];
        const registration = registrations.find((item) => item.order_id === order.id) || registrations[0];
        const posCustomer = posCustomerRes.data as any;
        const unified = unifiedRes.data as any;
        const expedition = (expeditionRes.data || []) as any[];
        const posSales = (posSalesRes.data || []) as any[];

        const saleIds = posSales.map((item) => item.id);
        const storeIds = Array.from(new Set(posSales.map((item) => item.store_id).filter(Boolean))) as string[];
        const [storesRes, itemsRes, cashbackRes] = await Promise.all([
          storeIds.length ? supabase.from("pos_stores").select("id,name").in("id", storeIds) : Promise.resolve({ data: [] as any[] }),
          saleIds.length ? supabase.from("pos_sale_items").select("sale_id,product_name,variant_name,size,quantity").in("sale_id", saleIds) : Promise.resolve({ data: [] as any[] }),
          phone ? supabase.rpc("lookup_cashback_by_phones" as any, { p_phones: [phone] }) : Promise.resolve({ data: [] as any[] }),
        ]);
        const stores = new Map((storesRes.data || []).map((item: any) => [item.id, item.name]));
        const saleItems = new Map<string, POSCustomerOrder["items"]>();
        for (const item of (itemsRes.data || []) as any[]) {
          const list = saleItems.get(item.sale_id) || [];
          list.push({ name: item.product_name || "Produto", variant: item.variant_name || undefined, size: item.size || undefined, quantity: item.quantity || undefined });
          saleItems.set(item.sale_id, list);
        }

        const liveHistory: POSCustomerOrder[] = liveOrders.map((item) => ({
          id: item.id,
          orderName: "Pedido da Live",
          status: item.is_paid || item.paid_externally ? "paid" : item.stage || "cart",
          totalPrice: getOrderFinalValue(item),
          createdAt: item.created_at,
          channelLabel: "Live",
          modality: "Online",
          paymentState: item.is_paid || item.paid_externally ? "paid" : "unpaid",
          items: (item.products || []).map((product) => ({ name: product.title || "Produto", variant: product.variant || undefined, quantity: product.quantity })),
        }));
        const salesHistory: POSCustomerOrder[] = posSales.map((sale) => ({
          id: sale.id,
          orderName: `${sale.sale_type === "live" ? "Live" : sale.sale_type === "pos" ? "PDV" : "Online"}${sale.tiny_order_number || sale.nfce_number || sale.invoice_number ? ` #${sale.tiny_order_number || sale.nfce_number || sale.invoice_number}` : ""}`,
          status: sale.status,
          trackingCode: sale.tracking_code || undefined,
          totalPrice: sale.total == null ? undefined : Number(sale.total),
          createdAt: sale.created_at,
          storeName: sale.store_id ? stores.get(sale.store_id) : undefined,
          channelLabel: sale.sale_type,
          modality: sale.sale_type === "pos" ? "Presencial" : "Online",
          kind: "pos_sale",
          paymentState: isSalePaid(sale) ? "paid" : "unpaid",
          shipped: !!(sale as any).shipped_at || ["shipped", "delivered"].includes(String(sale.status || "")),
          items: saleItems.get(sale.id) || [],
        }));
        const expeditionHistory: POSCustomerOrder[] = expedition.map((item) => ({
          id: item.id,
          orderName: item.shopify_order_name || "Pedido do site",
          status: item.expedition_status,
          trackingCode: item.freight_tracking_code || undefined,
          totalPrice: item.total_price == null ? undefined : Number(item.total_price),
          createdAt: item.shopify_created_at,
          storeName: "Site (Online)",
          channelLabel: "Site",
          modality: "Online",
          kind: "expedition",
        }));
        const addressSource = registration || posCustomer;
        const shipping = expedition.find((item) => item.shipping_address)?.shipping_address;
        const address = addressSource?.address
          ? [addressSource.address, addressSource.address_number, addressSource.complement, addressSource.neighborhood, addressSource.city && addressSource.state ? `${addressSource.city}/${addressSource.state}` : addressSource.city || addressSource.state, addressSource.cep].filter(Boolean).join(", ")
          : shipping && typeof shipping === "object"
            ? [shipping.address1 || shipping.street, shipping.number, shipping.complement, shipping.neighborhood, shipping.city, shipping.province_code || shipping.state, shipping.zip || shipping.cep].filter(Boolean).join(", ")
            : undefined;
        const cashback = ((cashbackRes.data || []) as any[])[0];
        const sourceCustomer = customers.find((item) => item.id === order.customer_id) || customers[0];
        const name = cleanValue(registration?.full_name) || cleanValue(posCustomer?.name) || cleanValue(order.customer?.full_name) || cleanValue(sourceCustomer?.full_name) || cleanValue(`${unified?.first_name || ""} ${unified?.last_name || ""}`);
        const cpf = cleanValue(registration?.cpf) || cleanValue(posCustomer?.cpf) || cleanValue(posSales.find((item) => item.customer_cpf)?.customer_cpf) || cleanValue(expedition.find((item) => item.customer_cpf)?.customer_cpf);

        if (!cancelled) {
          setUnifiedId(unified?.id || undefined);
          setData({
            name,
            instagram: cleanHandle(sourceCustomer?.instagram_handle || unified?.instagram_handle || handle) || undefined,
            tags: sourceCustomer?.tags || [],
            cpf,
            email: cleanValue(registration?.email) || cleanValue(posCustomer?.email) || cleanValue(unified?.email),
            address: cleanValue(address),
            cashback: cashback && Number(cashback.total_available) > 0 ? {
              totalAvailable: Number(cashback.total_available), count: Number(cashback.cashback_count) || 0,
              couponCode: cashback.coupon_code, amount: Number(cashback.cashback_amount) || 0,
              minPurchase: Number(cashback.min_purchase) || 0, generatedAt: cashback.generated_at, expiresAt: cashback.expires_at,
            } : undefined,
            orders: [...liveHistory, ...salesHistory, ...expeditionHistory].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()),
          });
        }
      } catch (error) {
        console.error("[LiveCustomerHistoryPanel]", error);
        if (!cancelled) setData({ name: order.customer?.full_name || undefined, instagram: handle || undefined, orders: [] });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [handle, order, phone, suffix]);

  const chargebacks = useMemo(() => {
    const seen = new Set<string>();
    return [...cbByPhone(phone), ...cbByCpf(data?.cpf), ...cbByHandle(handle)].filter((item) => !seen.has(item.id) && seen.add(item.id));
  }, [cbByCpf, cbByHandle, cbByPhone, data?.cpf, handle, phone]);
  const exchanges = useMemo(() => {
    const seen = new Set<string>();
    return [...exByPhone(phone), ...exByCpf(data?.cpf), ...exByHandle(handle)].filter((item) => !seen.has(item.id) && seen.add(item.id));
  }, [data?.cpf, exByCpf, exByHandle, exByPhone, handle, phone]);
  const refreshRisks = () => { invalidateExchangeRegistry(); void refreshChargebacks(); void refreshExchanges(); };

  if (loading && !data) return <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return <POSCustomerOrdersPanel
    phone={phone || "Não informado"}
    customerName={data?.name || order.customer?.full_name || (handle ? `@${handle}` : "Cliente")}
    data={data}
    statusLabels={statusLabels}
    riskBadges={(chargebacks.length || exchanges.length) ? <div className="flex flex-wrap gap-1">{exchanges.length > 0 && <CustomerExchangeBadge exchanges={exchanges} size="sm" />}{chargebacks.length > 0 && <CustomerChargebackBadge chargebacks={chargebacks} size="sm" />}</div> : null}
    renderOrderActions={(item) => item.kind === "pos_sale" ? <CustomerOrderActions saleId={item.id} saleLabel={item.orderName || "Venda"} saleTotal={item.totalPrice} customer={{ name: data?.name, phone, cpf: data?.cpf, email: data?.email, unifiedId }} chargebacks={chargebacks.filter((record) => record.pos_sale_id === item.id)} exchanges={exBySale(item.id)} onChanged={refreshRisks} /> : null}
  />;
}