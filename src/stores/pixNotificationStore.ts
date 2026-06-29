import { create } from "zustand";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Notificações de PIX/Checkout pendentes no chat do WhatsApp (PDV).
 *
 * Mostra "abas" (estilo aba de navegador) que ficam visíveis enquanto o
 * pagamento estiver pendente, independente de qual conversa está aberta.
 * Quando o pagamento confirma:
 *  - a aba vira "PAGO" e fica piscando;
 *  - se o operador NÃO estiver olhando aquela conversa, dispara um alerta global.
 *
 * Fonte da verdade: tabela `chat_awaiting_payment` (já existente) + status real
 * em `pos_sales`. Detecta confirmação tanto pelo polling do diálogo quanto pelo
 * webhook do Mercado Pago (via polling de status como rede de segurança).
 */

export interface PixTab {
  saleId: string;
  phone: string;
  numberId: string | null;
  name: string;
  amount: number;
  type: string; // 'pix' | 'checkout'
  status: "pending" | "paid";
  createdAt: string;
  paidAt?: number;
}

const PAID_STATUSES = new Set(["paid", "online_paid", "approved"]);

function phoneKey(phone: string | null | undefined): string {
  return String(phone || "").replace(/\D/g, "").slice(-8);
}

interface PixNotificationState {
  tabs: PixTab[];
  activePhoneKey: string | null;
  openRequest: { phone: string; numberId: string | null } | null;
  paidAlert: PixTab | null;

  _inited: boolean;
  _channel: ReturnType<typeof supabase.channel> | null;
  _poll: ReturnType<typeof setInterval> | null;
  _refreshTimer: ReturnType<typeof setTimeout> | null;

  init: () => void;
  refresh: () => Promise<void>;
  setActivePhone: (phone: string | null) => void;
  requestOpen: (phone: string, numberId: string | null) => void;
  clearOpenRequest: () => void;
  dismiss: (saleId: string) => void;
  clearPaidAlert: () => void;
}

export const usePixNotificationStore = create<PixNotificationState>((set, get) => ({
  tabs: [],
  activePhoneKey: null,
  openRequest: null,
  paidAlert: null,

  _inited: false,
  _channel: null,
  _poll: null,
  _refreshTimer: null,

  init: () => {
    if (get()._inited) return;
    set({ _inited: true });

    get().refresh();

    const scheduleRefresh = () => {
      const t = get()._refreshTimer;
      if (t) clearTimeout(t);
      set({ _refreshTimer: setTimeout(() => get().refresh(), 1500) });
    };

    const channel = supabase
      .channel("pix-notifications")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_awaiting_payment" },
        scheduleRefresh,
      )
      .subscribe();

    // Rede de segurança: confirma status real periodicamente (cobre o caminho
    // do webhook, que nem sempre apaga a linha de chat_awaiting_payment na hora).
    const poll = setInterval(() => {
      if (get().tabs.some((t) => t.status === "pending")) get().refresh();
    }, 8000);

    set({ _channel: channel, _poll: poll });
  },

  refresh: async () => {
    try {
      const { data: awaiting } = await supabase
        .from("chat_awaiting_payment")
        .select("phone, sale_id, type, created_at");

      const awaitingRows = (awaiting || []).filter((r: any) => r.sale_id);
      const existing = get().tabs;

      // Todos os sale_ids que precisamos checar: os pendentes + os já rastreados.
      const saleIds = Array.from(
        new Set([
          ...awaitingRows.map((r: any) => String(r.sale_id)),
          ...existing.map((t) => t.saleId),
        ]),
      );

      if (saleIds.length === 0) {
        if (existing.length > 0) set({ tabs: [] });
        return;
      }

      const { data: sales } = await supabase
        .from("pos_sales")
        .select("id, total, status, payment_details")
        .in("id", saleIds);

      const saleById = new Map<string, any>();
      (sales || []).forEach((s: any) => saleById.set(String(s.id), s));

      const awaitingBySale = new Map<string, any>();
      awaitingRows.forEach((r: any) => awaitingBySale.set(String(r.sale_id), r));

      const next: PixTab[] = [];
      let newlyPaid: PixTab | null = null;

      for (const saleId of saleIds) {
        const sale = saleById.get(saleId);
        const awaitingRow = awaitingBySale.get(saleId);
        const prev = existing.find((t) => t.saleId === saleId);
        const isPaid = sale && PAID_STATUSES.has(String(sale.status));

        if (isPaid) {
          const pd = (sale.payment_details || {}) as Record<string, unknown>;
          const phone = (awaitingRow?.phone as string) || prev?.phone || (pd.customer_phone as string) || "";
          const tab: PixTab = {
            saleId,
            phone,
            numberId: prev?.numberId ?? null,
            name:
              prev?.name ||
              (pd.customer_name as string) ||
              phone ||
              "Cliente",
            amount: Number(sale.total) || prev?.amount || 0,
            type: (awaitingRow?.type as string) || prev?.type || "pix",
            status: "paid",
            createdAt: prev?.createdAt || (awaitingRow?.created_at as string) || new Date().toISOString(),
            paidAt: prev?.paidAt || Date.now(),
          };
          next.push(tab);
          if (!prev || prev.status !== "paid") newlyPaid = tab;
        } else if (awaitingRow && sale) {
          const pd = (sale.payment_details || {}) as Record<string, unknown>;
          const phone = (awaitingRow.phone as string) || (pd.customer_phone as string) || "";
          next.push({
            saleId,
            phone,
            numberId: prev?.numberId ?? null,
            name: (pd.customer_name as string) || prev?.name || phone || "Cliente",
            amount: Number(sale.total) || 0,
            type: (awaitingRow.type as string) || "pix",
            status: "pending",
            createdAt: (awaitingRow.created_at as string) || new Date().toISOString(),
          });
        } else if (prev && prev.status === "paid") {
          // Mantém aba paga até o operador descartar.
          next.push(prev);
        }
        // Caso contrário: sumiu da fila e não foi pago (cancelado) → remove.
      }

      // Ordena: pagos primeiro (chamam atenção), depois por mais antigo.
      next.sort((a, b) => {
        if (a.status !== b.status) return a.status === "paid" ? -1 : 1;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });

      set({ tabs: next });

      if (newlyPaid) {
        toast.success(`💰 ${newlyPaid.name} pagou R$ ${newlyPaid.amount.toFixed(2)}`);
        if (phoneKey(newlyPaid.phone) !== get().activePhoneKey) {
          set({ paidAlert: newlyPaid });
        }
      }
    } catch (e) {
      console.error("[pix-notifications] refresh error:", e);
    }
  },

  setActivePhone: (phone) => set({ activePhoneKey: phoneKey(phone) || null }),

  requestOpen: (phone, numberId) => set({ openRequest: { phone, numberId } }),
  clearOpenRequest: () => set({ openRequest: null }),

  dismiss: (saleId) =>
    set((s) => ({ tabs: s.tabs.filter((t) => t.saleId !== saleId) })),

  clearPaidAlert: () => set({ paidAlert: null }),
}));
