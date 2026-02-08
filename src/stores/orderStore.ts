import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Order, OrderStage, OrderProduct } from '@/types/order';
import { toast } from 'sonner';

interface OrderStore {
  orders: Order[];
  addOrder: (instagramHandle: string, whatsapp?: string) => string;
  updateOrder: (orderId: string, updates: Partial<Order>) => void;
  deleteOrder: (orderId: string) => void;
  moveOrder: (orderId: string, newStage: OrderStage) => void;
  addProductToOrder: (orderId: string, product: OrderProduct) => void;
  removeProductFromOrder: (orderId: string, productId: string) => void;
  updateProductQuantity: (orderId: string, productId: string, quantity: number) => void;
  getOrdersByStage: (stage: OrderStage) => Order[];
  findOrderByInstagram: (instagramHandle: string) => Order | undefined;
  findOrderByWhatsApp: (whatsapp: string) => Order | undefined;
  setHasUnreadMessages: (orderId: string, hasUnread: boolean) => void;
  setLastCustomerMessageAt: (orderId: string, timestamp: Date) => void;
  checkNoResponseOrders: () => void;
}

const generateId = () => Math.random().toString(36).substring(2, 15);

// Normalize Instagram handle for comparison
const normalizeInstagram = (handle: string): string => {
  return handle.toLowerCase().replace(/^@/, '').trim();
};

// Normalize WhatsApp for comparison
const normalizeWhatsApp = (phone: string): string => {
  return phone.replace(/\D/g, '').trim();
};

export const useOrderStore = create<OrderStore>()(
  persist(
    (set, get) => ({
      orders: [],

      findOrderByInstagram: (instagramHandle: string) => {
        const normalized = normalizeInstagram(instagramHandle);
        return get().orders.find(
          (order) => normalizeInstagram(order.instagramHandle) === normalized
        );
      },

      findOrderByWhatsApp: (whatsapp: string) => {
        const normalized = normalizeWhatsApp(whatsapp);
        if (!normalized) return undefined;
        return get().orders.find(
          (order) => order.whatsapp && normalizeWhatsApp(order.whatsapp) === normalized
        );
      },

      addOrder: (instagramHandle, whatsapp) => {
        const normalized = normalizeInstagram(instagramHandle);
        const existing = get().findOrderByInstagram(instagramHandle);

        if (existing) {
          // Update existing order with new whatsapp if provided
          if (whatsapp && !existing.whatsapp) {
            set((state) => ({
              orders: state.orders.map((order) =>
                order.id === existing.id
                  ? { ...order, whatsapp, updatedAt: new Date() }
                  : order
              ),
            }));
          }
          toast.info(`Pedido existente encontrado para ${instagramHandle}`);
          return existing.id;
        }

        const id = generateId();
        const now = new Date();
        const newOrder: Order = {
          id,
          instagramHandle: instagramHandle.startsWith('@') ? instagramHandle : `@${instagramHandle}`,
          whatsapp,
          products: [],
          stage: 'new',
          createdAt: now,
          updatedAt: now,
          hasUnreadMessages: false,
        };
        set((state) => ({ orders: [...state.orders, newOrder] }));
        return id;
      },

      updateOrder: (orderId, updates) => {
        set((state) => ({
          orders: state.orders.map((order) =>
            order.id === orderId
              ? { ...order, ...updates, updatedAt: new Date() }
              : order
          ),
        }));
      },

      deleteOrder: (orderId) => {
        set((state) => ({
          orders: state.orders.filter((order) => order.id !== orderId),
        }));
      },

      moveOrder: (orderId, newStage) => {
        set((state) => ({
          orders: state.orders.map((order) =>
            order.id === orderId
              ? { ...order, stage: newStage, updatedAt: new Date() }
              : order
          ),
        }));
      },

      addProductToOrder: (orderId, product) => {
        set((state) => ({
          orders: state.orders.map((order) => {
            if (order.id !== orderId) return order;
            const existingProduct = order.products.find((p) => p.id === product.id);
            if (existingProduct) {
              return {
                ...order,
                products: order.products.map((p) =>
                  p.id === product.id ? { ...p, quantity: p.quantity + product.quantity } : p
                ),
                updatedAt: new Date(),
              };
            }
            return {
              ...order,
              products: [...order.products, product],
              updatedAt: new Date(),
            };
          }),
        }));
      },

      removeProductFromOrder: (orderId, productId) => {
        set((state) => ({
          orders: state.orders.map((order) =>
            order.id === orderId
              ? {
                  ...order,
                  products: order.products.filter((p) => p.id !== productId),
                  updatedAt: new Date(),
                }
              : order
          ),
        }));
      },

      updateProductQuantity: (orderId, productId, quantity) => {
        if (quantity <= 0) {
          get().removeProductFromOrder(orderId, productId);
          return;
        }
        set((state) => ({
          orders: state.orders.map((order) =>
            order.id === orderId
              ? {
                  ...order,
                  products: order.products.map((p) =>
                    p.id === productId ? { ...p, quantity } : p
                  ),
                  updatedAt: new Date(),
                }
              : order
          ),
        }));
      },

      getOrdersByStage: (stage) => {
        return get().orders.filter((order) => order.stage === stage);
      },

      setHasUnreadMessages: (orderId, hasUnread) => {
        set((state) => ({
          orders: state.orders.map((order) =>
            order.id === orderId
              ? { ...order, hasUnreadMessages: hasUnread, updatedAt: new Date() }
              : order
          ),
        }));
      },

      setLastCustomerMessageAt: (orderId, timestamp) => {
        set((state) => ({
          orders: state.orders.map((order) =>
            order.id === orderId
              ? { ...order, lastCustomerMessageAt: timestamp, updatedAt: new Date() }
              : order
          ),
        }));
      },

      checkNoResponseOrders: () => {
        const now = new Date();
        const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
        
        set((state) => ({
          orders: state.orders.map((order) => {
            // Only check orders that have a lastSentMessageAt and are not already in no_response, paid, or shipped
            if (
              order.lastSentMessageAt &&
              !order.lastCustomerMessageAt &&
              order.stage !== 'no_response' &&
              order.stage !== 'paid' &&
              order.stage !== 'shipped' &&
              new Date(order.lastSentMessageAt) < fiveMinutesAgo
            ) {
              return { ...order, stage: 'no_response', updatedAt: now };
            }
            // Check if customer replied after we sent message, but then went silent
            if (
              order.lastSentMessageAt &&
              order.lastCustomerMessageAt &&
              new Date(order.lastSentMessageAt) > new Date(order.lastCustomerMessageAt) &&
              order.stage !== 'no_response' &&
              order.stage !== 'paid' &&
              order.stage !== 'shipped' &&
              new Date(order.lastSentMessageAt) < fiveMinutesAgo
            ) {
              return { ...order, stage: 'no_response', updatedAt: now };
            }
            return order;
          }),
        }));
      },
    }),
    {
      name: 'live-crm-orders',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
