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
