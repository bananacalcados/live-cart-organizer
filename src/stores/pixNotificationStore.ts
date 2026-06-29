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
 *  - As abas são ESCOPADAS POR LOJA: um pedido criado no chat da Loja Centro só
 *    aparece no chat da Loja Centro. Pedidos de Live são vinculados à loja do
 *    evento. Filtra por `store_id` da venda.
 *  - SÓ entram pedidos vindos do próprio chat (botões PIX/Checkout) ou de Live
 *    Shopping. Pedidos feitos fora do WhatsApp (ads, órfãos) são ignorados.
 *  - Ao clicar na aba, abre a conversa NA INSTÂNCIA em que o pedido foi feito
 *    (`whatsapp_number_id`), para o histórico aparecer corretamente.
 *  - O modal de "pagamento confirmado" SÓ aparece para pagamentos confirmados
 *    AGORA. Pedidos antigos (já pagos quando o store inicializou) NUNCA disparam
 *    modal — eles entram numa "baseline".
 *  - Cada pagamento dispara o modal no máximo UMA vez.
 *  - Fechar (X) uma aba é PERMANENTE (persistido em localStorage).
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
  isLive?: boolean; // pedido proveniente de Live Shopping
}

const PAID_STATUSES = new Set(["paid", "online_paid", "approved", "completed"]);
// Origens válidas: chat (online) e live shopping. Tudo o que não for isso é ignorado.
const ALLOWED_SALE_TYPES = new Set(["online", "live"]);
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
  _storeId: string | null;
  _baselineDone: boolean;
  _baseline: Set<string>; // vendas já pagas quando o store iniciou (sem modal)
  _alerted: Set<string>; // vendas que já dispararam o modal (uma vez só)
  _dismissed: Set<string>; // abas fechadas pelo operador (permanente)
  _channel: ReturnType<typeof supabase.channel> | null;
  _poll: ReturnType<typeof setInterval> | null;
  _refreshTimer: ReturnType<typeof setTimeout> | null;

  init: (storeId?: string | null) => void;
  refresh: () => Promise<void>;
  setActivePhone: (phone: string | null) => void;
  requestOpen: (phone: string, numberId: string | null) => void;
  clearOpenRequest: () => void;
  dismiss: (saleId: string) => void;
  clearPaidAlert: () => void;
}

// UUID v4-ish guard: lojas virtuais (ex.: "expedition") não filtram por loja real.
function isUuid(v: string | null | undefined): boolean {
  return !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export const usePixNotificationStore = create<PixNotificationState>((set, get) => ({
  tabs: [],
  activePhoneKey: null,
  openRequest: null,
  paidAlert: null,

  _inited: false,
  _storeId: null,
  _baselineDone: false,
  _baseline: new Set(),
  _alerted: new Set(),
  _dismissed: loadDismissed(),
  _channel: null,
  _poll: null,
  _refreshTimer: null,

  init: (storeId) => {
    const prevStore = get()._storeId;
    const nextStore = storeId ?? prevStore ?? null;

    if (get()._inited) {
      // Se a loja mudou (troca de módulo), re-escopa e recarrega do zero.
      if (storeId !== undefined && storeId !== prevStore) {
        set({ _storeId: nextStore, tabs: [], _baselineDone: false, _baseline: new Set() });
        get().refresh();
      }
      return;
    }

    set({ _inited: true, _storeId: nextStore });

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
      const storeId = get()._storeId;
      const scoped = isUuid(storeId); // só filtra por loja quando há loja real

      const { data: awaiting } = await supabase
        .from("chat_awaiting_payment")
        .select("phone, sale_id, type, created_at, store_id, whatsapp_number_id");

      const awaitingRows = (awaiting || []).filter(
        (r: any) =>
          r.sale_id &&
          r.type !== "ads_checkout" && // origem fora do chat
          !dismissed.has(String(r.sale_id)),
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
        .select("id, total, status, payment_details, store_id, sale_type, event_id")
        .in("id", saleIds);

      const saleById = new Map<string, any>();
      (sales || []).forEach((s: any) => saleById.set(String(s.id), s));

      const awaitingBySale = new Map<string, any>();
      awaitingRows.forEach((r: any) => awaitingBySale.set(String(r.sale_id), r));

      const isInitial = !get()._baselineDone;
      const baseline = get()._baseline;
      const alerted = get()._alerted;

      // Resolve a loja de uma venda (venda > linha awaiting). Live usa store da venda
      // (que já é a loja do evento via backfill/cadastro).
      const resolveStoreId = (sale: any, awaitingRow: any): string | null =>
        (sale?.store_id as string) || (awaitingRow?.store_id as string) || null;

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

        // Sem venda real = pedido fora do chat / órfão → ignora.
        if (!sale) continue;

        // Origem precisa ser chat (online) ou live.
        const saleType = String(sale.sale_type || "");
        if (!ALLOWED_SALE_TYPES.has(saleType)) continue;

        // Escopo por loja: só mostra na loja onde o pedido foi feito.
        const saleStore = resolveStoreId(sale, awaitingRow);
        if (scoped && saleStore && saleStore !== storeId) continue;
        // Se temos loja real mas a venda não tem loja resolvida, não arrisca cross-store.
        if (scoped && !saleStore) continue;

        const isLive = saleType === "live";
        const isPaid = PAID_STATUSES.has(String(sale.status));
        const pd = (sale.payment_details || {}) as Record<string, unknown>;
        const numberId =
          (awaitingRow?.whatsapp_number_id as string) || prev?.numberId || null;

        if (isPaid) {
          const phone =
            (awaitingRow?.phone as string) || prev?.phone || (pd.customer_phone as string) || "";

          // É "fresco" (confirmado ao vivo) somente se NÃO faz parte da baseline.
          const isFresh = prev?.fresh || (!baseline.has(saleId) && !isInitial);

          const tab: PixTab = {
            saleId,
            phone,
            numberId,
            name: prev?.name || (pd.customer_name as string) || phone || "Cliente",
            amount: Number(sale.total) || prev?.amount || 0,
            type: (awaitingRow?.type as string) || prev?.type || "pix",
            status: "paid",
            createdAt:
              prev?.createdAt || (awaitingRow?.created_at as string) || new Date().toISOString(),
            paidAt: prev?.paidAt || Date.now(),
            fresh: isFresh,
            isLive,
          };
          next.push(tab);

          // Dispara modal UMA vez, só para pagamento confirmado agora.
          if (isFresh && !alerted.has(saleId)) {
            alerted.add(saleId);
            newlyPaid = tab;
          }
        } else if (awaitingRow) {
          const phone = (awaitingRow.phone as string) || (pd.customer_phone as string) || "";
          next.push({
            saleId,
            phone,
            numberId,
            name: (pd.customer_name as string) || prev?.name || phone || "Cliente",
            amount: Number(sale.total) || 0,
            type: (awaitingRow.type as string) || "pix",
            status: "pending",
            createdAt: (awaitingRow.created_at as string) || new Date().toISOString(),
            isLive,
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
