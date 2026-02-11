import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';

export interface WhatsAppNumber {
  id: string;
  label: string;
  phone_display: string;
  phone_number_id: string;
  business_account_id: string;
  is_default: boolean;
  is_active: boolean;
  provider?: string;
}

interface WhatsAppNumberStore {
  numbers: WhatsAppNumber[];
  selectedNumberId: string | null;
  isLoading: boolean;
  fetchNumbers: () => Promise<void>;
  setSelectedNumberId: (id: string | null) => void;
  getSelectedNumber: () => WhatsAppNumber | null;
  getDefaultNumber: () => WhatsAppNumber | null;
}

const STORAGE_KEY = 'whatsapp_selected_number_id';

export const useWhatsAppNumberStore = create<WhatsAppNumberStore>((set, get) => ({
  numbers: [],
  selectedNumberId: localStorage.getItem(STORAGE_KEY) || null,
  isLoading: false,

  fetchNumbers: async () => {
    set({ isLoading: true });
    const { data, error } = await supabase
      .from('whatsapp_numbers')
      .select('id, label, phone_display, phone_number_id, business_account_id, is_default, is_active, provider')
      .eq('is_active', true)
      .order('is_default', { ascending: false });

    if (error) {
      console.error('Error fetching WhatsApp numbers:', error);
      set({ isLoading: false });
      return;
    }

    const numbers = (data || []) as WhatsAppNumber[];
    const savedId = get().selectedNumberId;
    const savedExists = savedId && numbers.some(n => n.id === savedId);
    const defaultNum = numbers.find(n => n.is_default);
    
    const resolvedId = savedExists ? savedId : (defaultNum?.id || numbers[0]?.id || null);
    
    set({
      numbers,
      selectedNumberId: resolvedId,
      isLoading: false,
    });
    
    if (resolvedId) localStorage.setItem(STORAGE_KEY, resolvedId);
  },

  setSelectedNumberId: (id) => {
    set({ selectedNumberId: id });
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  },

  getSelectedNumber: () => {
    const { numbers, selectedNumberId } = get();
    return numbers.find(n => n.id === selectedNumberId) || null;
  },

  getDefaultNumber: () => {
    const { numbers } = get();
    return numbers.find(n => n.is_default) || numbers[0] || null;
  },
}));
