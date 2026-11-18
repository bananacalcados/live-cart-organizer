import { supabase } from "@/integrations/supabase/client";

export type AvailableVoucher = {
  id: string;
  codigo: string;
  saldo: number;
  validade: string | null;
  status: "ativo" | "usado" | "expirado";
  applied_amount: number;
  reserved_order_id: string | null;
  reserved_sale_id: string | null;
  is_available: boolean;
};

export type VoucherWriteResult = {
  voucher_id: string | null;
  voucher_amount: number;
  discount_type: "fixed" | null;
  discount_value: number;
  total: number;
};

type Target = { phone?: string; orderId?: string; saleId?: string };

/** Uma chamada por modal aberto; o servidor resolve o telefone quando recebe o pedido/venda. */
export async function listAvailableVouchers(target: Target): Promise<AvailableVoucher[]> {
  const { data, error } = await supabase.rpc("available_vouchers_for_target" as any, {
    p_phone: target.phone || null,
    p_order_id: target.orderId || null,
    p_sale_id: target.saleId || null,
    p_limit: 20,
    p_offset: 0,
  });
  if (error) throw error;
  return ((data as any[]) || []).map((row) => ({
    ...row,
    saldo: Number(row.saldo || 0),
    applied_amount: Number(row.applied_amount || 0),
    is_available: !!row.is_available,
  }));
}

/** Não envia valor: o banco calcula desconto e total pelo saldo real e pelos produtos. */
export async function setTargetVoucher(target: { orderId?: string; saleId?: string }, voucherId: string | null): Promise<VoucherWriteResult> {
  const { data, error } = await supabase.rpc("set_target_voucher" as any, {
    p_order_id: target.orderId || null,
    p_sale_id: target.saleId || null,
    p_voucher_id: voucherId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("O servidor não retornou o novo total");
  return {
    voucher_id: row.voucher_id || null,
    voucher_amount: Number(row.voucher_amount || 0),
    discount_type: row.discount_type || null,
    discount_value: Number(row.discount_value || 0),
    total: Number(row.total || 0),
  };
}

export const voucherBrl = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function voucherCoversWholeOrder(order: { total: number; voucher_id?: string | null }): boolean {
  return !!order.voucher_id && Number(order.total) <= 0.009;
}
