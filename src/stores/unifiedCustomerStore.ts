/**
 * Unified Customer Store — leitura central de `customers_unified`.
 *
 * Esta store é a fonte da verdade para qualquer lookup de cliente
 * (por telefone, CPF, Instagram, email). Substitui gradualmente:
 *   - customerStore (lives, ban list)
 *   - useCrmPhoneLookup
 *   - leituras diretas em zoppy_customers / pos_customers / chat_contacts
 *
 * Escritas (criar/atualizar cliente) NÃO passam aqui ainda — Onda 2.
 * Por enquanto, INSERT/UPDATE nas tabelas legadas é espelhado
 * automaticamente para `customers_unified` via triggers (Onda 0).
 */
import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface UnifiedCustomer {
  id: string;
  customer_code: string | null;
  name: string | null;
  cpf: string | null;
  email: string | null;
  birth_date: string | null;
  gender: string | null;
  phone_e164: string | null;
  phone_suffix8: string | null;
  previous_phones: string[] | null;
  instagram_handle: string | null;
  instagram_user_id: string | null;
  cep: string | null;
  address: string | null;
  address_number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  shoe_size: string | null;
  preferred_style: string | null;
  age_range: string | null;
  has_children: boolean | null;
  children_age_range: string | null;
  total_orders: number;
  total_spent: number;
  avg_ticket: number;
  total_items: number;
  first_purchase_at: string | null;
  last_purchase_at: string | null;
  rfm_segment: string | null;
  rfm_r: number | null;
  rfm_f: number | null;
  rfm_m: number | null;
  rfm_total: number | null;
  region_type: string | null;
  ddd: string | null;
  tags: string[] | null;
  is_banned: boolean;
  ban_reason: string | null;
  live_cancellation_count: number;
  cashback_balance: number;
  cashback_expires_at: string | null;
  loyalty_points: number;
  loyalty_lifetime_points: number;
  source_origins: unknown;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
}

// ---------- Normalizadores (espelham os helpers SQL Onda 0) -----------------

export function normPhoneBR(raw?: string | null): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, '');
  if (!d || d.length < 10) return null;
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 10) d = d.slice(0, 2) + '9' + d.slice(2);
  if (d.length !== 11) return null;
  return '55' + d;
}

export function phoneSuffix8(raw?: string | null): string | null {
  const e164 = normPhoneBR(raw);
  return e164 ? e164.slice(-8) : null;
}

export function normCpf(raw?: string | null): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, '');
  return d.length === 11 ? d : null;
}

export function normIg(raw?: string | null): string | null {
  if (!raw) return null;
  const v = raw.toLowerCase().replace(/^@/, '').trim();
  return v || null;
}

export function normEmail(raw?: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  return v || null;
}

// ---------- Store ----------------------------------------------------------

interface UnifiedCustomerStore {
  bySuffix: Map<string, UnifiedCustomer>;
  byCpf: Map<string, UnifiedCustomer>;
  byInstagram: Map<string, UnifiedCustomer>;
  byEmail: Map<string, UnifiedCustomer>;
  byId: Map<string, UnifiedCustomer>;
  isLoaded: boolean;
  isLoading: boolean;

  /** Pré-carrega base completa (apenas para telas que precisam, ex: CRM). */
  loadAll: () => Promise<void>;

  /** Lookup pontual; busca em cache, fallback DB. */
  findByPhone: (phone: string) => Promise<UnifiedCustomer | null>;
  findByCpf: (cpf: string) => Promise<UnifiedCustomer | null>;
  findByInstagram: (handle: string) => Promise<UnifiedCustomer | null>;
  findByEmail: (email: string) => Promise<UnifiedCustomer | null>;
  findById: (id: string) => Promise<UnifiedCustomer | null>;

  /** Sincrônico: usa apenas cache. Retorna undefined se ainda não carregado. */
  getCachedByPhone: (phone: string) => UnifiedCustomer | undefined;
  getCachedByCpf: (cpf: string) => UnifiedCustomer | undefined;
  getCachedByInstagram: (handle: string) => UnifiedCustomer | undefined;
}

function indexCustomer(state: UnifiedCustomerStore, c: UnifiedCustomer) {
  state.byId.set(c.id, c);
  if (c.phone_suffix8) state.bySuffix.set(c.phone_suffix8, c);
  if (c.cpf) state.byCpf.set(c.cpf, c);
  const ig = normIg(c.instagram_handle);
  if (ig) state.byInstagram.set(ig, c);
  const em = normEmail(c.email);
  if (em) state.byEmail.set(em, c);
}

