// Cliente da edge function mp-refund (Estorno Mercado Pago — Fase 1).
import { supabase } from "@/integrations/supabase/client";

export type RefundSource = "order" | "pos_sale";

export interface RefundPreview {
  ok: boolean;
  error?: string;
  point?: boolean;
  source?: {
    id: string;
    label: string;
    channel: "live" | "pdv";
    total: number;
    customerName: string | null;
    isPaid: boolean;
    shipped: boolean;
    stageOrStatus: string | null;
    createdAt: string | null;
  };
  payment?: {
    id: number | string;
    status: string;
    method: string;
    type: string;
    amount: number;
    dateApproved: string | null;
    cardLast4: string | null;
    installments: number | null;
    accountName?: string;
  } | null;
  remaining: number | null;
  refundedSoFar: number | null;
  existingRefunds?: { id: string; amount: number; status: string; refund_type: string; created_at: string }[];
}

export interface RefundRow {
  id: string;
  gateway: string;
  source: RefundSource;
  source_id: string;
  payment_id: string;
  amount: number;
  refund_type: "integral" | "parcial";
  reason: string;
  reason_text: string | null;
  status: "aguardando_aprovacao" | "recusado" | "processando" | "concluido" | "falhou";
  error_message: string | null;
  card_brand: string | null;
  card_last4: string | null;
  installments: number | null;
  requested_by: string | null;
  created_at: string;
}

export interface RefundConfig {
  enabled: boolean;
  approval_threshold: number | null;
}

async function call<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("mp-refund", { body });
  if (error) {
    // functions.invoke joga erro genérico em HTTP != 2xx; tenta extrair a mensagem real
    const msg = (data as any)?.error || error.message || "Falha ao falar com o servidor de estornos.";
    throw new Error(msg);
  }
  if ((data as any)?.error && (data as any)?.ok !== true) throw new Error((data as any).error);
  return data as T;
}

export const refundApi = {
  preview: (source: RefundSource, id: string) => call<RefundPreview>({ action: "preview", source, id }),
  execute: (payload: {
    source: RefundSource;
    id: string;
    amount: number;
    reason: string;
    reason_text?: string | null;
    cancel_order?: boolean;
  }) => call<{ ok: boolean; pending_approval?: boolean; refund_id?: string; status?: string; message?: string }>({ action: "execute", ...payload }),
  list: () => call<{ ok: boolean; pending: RefundRow[]; recent: RefundRow[]; isAdmin: boolean }>({ action: "list" }),
  approve: (id: string) => call<{ ok: boolean; message?: string }>({ action: "approve", id }),
  reject: (id: string) => call<{ ok: boolean; message?: string }>({ action: "reject", id }),
  getConfig: () => call<{ ok: boolean; config: RefundConfig; isAdmin: boolean }>({ action: "get_config" }),
  setConfig: (cfg: { enabled?: boolean; approval_threshold?: number | null }) =>
    call<{ ok: boolean; config: RefundConfig }>({ action: "set_config", ...cfg }),
};

export const REFUND_REASONS = [
  { value: "cancelamento_antes_envio", label: "Cancelamento antes do envio" },
  { value: "devolucao", label: "Devolução" },
  { value: "troca_com_diferenca", label: "Troca com diferença" },
  { value: "outro", label: "Outro" },
] as const;

export const REFUND_STATUS_LABELS: Record<string, string> = {
  aguardando_aprovacao: "Aguardando aprovação",
  recusado: "Recusado",
  processando: "Em processamento",
  concluido: "Concluído",
  falhou: "Falhou",
};
