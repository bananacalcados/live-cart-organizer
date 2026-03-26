import { create } from 'zustand';
import { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { DbOrder, DbOrderProduct, DbCustomer, DiscountType } from '@/types/database';
import { OrderStage, isOrderComplete } from '@/types/order';
import { toast } from 'sonner';
import { Json } from '@/integrations/supabase/types';
import { fetchDbOrderById, mapDbOrder, mergeDbOrder } from './dbOrderRealtime';

// Helper to convert products array to Json type
const productsToJson = (products: DbOrderProduct[]): Json => {
  return products as unknown as Json;
};

// Notify external agent when payment is confirmed
const notifyPaymentConfirmed = async (orderId: string, source: string = 'events-kanban') => {
  try {
    const { data, error } = await supabase.functions.invoke('payment-confirmed-hook', {
      body: {
        pedido_id: orderId,
        loja: 'centro',
        source,
      },
    });

    if (error) {
      throw error;
    }

    console.log(`[payment-webhook] Notified agent for order ${orderId}`, data);
  } catch (err) {
    console.error('[payment-webhook] Failed to notify agent:', err);
  }
};

interface DbOrderStore {
  orders: DbOrder[];
  isLoading: boolean;
  fetchOrdersByEvent: (eventId: string) => Promise<void>;
  createOrder: (eventId: string, customer: DbCustomer, products?: DbOrderProduct[]) => Promise<DbOrder | null>;
  updateOrder: (orderId: string, updates: Partial<DbOrder>) => Promise<void>;
  deleteOrder: (orderId: string) => Promise<void>;
  moveOrder: (orderId: string, newStage: OrderStage) => void;
  addProductToOrder: (orderId: string, product: DbOrderProduct) => Promise<void>;
  removeProductFromOrder: (orderId: string, productId: string) => Promise<void>;
  updateProductQuantity: (orderId: string, productId: string, quantity: number) => Promise<void>;
  setHasUnreadMessages: (orderId: string, hasUnread: boolean) => Promise<void>;
  setLastCustomerMessageAt: (orderId: string, timestamp: Date) => Promise<void>;
  setLastSentMessageAt: (orderId: string, timestamp: Date) => Promise<void>;
  checkNoResponseOrders: () => Promise<void>;
  findOrderByCustomerInEvent: (eventId: string, customerId: string) => DbOrder | undefined;
  findActiveOrderByCustomer: (eventId: string, customerId: string) => DbOrder | undefined;
  getUnpaidOrdersCount: (eventId?: string) => number;
  regenerateCartLink: (orderId: string) => Promise<void>;
  upsertOrderRealtime: (order: DbOrder) => void;
  removeOrderRealtime: (orderId: string) => void;
  subscribeToEventOrders: (eventId: string) => () => void;
}

export const useDbOrderStore = create<DbOrderStore>()((set, get) => ({
  orders: [],
  isLoading: false,

  fetchOrdersByEvent: async (eventId) => {
    set({ isLoading: true });
    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          customer:customers(*)
        `)
        .eq('event_id', eventId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      const orders = (data || []).map(mapDbOrder) as DbOrder[];

      set({ orders });
    } catch (error) {
      console.error('Error fetching orders:', error);
      toast.error('Erro ao carregar pedidos');
    } finally {
      set({ isLoading: false });
    }
  },

  createOrder: async (eventId, customer, products = []) => {
    try {
      // If no products, try to auto-fill from event's active product
      if (products.length === 0) {
        try {
          const { data: eventData } = await supabase
            .from('events')
            .select('catalog_lead_page_id, active_product_delay_seconds')
            .eq('id', eventId)
            .single();

          if (eventData?.catalog_lead_page_id) {
            const { data: page } = await supabase
              .from('catalog_lead_pages')
              .select('selected_product_ids')
              .eq('id', eventData.catalog_lead_page_id)
              .single();

            const activeIds = (page as any)?.selected_product_ids as string[] || [];
            if (activeIds.length > 0) {
              // The first product in the list is the "active" product
              // Delay logic: we trust the presenter already set it correctly
              // (the delay is handled by the bar — product changes are delayed)
              try {
                const { fetchProducts: fetchShopify } = await import('@/lib/shopify');
                const activeGid = activeIds[0];
                const numericId = activeGid.split('/').pop() || activeGid;
                const raw = await fetchShopify(1, `id:${numericId}`);
                if (raw.length > 0) {
                  const p = raw[0].node;
                  const firstVariant = p.variants.edges[0]?.node;
                  if (firstVariant) {
                    products = [{
                      id: crypto.randomUUID(),
                      shopifyId: p.id,
                      title: p.title,
                      variant: firstVariant.title || 'Default',
                      price: Number(firstVariant.price.amount),
                      compareAtPrice: firstVariant.compareAtPrice ? Number(firstVariant.compareAtPrice.amount) : undefined,
                      quantity: 1,
                      image: firstVariant.image?.url || p.images.edges[0]?.node.url || undefined,
                      sku: firstVariant.sku || undefined,
                    }];
                  }
                }
              } catch (e) {
                console.error('Error auto-filling active product:', e);
              }
            }
          }
        } catch {}
      }

      // Cart link will be set after insert (needs orderId for transparent checkout)

      // Shipping is now calculated dynamically at checkout — no longer applied from event config

      const { data, error } = await supabase
        .from('orders')
        .insert({
          event_id: eventId,
          customer_id: customer.id,
          products: productsToJson(products),
          stage: 'incomplete_order',
          free_shipping: false,
          shipping_cost: 0,
        })
        .select(`
          *,
          customer:customers(*)
        `)
        .single();

      if (error) throw error;

      // Generate transparent checkout link using the new order ID
      const cartLink = `https://checkout.bananacalcados.com.br/checkout/order/${data.id}`;
      await supabase
        .from('orders')
        .update({ cart_link: cartLink })
        .eq('id', data.id);
      
      const order = {
        ...data,
        cart_link: cartLink,
        products: data.products as unknown as DbOrderProduct[],
        customer: data.customer as DbCustomer,
        discount_type: data.discount_type as DiscountType | undefined,
      } as DbOrder;
      
      set((state) => ({ orders: [order, ...state.orders] }));

      // Auto-tag customer with event name
      try {
        const { data: eventData } = await supabase
          .from('events')
          .select('name')
          .eq('id', eventId)
          .single();
        
        if (eventData?.name) {
          const currentTags = customer.tags || [];
          const eventTag = eventData.name;
          if (!currentTags.includes(eventTag)) {
            await supabase
              .from('customers')
              .update({ tags: [...currentTags, eventTag] })
              .eq('id', customer.id);
          }
        }
      } catch (tagError) {
        console.error('Error auto-tagging customer:', tagError);
      }

      toast.success('Pedido criado!');
      return order;
    } catch (error) {
      console.error('Error creating order:', error);
      toast.error('Erro ao criar pedido');
      return null;
    }
  },

  updateOrder: async (orderId, updates) => {
    try {
      // Build DB updates: convert products and remove joined/non-column fields
      const { customer, id, event_id, customer_id, created_at, updated_at, ...rest } = updates as any;
      const dbUpdates: Record<string, unknown> = { ...rest };
      if (updates.products) {
        dbUpdates.products = productsToJson(updates.products);
      }

      const { data, error } = await supabase
        .from('orders')
        .update(dbUpdates)
        .eq('id', orderId)
        .select('*')
        .single();

      if (error) throw error;
      if (!data) throw new Error('Pedido não retornado após atualização');

      // Check if is_paid just transitioned to true and keep stage consistent
      const prevOrder = get().orders.find((o) => o.id === orderId);
      if (data.is_paid && prevOrder && !prevOrder.is_paid) {
        notifyPaymentConfirmed(orderId, 'events-manual-confirmation');
      }

      if (data.is_paid && data.stage === 'awaiting_payment') {
        data.stage = 'paid';
      }

      set((state) => ({
        orders: state.orders.map((o) =>
          o.id === orderId
            ? {
                ...o,
                ...data,
                products: (data.products as unknown as DbOrderProduct[]) ?? o.products,
                customer: o.customer,
                discount_type: data.discount_type as DiscountType | undefined,
              }
            : o
        )
      }));
    } catch (error) {
      console.error('Error updating order:', error);
      toast.error('Erro ao atualizar pedido');
      throw error;
    }
  },

  deleteOrder: async (orderId) => {
    try {
      // Find order to get customer phone before deleting
      const order = get().orders.find((o) => o.id === orderId);
      
      const { error } = await supabase
        .from('orders')
        .delete()
        .eq('id', orderId);

      if (error) throw error;
      
      // Deactivate any AI session linked to this order
      try {
        if (order?.customer?.whatsapp) {
          const rawPhone = order.customer.whatsapp.replace(/\D/g, '');
          const phone = rawPhone.startsWith('55') ? rawPhone : '55' + rawPhone;
          await supabase
            .from('automation_ai_sessions')
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq('phone', phone)
            .eq('is_active', true)
            .like('prompt', `livete_checkout:${orderId}`);
        }
      } catch (sessionErr) {
        console.error('[deleteOrder] Failed to deactivate AI session:', sessionErr);
      }
      
      set((state) => ({
        orders: state.orders.filter((o) => o.id !== orderId)
      }));
      
      toast.success('Pedido excluído!');
    } catch (error) {
      console.error('Error deleting order:', error);
      toast.error('Erro ao excluir pedido');
    }
  },

  moveOrder: async (orderId, newStage) => {
    const order = get().orders.find((o) => o.id === orderId);
    if (!order) return;

    const previousStage = order.stage;
    const updates: Record<string, unknown> = { stage: newStage };
    const stateUpdates: Partial<DbOrder> = { stage: newStage };
    
    // If moving to paid, mark as paid
    if (newStage === 'paid' && !order.is_paid) {
      const paidAt = new Date().toISOString();
      updates.is_paid = true;
      updates.paid_at = paidAt;
      stateUpdates.is_paid = true;
      stateUpdates.paid_at = paidAt;
      notifyPaymentConfirmed(orderId, 'events-kanban-drag');
    }

    // Post-paid stages should keep payment flags
    const postPaidStages = ['awaiting_shipping', 'awaiting_mototaxi', 'awaiting_pickup', 'completed'];
    
    // If moving away from paid manually to a pre-paid stage, clear payment flags
    if (newStage !== 'paid' && !postPaidStages.includes(newStage) && order.is_paid && order.stage === 'paid') {
      updates.is_paid = false;
      updates.paid_at = null;
      stateUpdates.is_paid = false;
      stateUpdates.paid_at = undefined;
    }

    try {
      const { error } = await supabase
        .from('orders')
        .update(updates)
        .eq('id', orderId);

      if (error) throw error;
      
      set((state) => ({
        orders: state.orders.map((o) => 
          o.id === orderId ? { ...o, ...stateUpdates } : o
        )
      }));

      // Note: Livete AI trigger is handled by OrderCardDb.tsx during order creation
      // to avoid duplicate invocations when moving orders to 'new' stage.
    } catch (error) {
      console.error('Error moving order:', error);
      toast.error('Erro ao mover pedido');
    }
  },

  addProductToOrder: async (orderId, product) => {
    const order = get().orders.find((o) => o.id === orderId);
    if (!order) return;

    const existingProduct = order.products.find((p) => p.id === product.id);
    let newProducts: DbOrderProduct[];
    
    if (existingProduct) {
      newProducts = order.products.map((p) =>
        p.id === product.id ? { ...p, quantity: p.quantity + product.quantity } : p
      );
    } else {
      newProducts = [...order.products, product];
    }

    try {
      const { error } = await supabase
        .from('orders')
        .update({ products: productsToJson(newProducts) })
        .eq('id', orderId);

      if (error) throw error;
      
      set((state) => ({
        orders: state.orders.map((o) => 
          o.id === orderId ? { ...o, products: newProducts } : o
        )
      }));

      // Notify AI about product change (fire-and-forget)
      try {
        supabase.functions.invoke('livete-order-updated', {
          body: { orderId, changeType: 'products_changed' },
        });
      } catch {}
    } catch (error) {
      console.error('Error adding product:', error);
      toast.error('Erro ao adicionar produto');
    }
  },

  removeProductFromOrder: async (orderId, productId) => {
    const order = get().orders.find((o) => o.id === orderId);
    if (!order) return;

    const newProducts = order.products.filter((p) => p.id !== productId);

    try {
      const { error } = await supabase
        .from('orders')
        .update({ products: productsToJson(newProducts) })
        .eq('id', orderId);

      if (error) throw error;
      
      set((state) => ({
        orders: state.orders.map((o) => 
          o.id === orderId ? { ...o, products: newProducts } : o
        )
      }));

      // Notify AI about product removal (fire-and-forget)
      try {
        supabase.functions.invoke('livete-order-updated', {
          body: { orderId, changeType: 'products_changed' },
        });
      } catch {}
    } catch (error) {
      console.error('Error removing product:', error);
      toast.error('Erro ao remover produto');
    }
  },

  updateProductQuantity: async (orderId, productId, quantity) => {
    if (quantity <= 0) {
      get().removeProductFromOrder(orderId, productId);
      return;
    }

    const order = get().orders.find((o) => o.id === orderId);
    if (!order) return;

    const newProducts = order.products.map((p) =>
      p.id === productId ? { ...p, quantity } : p
    );

    try {
      const { error } = await supabase
        .from('orders')
        .update({ products: productsToJson(newProducts) })
        .eq('id', orderId);

      if (error) throw error;
      
      set((state) => ({
        orders: state.orders.map((o) => 
          o.id === orderId ? { ...o, products: newProducts } : o
        )
      }));
    } catch (error) {
      console.error('Error updating quantity:', error);
      toast.error('Erro ao atualizar quantidade');
    }
  },

  setHasUnreadMessages: async (orderId, hasUnread) => {
    try {
      const { error } = await supabase
        .from('orders')
        .update({ has_unread_messages: hasUnread })
        .eq('id', orderId);

      if (error) throw error;
      
      set((state) => ({
        orders: state.orders.map((o) => 
          o.id === orderId ? { ...o, has_unread_messages: hasUnread } : o
        )
      }));
    } catch (error) {
      console.error('Error updating unread status:', error);
    }
  },

  setLastCustomerMessageAt: async (orderId, timestamp) => {
    try {
      const { error } = await supabase
        .from('orders')
        .update({ last_customer_message_at: timestamp.toISOString() })
        .eq('id', orderId);

      if (error) throw error;
      
      set((state) => ({
        orders: state.orders.map((o) => 
          o.id === orderId ? { ...o, last_customer_message_at: timestamp.toISOString() } : o
        )
      }));
    } catch (error) {
      console.error('Error updating last customer message:', error);
    }
  },

  setLastSentMessageAt: async (orderId, timestamp) => {
    try {
      const { error } = await supabase
        .from('orders')
        .update({ last_sent_message_at: timestamp.toISOString() })
        .eq('id', orderId);

      if (error) throw error;
      
      set((state) => ({
        orders: state.orders.map((o) => 
          o.id === orderId ? { ...o, last_sent_message_at: timestamp.toISOString() } : o
        )
      }));
    } catch (error) {
      console.error('Error updating last sent message:', error);
    }
  },

  checkNoResponseOrders: async () => {
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    
    const ordersToUpdate = get().orders.filter((order) => {
      if (order.stage === 'incomplete_order' || order.stage === 'awaiting_confirmation' || order.stage === 'no_response' || order.stage === 'awaiting_payment' || order.stage === 'paid' || order.stage === 'shipped' || order.stage === 'cancelled' || order.stage === 'collect_next_day' || order.stage === 'awaiting_shipping' || order.stage === 'awaiting_mototaxi' || order.stage === 'awaiting_pickup' || order.stage === 'completed') {
        return false;
      }
      
      if (!order.last_sent_message_at) return false;
      
      const lastSent = new Date(order.last_sent_message_at);
      
      // Only auto-move to no_response on FIRST contact (customer never responded)
      if (!order.last_customer_message_at && lastSent < fiveMinutesAgo) {
        return true;
      }
      
      // If customer has responded at least once, do NOT auto-move anymore
      return false;
    });

    for (const order of ordersToUpdate) {
      try {
        await supabase
          .from('orders')
          .update({ stage: 'no_response' })
          .eq('id', order.id);
      } catch (error) {
        console.error('Error updating order to no_response:', error);
      }
    }

    if (ordersToUpdate.length > 0) {
      set((state) => ({
        orders: state.orders.map((o) => 
          ordersToUpdate.some((u) => u.id === o.id) 
            ? { ...o, stage: 'no_response' } 
            : o
        )
      }));
    }
  },

  findOrderByCustomerInEvent: (eventId, customerId) => {
    return get().orders.find(
      (o) => o.event_id === eventId && o.customer_id === customerId
    );
  },

  findActiveOrderByCustomer: (eventId, customerId) => {
    // Find an order that is not yet paid
    return get().orders.find(
      (o) => o.event_id === eventId && 
             o.customer_id === customerId && 
             !o.is_paid
    );
  },

  getUnpaidOrdersCount: (eventId) => {
    const orders = get().orders;
    if (eventId) {
      return orders.filter((o) => o.event_id === eventId && !o.is_paid).length;
    }
    return orders.filter((o) => !o.is_paid).length;
  },

  regenerateCartLink: async (orderId) => {
    const order = get().orders.find((o) => o.id === orderId);
    if (!order || order.products.length === 0) return;

    try {
      const cartLink = `https://checkout.bananacalcados.com.br/checkout/order/${orderId}`;

      const { error } = await supabase
        .from('orders')
        .update({ cart_link: cartLink })
        .eq('id', orderId);

      if (error) throw error;
      
      set((state) => ({
        orders: state.orders.map((o) => 
          o.id === orderId ? { ...o, cart_link: cartLink } : o
        )
      }));
      
      toast.success('Link do carrinho atualizado!');
    } catch (error) {
      console.error('Error regenerating cart link:', error);
      toast.error('Erro ao atualizar link');
    }
  },

  upsertOrderRealtime: (order) => {
    const normalizedOrder = order.is_paid && order.stage === 'awaiting_payment'
      ? { ...order, stage: 'paid' }
      : order;

    set((state) => ({
      orders: mergeDbOrder(state.orders, normalizedOrder),
    }));
  },

  removeOrderRealtime: (orderId) => {
    set((state) => ({
      orders: state.orders.filter((order) => order.id !== orderId),
    }));
  },

  subscribeToEventOrders: (eventId) => {
    const channel = supabase
      .channel(`event-orders-${eventId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `event_id=eq.${eventId}` },
        async (payload: RealtimePostgresChangesPayload<{ id: string; event_id: string }>) => {
          try {
            if (payload.eventType === 'DELETE') {
              const deletedId = payload.old?.id;
              if (deletedId) get().removeOrderRealtime(deletedId);
              return;
            }

            const orderId = payload.new?.id;
            if (!orderId) return;

            const freshOrder = await fetchDbOrderById(orderId);
            if (freshOrder) {
              get().upsertOrderRealtime(freshOrder);
            }
          } catch (error) {
            console.error('Error syncing realtime order:', error);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },
}));
