import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { OrderStage } from '@/types/order';

export interface MessageTemplate {
  id: string;
  name: string;
  message: string;
  stage: OrderStage | 'all';
  createdAt: Date;
}

interface TemplateStore {
  templates: MessageTemplate[];
  addTemplate: (template: Omit<MessageTemplate, 'id' | 'createdAt'>) => void;
  updateTemplate: (id: string, updates: Partial<MessageTemplate>) => void;
  deleteTemplate: (id: string) => void;
  getTemplatesByStage: (stage: OrderStage) => MessageTemplate[];
}

const generateId = () => Math.random().toString(36).substring(2, 15);

// Default templates with useful variables
const defaultTemplates: MessageTemplate[] = [
  {
    id: 'default-1',
    name: 'Boas-vindas',
    message: 'Olá {{nome}}! 👋\n\nVi seu interesse nos nossos produtos. Como posso ajudar?',
    stage: 'new',
    createdAt: new Date(),
  },
  {
    id: 'default-2',
    name: 'Enviar Link do Carrinho',
    message: 'Oi {{nome}}! 🛒\n\nSeu carrinho está pronto! Acesse aqui:\n{{link_carrinho}}\n\nTotal: R$ {{total}}\n\nQualquer dúvida estou à disposição!',
    stage: 'link_sent',
    createdAt: new Date(),
  },
  {
    id: 'default-3',
    name: 'Lembrete de Pagamento',
    message: 'Oi {{nome}}! 😊\n\nPassando para lembrar do seu pedido:\n{{produtos}}\n\nTotal: R$ {{total}}\n\nPosso ajudar com algo?',
    stage: 'awaiting_payment',
    createdAt: new Date(),
  },
  {
    id: 'default-4',
    name: 'Confirmação de Pagamento',
    message: 'Oba, {{nome}}! 🎉\n\nPagamento confirmado! Seu pedido já está sendo preparado.\n\nObrigado pela compra!',
    stage: 'paid',
    createdAt: new Date(),
  },
  {
    id: 'default-5',
    name: 'Pedido Enviado',
    message: 'Oi {{nome}}! 📦\n\nSeu pedido foi enviado!\n\nEm breve você receberá o código de rastreio.\n\nObrigado pela preferência!',
    stage: 'shipped',
    createdAt: new Date(),
  },
];

export const useTemplateStore = create<TemplateStore>()(
  persist(
    (set, get) => ({
      templates: defaultTemplates,

      addTemplate: (template) => {
        const newTemplate: MessageTemplate = {
          ...template,
          id: generateId(),
          createdAt: new Date(),
        };
        set((state) => ({ templates: [...state.templates, newTemplate] }));
      },

      updateTemplate: (id, updates) => {
        set((state) => ({
          templates: state.templates.map((t) =>
            t.id === id ? { ...t, ...updates } : t
          ),
        }));
      },

      deleteTemplate: (id) => {
        set((state) => ({
          templates: state.templates.filter((t) => t.id !== id),
        }));
      },

      getTemplatesByStage: (stage) => {
        return get().templates.filter((t) => t.stage === stage || t.stage === 'all');
      },
    }),
    {
      name: 'live-crm-templates',
      storage: createJSONStorage(() => localStorage),
    }
  )
);

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
