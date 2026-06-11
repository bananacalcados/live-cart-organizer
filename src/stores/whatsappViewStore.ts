import { create } from "zustand";

interface WhatsAppViewState {
  /** Número de instâncias do chat de WhatsApp montadas/ativas no momento. */
  activeCount: number;
  enter: () => void;
  leave: () => void;
}

/**
 * Sinaliza quando QUALQUER tela de chat de WhatsApp está aberta na página.
 * Usado para esconder o botão flutuante de tarefas (post-its) por cima do chat.
 */
export const useWhatsAppViewStore = create<WhatsAppViewState>((set) => ({
  activeCount: 0,
  enter: () => set((s) => ({ activeCount: s.activeCount + 1 })),
  leave: () => set((s) => ({ activeCount: Math.max(0, s.activeCount - 1) })),
}));
