import { create } from "zustand";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Notificações de PIX/Checkout pendentes no chat do WhatsApp (PDV).
 *
 * Mostra "abas" (estilo aba de navegador) que ficam visíveis enquanto o
 * pagamento estiver pendente, independente de qual conversa está aberta.
 * Quando o pagamento confirma AO VIVO (transição de pendente -> pago durante
 * esta sessão):
 *  - a aba vira "PAGO" e fica piscando;
 *  - se o operador NÃO estiver olhando aquela conversa, dispara um alerta global.
 *
 * Regras importantes (pedidos do usuário):
 *  - O modal de "pagamento confirmado" SÓ aparece para pagamentos confirmados
 *    AGORA. Pedidos antigos (já pagos quando o store inicializou) NUNCA disparam
 *    modal — eles entram numa "baseline".
 *  - Cada pagamento dispara o modal no máximo UMA vez.
 *  - Fechar (X) uma aba é PERMANENTE: ela não reaparece (persistido em
 *    localStorage), mesmo que a venda continue paga e a linha continue na fila.
 *
 * Fonte da verdade: tabela `chat_awaiting_payment` + status real em `pos_sales`.
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
  fresh?: boolean; // confirmado AO VIVO nesta sessão (pisca / dispara modal)
}

const PAID_STATUSES = new Set(["paid", "online_paid", "approved"]);
const DISMISSED_KEY = "pix_notif_dismissed_v1";

function phoneKey(phone: string | null | undefined): string {
  return String(phone || "").replace(/\D/g, "").slice(-8);
}

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function saveDismissed(set: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(set)));
  } catch {
    /* ignore */
  }
}

interface PixNotificationState {
  tabs: PixTab[];
  activePhoneKey: string | null;
  openRequest: { phone: string; numberId: string | null } | null;
  paidAlert: PixTab | null;

  _inited: boolean;
  _baselineDone: boolean;
  _baseline: Set<string>; // vendas já pagas quando o store iniciou (sem modal)
  _alerted: Set<string>; // vendas que já dispararam o modal (uma vez só)
  _dismissed: Set<string>; // abas fechadas pelo operador (permanente)
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
  _baselineDone: false,
  _baseline: new Set(),
  _alerted: new Set(),
  _dismissed: loadDismissed(),
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
      const dismissed = get()._dismissed;

      const { data: awaiting } = await supabase
        .from("chat_awaiting_payment")
        .select("phone, sale_id, type, created_at");

      const awaitingRows = (awaiting || []).filter(
        (r: any) => r.sale_id && !dismissed.has(String(r.sale_id)),
      );
      const existing = get().tabs;

      const saleIds = Array.from(
        new Set([
          ...awaitingRows.map((r: any) => String(r.sale_id)),
          ...existing.map((t) => t.saleId),
        ]),
      ).filter((id) => !dismissed.has(id));

      if (saleIds.length === 0) {
        if (existing.length > 0) set({ tabs: [] });
        if (!get()._baselineDone) set({ _baselineDone: true });
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

      const isInitial = !get()._baselineDone;
      const baseline = get()._baseline;
      const alerted = get()._alerted;

      // Na primeira passada: tudo que já está pago vira "baseline" (pedido antigo).
      if (isInitial) {
        for (const saleId of saleIds) {
          const sale = saleById.get(saleId);
          if (sale && PAID_STATUSES.has(String(sale.status))) baseline.add(saleId);
        }
      }

      const next: PixTab[] = [];
      let newlyPaid: PixTab | null = null;

      for (const saleId of saleIds) {
        if (dismissed.has(saleId)) continue;
        const sale = saleById.get(saleId);
        const awaitingRow = awaitingBySale.get(saleId);
        const prev = existing.find((t) => t.saleId === saleId);
        const isPaid = sale && PAID_STATUSES.has(String(sale.status));

        if (isPaid) {
          const pd = (sale.payment_details || {}) as Record<string, unknown>;
          const phone =
            (awaitingRow?.phone as string) || prev?.phone || (pd.customer_phone as string) || "";

          // É "fresco" (confirmado ao vivo) somente se NÃO faz parte da baseline.
          const isFresh = prev?.fresh || (!baseline.has(saleId) && !isInitial);

          const tab: PixTab = {
            saleId,
            phone,
            numberId: prev?.numberId ?? null,
            name: prev?.name || (pd.customer_name as string) || phone || "Cliente",
            amount: Number(sale.total) || prev?.amount || 0,
            type: (awaitingRow?.type as string) || prev?.type || "pix",
            status: "paid",
            createdAt: prev?.createdAt || (awaitingRow?.created_at as string) || new Date().toISOString(),
            paidAt: prev?.paidAt || Date.now(),
            fresh: isFresh,
          };
          next.push(tab);

          // Dispara modal UMA vez, só para pagamento confirmado agora.
          if (isFresh && !alerted.has(saleId)) {
            alerted.add(saleId);
            newlyPaid = tab;
          }
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
          next.push(prev); // mantém paga até o operador descartar
        }
        // Caso contrário: sumiu da fila e não foi pago (cancelado) → remove.
      }

      // Ordena: pagos primeiro, depois por mais antigo.
      next.sort((a, b) => {
        if (a.status !== b.status) return a.status === "paid" ? -1 : 1;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });

      set({ tabs: next, _baseline: baseline, _alerted: alerted });
      if (isInitial) set({ _baselineDone: true });

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
    set((s) => {
      const dismissed = new Set(s._dismissed);
      dismissed.add(saleId);
      saveDismissed(dismissed);
      return {
        _dismissed: dismissed,
        tabs: s.tabs.filter((t) => t.saleId !== saleId),
        paidAlert: s.paidAlert?.saleId === saleId ? null : s.paidAlert,
      };
    }),

  clearPaidAlert: () => set({ paidAlert: null }),
}));
