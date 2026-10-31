import { supabase } from "@/integrations/supabase/client";
import { createBatcher, createKeyedCache } from "./cardBatch";

/** Lotes usados pelos cartões do quadro da live (uma consulta para o quadro inteiro). */

export type CardRegistration = {
  order_id: string; full_name: string | null; cpf: string | null; whatsapp: string | null;
  cep: string | null; address: string | null; city: string | null; state: string | null;
};

export const registrationByOrder = createBatcher<CardRegistration>(async (ids) => {
  const { data } = await supabase
    .from("customer_registrations")
    .select("order_id,full_name,cpf,whatsapp,cep,address,city,state")
    .in("order_id", ids);
  const m = new Map<string, CardRegistration>();
  for (const r of (data || []) as CardRegistration[]) if (r.order_id && !m.has(r.order_id)) m.set(r.order_id, r);
  return m;
});

export type CardEventInfo = { channel: string | null; default_store_id: string | null; manual_pos_routing: boolean | null };
export const eventInfoById = createBatcher<CardEventInfo>(async (ids) => {
  const { data } = await supabase.from("events").select("id, channel, default_store_id, manual_pos_routing").in("id", ids);
  const m = new Map<string, CardEventInfo>();
  for (const r of (data || []) as any[]) m.set(r.id, r);
  return m;
}, { ttlMs: 5 * 60_000 });

export const tagIdsByOrder = createBatcher<string[]>(async (ids) => {
  const { data } = await supabase.from("order_tag_assignments" as any).select("order_id, tag_id").in("order_id", ids);
  const m = new Map<string, string[]>();
  for (const id of ids) m.set(id, []);
  for (const r of ((data as any[]) || [])) m.get(r.order_id)?.push(r.tag_id);
  return m;
});

export type CardCheckoutMethod = { payment_method: string | null; metadata: unknown };
export const successAttemptBySale = createBatcher<CardCheckoutMethod>(async (ids) => {
  const { data } = await supabase
    .from("pos_checkout_attempts")
    .select("sale_id, payment_method, metadata, created_at")
    .in("sale_id", ids)
    .eq("status", "success")
    .order("created_at", { ascending: false });
  const m = new Map<string, CardCheckoutMethod>();
  for (const r of (data || []) as any[]) if (!m.has(r.sale_id)) m.set(r.sale_id, r);
  return m;
});

export const latestRegistrationByCustomer = createKeyedCache(async (customerId: string) => {
  const { data } = await supabase.rpc("get_latest_registration_by_customer", { p_customer_id: customerId }).maybeSingle();
  return data as any;
});
