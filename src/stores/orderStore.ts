import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Order, OrderStage, OrderProduct } from '@/types/order';

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
}

const generateId = () => Math.random().toString(36).substring(2, 15);

export const useOrderStore = create<OrderStore>()(
  persist(
    (set, get) => ({
      orders: [],

      addOrder: (instagramHandle, whatsapp) => {
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
    }),
    {
      name: 'live-crm-orders',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
