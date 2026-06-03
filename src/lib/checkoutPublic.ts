// Client helpers for the public checkout proxy edge function (`checkout-public`).
// These replace direct anon table access to pos_sales / pos_sale_items /
// pos_customers / pos_checkout_attempts, which are now locked down server-side.
import { supabase } from "@/integrations/supabase/client";

async function call<T = any>(action: string, payload: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const { data, error } = await supabase.functions.invoke("checkout-public", {
      body: { action, ...payload },
    });
    if (error) {
      console.warn(`[checkout-public:${action}]`, error);
      return null;
    }
    return data as T;
  } catch (e) {
    console.warn(`[checkout-public:${action}] threw`, e);
    return null;
  }
}

export async function cpGetSale(saleId: string, storeId?: string) {
  return call<{ sale: any; store_name: string; items: any[] }>("get_sale", { saleId, storeId });
}

export async function cpGetSaleStatus(saleId: string) {
  return call<{ status: string | null; payment_gateway: string | null }>("get_sale_status", { saleId });
}

export async function cpUpdateSale(saleId: string, patch: Record<string, unknown>, storeId?: string) {
  return call<{ ok: boolean }>("update_sale", { saleId, storeId, patch });
}

export async function cpLogAttempt(attempt: Record<string, unknown>) {
  return call<{ ok: boolean }>("log_attempt", { attempt });
}

export async function cpGetAttemptStatus(transactionId: string) {
  return call<{ status: string | null; error_message: string | null }>("get_attempt_status", { transactionId });
}

export async function cpLookupCustomerCpf(cpf: string) {
  return call<{ customer: any | null }>("lookup_customer_cpf", { cpf });
}

export async function cpCompleteSale(saleId: string, customer: Record<string, unknown>) {
  return call<{ ok: boolean; customerId: string | null }>("complete_sale", { saleId, customer });
}

export async function cpCreatePickupSale(payload: Record<string, unknown>) {
  return call<{ ok: boolean; saleId: string }>("create_pickup_sale", payload);
}
