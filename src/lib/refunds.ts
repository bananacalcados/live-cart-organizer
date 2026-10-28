// Cliente da edge function mp-refund (Estorno Mercado Pago — Fase 1).
import { supabase } from "@/integrations/supabase/client";

export type RefundSource = "order" | "pos_sale";

export interface RefundPreview {
  gateway_window_closes_at?: string | null;
  gateway_window_open?: boolean;
  gateway_window_note?: string;
  ok: boolean;
  error?: string;
  gateway?: string;
  fullOnly?: boolean;
  fullOnlyNotice?: string;
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
  status: "aguardando_aprovacao" | "recusado" | "processando" | "verificar" | "concluido" | "concluido_manual" | "falhou";
  manual_reference?: string | null;
  error_message: string | null;
  card_brand: string | null;
  card_last4: string | null;
  installments: number | null;
  requested_by: string | null;
  created_at: string;
  receipt_code?: string | null;
  receipt_path?: string | null;
  receipt_sent_at?: string | null;
  receipt_sent_to?: string | null;
  receipt_sent_channel?: string | null;
}

export interface ReceiptSendPreview {
  ok: boolean;
  blocked: string | null;
  phone_masked: string;
  instance: { id: string; provider: string; label: string } | null;
  message: string;
  file_name: string;
  customer_name: string | null;
  already_sent_at: string | null;
  already_sent_to: string | null;
}

export interface RefundConfig {
  enabled: boolean;
  approval_threshold: number | null;
  receipt_footer_contact?: string;
  receipt_message_template?: string;
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
  registerManual: (payload: {source:RefundSource;source_id:string;gateway:string;amount:number;reason:string;manual_reference:string;manual_done_at:string;note:string;password:string}) => call<{ok:boolean;refund_id:string;status:string;message:string}>({action:'register_manual',...payload}),
  preview: (source: RefundSource, id: string) => call<RefundPreview>({ action: "preview", source, id }),
  execute: (payload: {
    source: RefundSource;
    id: string;
    amount: number;
    reason: string;
    reason_text?: string | null;
    cancel_order?: boolean;
  }) => call<{ ok: boolean; pending_approval?: boolean; refund_id?: string; status?: string; message?: string }>({ action: "execute", ...payload }),
  list: () => call<{ ok: boolean; readyToSend?: { id: string; amount: number; customer_name: string | null }[]; isAdmin: boolean }>({ action: "list" }),
  listScope: (p: RefundListParams) => call<{ ok: boolean; rows: RefundListRow[]; hasMore: boolean; isAdmin: boolean }>({ action: "list", ...p }),
  receiptSendPreview: (id: string, whatsappNumberId?: string | null) =>
    call<ReceiptSendPreview>({ action: "receipt_send_preview", id, whatsapp_number_id: whatsappNumberId || undefined }),
  sendReceipt: (p: { id: string; message: string; confirm_resend?: boolean; whatsapp_number_id?: string | null }) =>
    call<{ ok: boolean; sent_at: string }>({ action: "send_receipt", ...p }),
  approve: (id: string) => call<{ ok: boolean; message?: string }>({ action: "approve", id }),
  reject: (id: string, reason: string) => call<{ ok: boolean; message?: string }>({ action: "reject", id, rejected_reason: reason }),
  eligibility: (items: { source: RefundSource; id: string }[]) =>
    call<{ ok: boolean; results: RefundEligibility[] }>({ action: "eligibility", items }),
  getConfig: () => call<{ ok: boolean; config: RefundConfig; isAdmin: boolean }>({ action: "get_config" }),
  receipt: (id: string) => call<{ ok: boolean; url: string; code: string; path: string }>({ action: "receipt", id }),
  completedForSources: (ids: string[]) =>
    call<{ ok: boolean; refunds: CompletedRefund[] }>({ action: "completed_for_sources", ids }),
  setConfig: (cfg: { enabled?: boolean; approval_threshold?: number | null; receipt_footer_contact?: string; receipt_message_template?: string }) =>
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
  verificar: "Verificando com o Mercado Pago — não refaça o estorno",
  concluido: "Concluído",
  concluido_manual: "Concluído · Manual",
  falhou: "Falhou",
};

