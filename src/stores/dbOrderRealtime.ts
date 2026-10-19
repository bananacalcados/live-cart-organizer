import { supabase } from "@/integrations/supabase/client";
import { DbCustomer, DbOrder, DbOrderProduct, DiscountType } from "@/types/database";

const sortByCreatedAtDesc = (a: DbOrder, b: DbOrder) =>
  new Date(b.created_at).getTime() - new Date(a.created_at).getTime();

export const mapDbOrder = (order: any): DbOrder => ({
  ...order,
  products: (order.products as DbOrderProduct[] | null) ?? [],
  customer: order.customer as DbCustomer,
  discount_type: order.discount_type as DiscountType | undefined,
});

export const mergeDbOrder = (orders: DbOrder[], incoming: DbOrder) =>
  [incoming, ...orders.filter((order) => order.id !== incoming.id)].sort(sortByCreatedAtDesc);

export const fetchDbOrderById = async (orderId: string): Promise<DbOrder | null> => {
  const { data, error } = await supabase
    .from("orders")
    .select(`
      *,
      customer:customers(*)
    `)
    .eq("id", orderId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapDbOrder(data) : null;
};

export interface OrderSyncVersion {
  id: string;
  updated_at: string;
  customer?: { whatsapp?: string | null } | null;
}

export const changedOrderIds = (orders: DbOrder[], versions: OrderSyncVersion[]) => {
  const current = new Map(orders.map((order) => [order.id, order]));
  return versions.filter((v) => {
    const order = current.get(v.id);
    return !order || order.updated_at !== v.updated_at
      || (order.customer?.whatsapp || "") !== (v.customer?.whatsapp || "");
  }).map((v) => v.id);
};

export async function fetchEventOrderVersions(eventId: string): Promise<OrderSyncVersion[]> {
  const versions: OrderSyncVersion[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await supabase.from("orders")
      .select("id,updated_at,customer:customers(whatsapp)")
      .eq("event_id", eventId).order("id").range(offset, offset + 99);
    if (error) throw error;
    versions.push(...(data || []));
    if (!data || data.length < 100) return versions;
  }
}

export async function fetchChangedEventOrders(eventId: string, ids: string[]): Promise<DbOrder[]> {
  const orders: DbOrder[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await supabase.from("orders")
      .select(`id,event_id,customer_id,cart_link,checkout_token,notes,stage,products,
        has_unread_messages,last_customer_message_at,last_sent_message_at,is_paid,paid_at,
        paid_externally,paid_on_site,is_sedex,discount_type,discount_value,free_shipping,
        shipping_cost,has_gift,gift_description,coupon_code,checkout_started_at,eligible_for_prize,
        created_at,updated_at,pagarme_order_id,mercadopago_payment_id,appmax_order_id,
        vindi_transaction_id,pos_sale_id,payment_method_label,installments,ai_paused,ai_paused_at,
        delivery_method,merged_into_order_id,merged_at,merged_by,
        customer:customers(id,instagram_handle,whatsapp,full_name,is_banned,ban_reason,tags,created_at,updated_at)`)
      .eq("event_id", eventId).in("id", ids.slice(offset, offset + 100));
    if (error) throw error;
    orders.push(...(data || []).map(mapDbOrder));
  }
  return orders;
}
