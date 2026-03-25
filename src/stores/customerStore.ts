import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import { DbCustomer } from '@/types/database';
import { toast } from 'sonner';

// Normalize Instagram handle for comparison
const normalizeInstagram = (handle: string): string => {
  return handle.toLowerCase().replace(/^@/, '').trim();
};

interface CustomerStore {
  customers: DbCustomer[];
  isLoading: boolean;
  fetchCustomers: () => Promise<void>;
  findCustomerByInstagram: (handle: string) => DbCustomer | undefined;
  findCustomerByWhatsApp: (whatsapp: string) => DbCustomer | undefined;
  createOrUpdateCustomer: (instagramHandle: string, whatsapp?: string) => Promise<DbCustomer | null>;
  banCustomer: (id: string, reason?: string) => Promise<void>;
  unbanCustomer: (id: string) => Promise<void>;
  updateCustomer: (id: string, updates: Partial<DbCustomer>) => Promise<void>;
  addTagToCustomer: (id: string, tag: string) => Promise<void>;
  removeTagFromCustomer: (id: string, tag: string) => Promise<void>;
}

export const useCustomerStore = create<CustomerStore>()((set, get) => ({
  customers: [],
  isLoading: false,

  fetchCustomers: async () => {
    set({ isLoading: true });
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      set({ customers: data || [] });
    } catch (error) {
      console.error('Error fetching customers:', error);
      toast.error('Erro ao carregar clientes');
    } finally {
      set({ isLoading: false });
    }
  },

  findCustomerByInstagram: (handle) => {
    const normalized = normalizeInstagram(handle);
    return get().customers.find(
      (c) => normalizeInstagram(c.instagram_handle) === normalized
    );
  },

  findCustomerByWhatsApp: (whatsapp) => {
    const normalized = whatsapp.replace(/\D/g, '').trim();
    if (!normalized) return undefined;
    return get().customers.find(
      (c) => c.whatsapp && c.whatsapp.replace(/\D/g, '') === normalized
    );
  },

  createOrUpdateCustomer: async (instagramHandle, whatsapp) => {
    const formattedHandle = instagramHandle.startsWith('@') 
      ? instagramHandle 
      : `@${instagramHandle}`;

    try {
      // Check local cache first
      let existing = get().findCustomerByInstagram(instagramHandle);
      
      // If not in cache, try DB lookup
      if (!existing) {
        const { data: dbCustomer } = await supabase
          .from('customers')
          .select('*')
          .ilike('instagram_handle', formattedHandle)
          .maybeSingle();
        
        if (dbCustomer) {
          existing = dbCustomer;
          // Add to local cache
          set((state) => {
            const exists = state.customers.some(c => c.id === dbCustomer.id);
            return exists ? state : { customers: [dbCustomer, ...state.customers] };
          });
        }
      }

      if (existing) {
        // Update whatsapp if provided and different
        if (whatsapp && whatsapp !== existing.whatsapp) {
          const { data, error } = await supabase
            .from('customers')
            .update({ whatsapp })
            .eq('id', existing.id)
            .select()
            .single();

          if (error) throw error;
          
          set((state) => ({
            customers: state.customers.map((c) => 
              c.id === existing!.id ? data : c
            )
          }));
          
          return data;
        }
        return existing;
      }

      // Create new customer
      const { data, error } = await supabase
        .from('customers')
        .insert({ 
          instagram_handle: formattedHandle,
          whatsapp 
        })
        .select()
        .single();

      if (error) {
        // Handle unique constraint violation - customer exists but wasn't found
        if (error.code === '23505') {
          const { data: existingData } = await supabase
            .from('customers')
            .select('*')
            .ilike('instagram_handle', formattedHandle)
            .maybeSingle();
          
          if (existingData) {
            set((state) => {
              const exists = state.customers.some(c => c.id === existingData.id);
              return exists ? state : { customers: [existingData, ...state.customers] };
            });
            if (whatsapp && whatsapp !== existingData.whatsapp) {
              await supabase.from('customers').update({ whatsapp }).eq('id', existingData.id);
              return { ...existingData, whatsapp };
            }
            return existingData;
          }
        }
        throw error;
      }
      
      set((state) => ({ customers: [data, ...state.customers] }));
      return data;
    } catch (error) {
      console.error('Error creating/updating customer:', error);
      toast.error('Erro ao salvar cliente');
      return null;
    }
  },

  banCustomer: async (id, reason) => {
    try {
      const { error } = await supabase
        .from('customers')
        .update({ is_banned: true, ban_reason: reason })
        .eq('id', id);

      if (error) throw error;
      
      set((state) => ({
        customers: state.customers.map((c) => 
          c.id === id ? { ...c, is_banned: true, ban_reason: reason } : c
        )
      }));
      
      toast.success('Cliente banido!');
    } catch (error) {
      console.error('Error banning customer:', error);
      toast.error('Erro ao banir cliente');
    }
  },

  unbanCustomer: async (id) => {
    try {
      const { error } = await supabase
        .from('customers')
        .update({ is_banned: false, ban_reason: null })
        .eq('id', id);

      if (error) throw error;
      
      set((state) => ({
        customers: state.customers.map((c) => 
          c.id === id ? { ...c, is_banned: false, ban_reason: undefined } : c
        )
      }));
      
      toast.success('Cliente desbanido!');
    } catch (error) {
      console.error('Error unbanning customer:', error);
      toast.error('Erro ao desbanir cliente');
    }
  },

  updateCustomer: async (id, updates) => {
    try {
      const { error } = await supabase
        .from('customers')
        .update(updates)
        .eq('id', id);

      if (error) throw error;
      
      set((state) => ({
        customers: state.customers.map((c) => 
          c.id === id ? { ...c, ...updates } : c
        )
      }));
    } catch (error) {
      console.error('Error updating customer:', error);
      toast.error('Erro ao atualizar cliente');
    }
  },

  addTagToCustomer: async (id, tag) => {
    const customer = get().customers.find(c => c.id === id);
    if (!customer) return;

    const currentTags = customer.tags || [];
    if (currentTags.includes(tag)) return;

    const newTags = [...currentTags, tag];
    
    try {
      const { error } = await supabase
        .from('customers')
        .update({ tags: newTags })
        .eq('id', id);

      if (error) throw error;
      
      set((state) => ({
        customers: state.customers.map((c) => 
          c.id === id ? { ...c, tags: newTags } : c
        )
      }));
    } catch (error) {
      console.error('Error adding tag:', error);
      toast.error('Erro ao adicionar tag');
    }
  },

  removeTagFromCustomer: async (id, tag) => {
    const customer = get().customers.find(c => c.id === id);
    if (!customer) return;

    const currentTags = customer.tags || [];
    const newTags = currentTags.filter(t => t !== tag);
    
    try {
      const { error } = await supabase
        .from('customers')
        .update({ tags: newTags })
        .eq('id', id);

      if (error) throw error;
      
      set((state) => ({
        customers: state.customers.map((c) => 
          c.id === id ? { ...c, tags: newTags } : c
        )
      }));
    } catch (error) {
      console.error('Error removing tag:', error);
      toast.error('Erro ao remover tag');
    }
  },
}));