export interface CompletedRefund {
  id: string;
  source: RefundSource;
  source_id: string;
  amount: number;
  completed_at: string | null;
  receipt_code: string | null;
  receipt_path?: string | null;
  receipt_sent_at?: string | null;
}

/** Abre o comprovante (gerado no servidor, link de 10 min). */
export async function openRefundReceipt(refundId: string) {
  const win = window.open("", "_blank");
  try {
    const res = await refundApi.receipt(refundId);
    if (win) win.location.href = res.url; else window.location.href = res.url;
  } catch (e) {
    win?.close();
    throw e;
  }
}

// Agrupa os pedidos de vários cartões numa única chamada (sem laço por venda).
const completedCache = new Map<string, Promise<CompletedRefund[]>>();
let pendingIds = new Set<string>();
let pendingResolvers: { id: string; resolve: (v: CompletedRefund[]) => void }[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function getCompletedRefunds(sourceId: string): Promise<CompletedRefund[]> {
  const cached = completedCache.get(sourceId);
  if (cached) return cached;
  const p = new Promise<CompletedRefund[]>((resolve) => {
    pendingIds.add(sourceId);
    pendingResolvers.push({ id: sourceId, resolve });
    if (!flushTimer) {
      flushTimer = setTimeout(async () => {
        const ids = Array.from(pendingIds).slice(0, 100);
        const resolvers = pendingResolvers;
        pendingIds = new Set(); pendingResolvers = []; flushTimer = null;
        let rows: CompletedRefund[] = [];
        try { rows = (await refundApi.completedForSources(ids)).refunds || []; } catch { rows = []; }
        for (const r of resolvers) r.resolve(rows.filter((x) => x.source_id === r.id));
      }, 30);
    }
  });
  completedCache.set(sourceId, p);
  setTimeout(() => completedCache.delete(sourceId), 60_000);
  return p;
}

export interface RefundListParams {
  scope: "pending" | "active" | "history";
  status?: "concluido" | "concluido_manual" | "recusado" | "falhou";
  show_failures?: boolean;
  channel?: "live" | "pdv";
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface RefundListRow extends RefundRow {
  paid_at?: string | null;
  mp_account_name?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  completed_at?: string | null;
  rejected_reason?: string | null;
  customer_name: string | null;
  phone_masked: string;
  source_label: string;
  requested_by_name: string | null;
  approved_by_name: string | null;
}

export interface RefundBadge {
  id: string;
  display_id: string;
  source: RefundSource;
  source_id: string;
  status: RefundRow["status"];
  amount: number;
  refund_type: "integral" | "parcial";
  completed_at: string | null;
  created_at: string;
  has_receipt: boolean;
  receipt_sent_at: string | null;
}

/** Selos de estorno de uma lista de vendas/pedidos — UMA chamada (inclui pedido↔venda vinculados). */
export async function fetchRefundBadges(ids: string[]): Promise<RefundBadge[]> {
  const uniq = Array.from(new Set(ids.filter((s) => /^[0-9a-f-]{36}$/i.test(s)))).slice(0, 200);
  if (uniq.length === 0) return [];
  const { data, error } = await supabase.rpc("refund_badges_for_sources" as any, { order_ids: uniq, sale_ids: uniq } as any);
  if (error) return [];
  return (data as any) || [];
}

/** Reautenticação real com a senha do próprio usuário (mesma do RefundDialog). */
export async function reauthWithPassword(password: string) {
  const { data } = await supabase.auth.getUser();
  const email = data?.user?.email;
  if (!email) throw new Error("Sessão inválida. Entre de novo no sistema.");
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error("Senha incorreta.");
}

export interface RefundEligibility {
  gateway_window_closes_at?: string | null;
  gateway_window_open?: boolean;
  gateway_window_note?: string;
  source: RefundSource;
  id: string;
  eligible: boolean;
  reason?: string;
  retry?: boolean;
  gateway?: string | null;
  remaining?: number;
  method?: "pix" | "cartao" | "debito";
  cardLast4?: string | null;
  installments?: number | null;
  dateApproved?: string | null;
}