export const useUnifiedCustomerStore = create<UnifiedCustomerStore>()((set, get) => ({
  bySuffix: new Map(),
  byCpf: new Map(),
  byInstagram: new Map(),
  byEmail: new Map(),
  byId: new Map(),
  isLoaded: false,
  isLoading: false,

  loadAll: async () => {
    if (get().isLoaded || get().isLoading) return;
    set({ isLoading: true });
    try {
      const PAGE = 1000;
      let from = 0;
      const bySuffix = new Map<string, UnifiedCustomer>();
      const byCpf = new Map<string, UnifiedCustomer>();
      const byInstagram = new Map<string, UnifiedCustomer>();
      const byEmail = new Map<string, UnifiedCustomer>();
      const byId = new Map<string, UnifiedCustomer>();

      while (true) {
        const { data, error } = await supabase
          .from('customers_unified')
          .select('*')
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const c of data as UnifiedCustomer[]) {
          byId.set(c.id, c);
          if (c.phone_suffix8) bySuffix.set(c.phone_suffix8, c);
          if (c.cpf) byCpf.set(c.cpf, c);
          const ig = normIg(c.instagram_handle);
          if (ig) byInstagram.set(ig, c);
          const em = normEmail(c.email);
          if (em) byEmail.set(em, c);
        }
        if (data.length < PAGE) break;
        from += PAGE;
      }

      set({ bySuffix, byCpf, byInstagram, byEmail, byId, isLoaded: true });
    } catch (e) {
      console.error('[unifiedCustomerStore] loadAll error', e);
      toast.error('Erro ao carregar base unificada de clientes');
    } finally {
      set({ isLoading: false });
    }
  },

  findByPhone: async (phone) => {
    const suffix = phoneSuffix8(phone);
    if (!suffix) return null;
    const cached = get().bySuffix.get(suffix);
    if (cached) return cached;
    const { data } = await supabase
      .from('customers_unified')
      .select('*')
      .eq('phone_suffix8', suffix)
      .limit(1)
      .maybeSingle();
    if (data) {
      set((s) => {
        const next = { ...s, bySuffix: new Map(s.bySuffix), byId: new Map(s.byId) };
        indexCustomer(next as UnifiedCustomerStore, data as UnifiedCustomer);
        return next;
      });
      return data as UnifiedCustomer;
    }
    return null;
  },

  findByCpf: async (cpf) => {
    const c = normCpf(cpf);
    if (!c) return null;
    const cached = get().byCpf.get(c);
    if (cached) return cached;
    const { data } = await supabase
      .from('customers_unified')
      .select('*')
      .eq('cpf', c)
      .limit(1)
      .maybeSingle();
    if (data) {
      set((s) => {
        const next = {
          ...s,
          byCpf: new Map(s.byCpf),
          bySuffix: new Map(s.bySuffix),
          byInstagram: new Map(s.byInstagram),
          byEmail: new Map(s.byEmail),
          byId: new Map(s.byId),
        };
        indexCustomer(next as UnifiedCustomerStore, data as UnifiedCustomer);
        return next;
      });
      return data as UnifiedCustomer;
    }
    return null;
  },

  findByInstagram: async (handle) => {
    const ig = normIg(handle);
    if (!ig) return null;
    const cached = get().byInstagram.get(ig);
    if (cached) return cached;
    const { data } = await supabase
      .from('customers_unified')
      .select('*')
      .ilike('instagram_handle', ig)
      .limit(1)
      .maybeSingle();
    if (data) {
      set((s) => {
        const next = {
          ...s,
          byInstagram: new Map(s.byInstagram),
          bySuffix: new Map(s.bySuffix),
          byCpf: new Map(s.byCpf),
          byEmail: new Map(s.byEmail),
          byId: new Map(s.byId),
        };
        indexCustomer(next as UnifiedCustomerStore, data as UnifiedCustomer);
        return next;
      });
      return data as UnifiedCustomer;
    }
    return null;
  },

  findByEmail: async (email) => {
    const e = normEmail(email);
    if (!e) return null;
    const cached = get().byEmail.get(e);
    if (cached) return cached;
    const { data } = await supabase
      .from('customers_unified')
      .select('*')
      .ilike('email', e)
      .limit(1)
      .maybeSingle();
    if (data) {
      set((s) => {
        const next = {
          ...s,
          byEmail: new Map(s.byEmail),
          bySuffix: new Map(s.bySuffix),
          byCpf: new Map(s.byCpf),
          byInstagram: new Map(s.byInstagram),
          byId: new Map(s.byId),
        };
        indexCustomer(next as UnifiedCustomerStore, data as UnifiedCustomer);
        return next;
      });
      return data as UnifiedCustomer;
    }
    return null;
  },

  findById: async (id) => {
    const cached = get().byId.get(id);
    if (cached) return cached;
    const { data } = await supabase
      .from('customers_unified')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (data) {
      set((s) => {
        const next = {
          ...s,
          byId: new Map(s.byId),
          bySuffix: new Map(s.bySuffix),
          byCpf: new Map(s.byCpf),
          byInstagram: new Map(s.byInstagram),
          byEmail: new Map(s.byEmail),
        };
        indexCustomer(next as UnifiedCustomerStore, data as UnifiedCustomer);
        return next;
      });
      return data as UnifiedCustomer;
    }
    return null;
  },

  getCachedByPhone: (phone) => {
    const suffix = phoneSuffix8(phone);
    return suffix ? get().bySuffix.get(suffix) : undefined;
  },
  getCachedByCpf: (cpf) => {
    const c = normCpf(cpf);
    return c ? get().byCpf.get(c) : undefined;
  },
  getCachedByInstagram: (handle) => {
    const ig = normIg(handle);
    return ig ? get().byInstagram.get(ig) : undefined;
  },
}));
