import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { supabase } from '@/integrations/supabase/client';
import { DbEvent } from '@/types/database';
import { toast } from 'sonner';

interface EventStore {
  events: DbEvent[];
  currentEventId: string | null;
  isLoading: boolean;
  fetchEvents: () => Promise<void>;
  createEvent: (name: string, description?: string) => Promise<string | null>;
  updateEvent: (id: string, updates: Partial<DbEvent>) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;
  setCurrentEvent: (id: string | null) => void;
  getCurrentEvent: () => DbEvent | null;
}

export const useEventStore = create<EventStore>()(
  persist(
    (set, get) => ({
      events: [],
      currentEventId: null,
      isLoading: false,

      fetchEvents: async () => {
        set({ isLoading: true });
        try {
          const { data, error } = await supabase
            .from('events')
            .select('*')
            .order('created_at', { ascending: false });

          if (error) throw error;
          set({ events: data || [] });
        } catch (error) {
          console.error('Error fetching events:', error);
          toast.error('Erro ao carregar eventos');
        } finally {
          set({ isLoading: false });
        }
      },

      createEvent: async (name, description) => {
        try {
          const { data, error } = await supabase
            .from('events')
            .insert({ name, description })
            .select()
            .single();

          if (error) throw error;
          
          set((state) => ({ 
            events: [data, ...state.events],
            currentEventId: data.id
          }));
          
          toast.success('Evento criado!');
          return data.id;
        } catch (error) {
          console.error('Error creating event:', error);
          toast.error('Erro ao criar evento');
          return null;
        }
      },

      updateEvent: async (id, updates) => {
        try {
          const { error } = await supabase
            .from('events')
            .update(updates)
            .eq('id', id);

          if (error) throw error;
          
          set((state) => ({
            events: state.events.map((e) => 
              e.id === id ? { ...e, ...updates } : e
            )
          }));
          
          toast.success('Evento atualizado!');
        } catch (error) {
          console.error('Error updating event:', error);
          toast.error('Erro ao atualizar evento');
        }
      },

      deleteEvent: async (id) => {
        try {
          const { error } = await supabase
            .from('events')
            .delete()
            .eq('id', id);

          if (error) throw error;
          
          set((state) => ({
            events: state.events.filter((e) => e.id !== id),
            currentEventId: state.currentEventId === id ? null : state.currentEventId
          }));
          
          toast.success('Evento excluído!');
        } catch (error) {
          console.error('Error deleting event:', error);
          toast.error('Erro ao excluir evento');
        }
      },

      setCurrentEvent: (id) => {
        set({ currentEventId: id });
      },

      getCurrentEvent: () => {
        const { events, currentEventId } = get();
        return events.find((e) => e.id === currentEventId) || null;
      },
    }),
    {
      name: 'live-crm-current-event',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ currentEventId: state.currentEventId }),
    }
  )
);
