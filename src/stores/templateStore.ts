import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import { OrderStage } from '@/types/order';

export interface MessageTemplate {
  id: string;
  name: string;
  message: string;
  stage: OrderStage | 'all';
  created_at: string;
  updated_at: string;
}

interface TemplateStore {
  templates: MessageTemplate[];
  isLoading: boolean;
  fetchTemplates: () => Promise<void>;
  addTemplate: (template: Omit<MessageTemplate, 'id' | 'created_at' | 'updated_at'>) => Promise<void>;
  updateTemplate: (id: string, updates: Partial<MessageTemplate>) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  getTemplatesByStage: (stage: OrderStage) => MessageTemplate[];
}

export const useTemplateStore = create<TemplateStore>((set, get) => ({
  templates: [],
  isLoading: false,

  fetchTemplates: async () => {
    set({ isLoading: true });
    try {
      const { data, error } = await supabase
        .from('message_templates')
        .select('*')
        .order('created_at', { ascending: true });

      if (error) throw error;
      
      set({ templates: data as MessageTemplate[] });
    } catch (error) {
      console.error('Error fetching templates:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  addTemplate: async (template) => {
    try {
      const { data, error } = await supabase
        .from('message_templates')
        .insert({
          name: template.name,
          message: template.message,
          stage: template.stage,
        })
        .select()
        .single();

      if (error) throw error;

      set((state) => ({ 
        templates: [...state.templates, data as MessageTemplate] 
      }));
    } catch (error) {
      console.error('Error adding template:', error);
      throw error;
    }
  },

  updateTemplate: async (id, updates) => {
    try {
      const { error } = await supabase
        .from('message_templates')
        .update({
          name: updates.name,
          message: updates.message,
          stage: updates.stage,
        })
        .eq('id', id);

      if (error) throw error;

      set((state) => ({
        templates: state.templates.map((t) =>
          t.id === id ? { ...t, ...updates } : t
        ),
      }));
    } catch (error) {
      console.error('Error updating template:', error);
      throw error;
    }
  },

  deleteTemplate: async (id) => {
    try {
      const { error } = await supabase
        .from('message_templates')
        .delete()
        .eq('id', id);

      if (error) throw error;

      set((state) => ({
        templates: state.templates.filter((t) => t.id !== id),
      }));
    } catch (error) {
      console.error('Error deleting template:', error);
      throw error;
    }
  },

  getTemplatesByStage: (stage) => {
    return get().templates.filter((t) => t.stage === stage || t.stage === 'all');
  },
}));

// Helper function to replace variables in a template
export function applyTemplateVariables(
  template: string,
  variables: {
    nome?: string;
    instagram?: string;
    whatsapp?: string;
    link_carrinho?: string;
    total?: string;
    produtos?: string;
  }
): string {
  let result = template;
  
  if (variables.nome) {
    result = result.replace(/\{\{nome\}\}/gi, variables.nome);
  }
  if (variables.instagram) {
    result = result.replace(/\{\{instagram\}\}/gi, variables.instagram);
  }
  if (variables.whatsapp) {
    result = result.replace(/\{\{whatsapp\}\}/gi, variables.whatsapp);
  }
  if (variables.link_carrinho) {
    result = result.replace(/\{\{link_carrinho\}\}/gi, variables.link_carrinho);
  }
  if (variables.total) {
    result = result.replace(/\{\{total\}\}/gi, variables.total);
  }
  if (variables.produtos) {
    result = result.replace(/\{\{produtos\}\}/gi, variables.produtos);
  }
  
  return result;
}
