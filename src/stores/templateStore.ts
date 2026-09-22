import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import { OrderStage } from '@/types/order';

export interface MessageTemplate {
  id: string;
  name: string;
  message: string;
  stage: OrderStage | 'all';
  /** 0 = nenhuma; 1 = dados, 2 = CPF/e-mail, 3 = pagamento */
  funnel_step: number;
  /** Redações alternativas da MESMA pergunta (rodízio anti-spam) */
  variants: string[];
  created_at: string;
  updated_at: string;
}

export const FUNNEL_STEPS = [
  { value: 0, label: 'Nenhuma etapa' },
  { value: 1, label: 'Etapa 1 — Nome e endereço' },
  { value: 2, label: 'Etapa 2 — CPF e e-mail' },
  { value: 3, label: 'Etapa 3 — Forma de pagamento' },
] as const;

interface TemplateStore {
  templates: MessageTemplate[];
  isLoading: boolean;
  fetchTemplates: () => Promise<void>;
  addTemplate: (template: Omit<MessageTemplate, 'id' | 'created_at' | 'updated_at'>) => Promise<void>;
  updateTemplate: (id: string, updates: Partial<MessageTemplate>) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  getTemplatesByStage: (stage: OrderStage) => MessageTemplate[];
  getTemplatesByStep: (step: number) => MessageTemplate[];
}

/** Normaliza a linha do banco: variants sempre array de texto não vazio. */
function normalizeTemplate(row: any): MessageTemplate {
  const raw = Array.isArray(row?.variants) ? row.variants : [];
  const variants = raw
    .map((v: unknown) => (typeof v === 'string' ? v : String(v ?? '')))
    .filter((v: string) => v.trim().length > 0);
  return {
    ...row,
    funnel_step: Number(row?.funnel_step ?? 0) || 0,
    variants: variants.length ? variants : [row?.message ?? ''],
  } as MessageTemplate;
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
      
      set({ templates: (data || []).map(normalizeTemplate) });
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
          funnel_step: template.funnel_step ?? 0,
          variants: (template.variants?.length ? template.variants : [template.message]) as any,
        })
        .select()
        .single();

      if (error) throw error;

      set((state) => ({
        templates: [...state.templates, normalizeTemplate(data)],
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
          funnel_step: updates.funnel_step ?? 0,
          variants: (updates.variants?.length ? updates.variants : [updates.message || '']) as any,
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
    return get().templates.filter((t) => {
      if (t.stage === 'all') return true;
      // Support comma-separated multi-stage values
      const stages = t.stage.split(',');
      return stages.includes(stage);
    });
  },
}));

// Emoji categories for automatic variation
export const EMOJI_CATEGORIES = {
  feliz: ['😊', '😄', '🙂', '😁', '☺️', '😃', '🤗', '😀'],
  triste: ['😢', '😔', '🥺', '😞', '😿', '💔', '😥', '🙁'],
  comemoracao: ['🎉', '🥳', '🎊', '✨', '🎈', '🎁', '🙌', '💫', '🎇'],
  amor: ['❤️', '💕', '💖', '💗', '💓', '🥰', '😍', '💘'],
  ok: ['👍', '✅', '👌', '💪', '🤝', '✔️', '🙏', '👏'],
  ola: ['👋', '🙋', '🙋‍♀️', '🙋‍♂️', '✌️', '🤙', '💁', '👐'],
  dinheiro: ['💰', '💵', '💸', '🤑', '💲', '💳', '🏦', '💎'],
  envio: ['📦', '🚚', '✈️', '🛒', '📬', '📮', '🎁', '🚀'],
  urgente: ['⚡', '🔥', '⏰', '🚨', '⚠️', '❗', '‼️', '📢'],
  agradecimento: ['🙏', '💐', '🌟', '⭐', '🌹', '💝', '🤩', '😇'],
};

// Get random emoji from category
function getRandomEmoji(category: keyof typeof EMOJI_CATEGORIES): string {
  const emojis = EMOJI_CATEGORIES[category];
  return emojis[Math.floor(Math.random() * emojis.length)];
}

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
  
  // Replace emoji variables first (with random selection)
  result = result.replace(/\{\{emoji_feliz\}\}/gi, () => getRandomEmoji('feliz'));
  result = result.replace(/\{\{emoji_triste\}\}/gi, () => getRandomEmoji('triste'));
  result = result.replace(/\{\{emoji_comemoracao\}\}/gi, () => getRandomEmoji('comemoracao'));
  result = result.replace(/\{\{emoji_amor\}\}/gi, () => getRandomEmoji('amor'));
  result = result.replace(/\{\{emoji_ok\}\}/gi, () => getRandomEmoji('ok'));
  result = result.replace(/\{\{emoji_ola\}\}/gi, () => getRandomEmoji('ola'));
  result = result.replace(/\{\{emoji_dinheiro\}\}/gi, () => getRandomEmoji('dinheiro'));
  result = result.replace(/\{\{emoji_envio\}\}/gi, () => getRandomEmoji('envio'));
  result = result.replace(/\{\{emoji_urgente\}\}/gi, () => getRandomEmoji('urgente'));
  result = result.replace(/\{\{emoji_agradecimento\}\}/gi, () => getRandomEmoji('agradecimento'));
  
  // Replace regular variables (always replace, even if empty)
  result = result.replace(/\{\{nome\}\}/gi, variables.nome || '');
  result = result.replace(/\{\{instagram\}\}/gi, variables.instagram || '');
  result = result.replace(/\{\{whatsapp\}\}/gi, variables.whatsapp || '');
  result = result.replace(/\{\{link_carrinho\}\}/gi, variables.link_carrinho || '');
  result = result.replace(/\{\{total\}\}/gi, variables.total || '');
  result = result.replace(/\{\{produtos\}\}/gi, variables.produtos || '');
  
  return result;
}
