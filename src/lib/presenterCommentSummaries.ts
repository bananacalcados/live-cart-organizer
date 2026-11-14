import { isOrderMarkedPaid } from "@/lib/orderPaymentStages";

export const PRESENTER_OPEN_STAGES = [
  "new", "contacted", "no_response", "awaiting_confirmation",
  "incomplete_order", "awaiting_payment", "endereco", "confirmar_endereco",
  "dados_pessoais", "forma_pagamento", "aguardando_pix", "aguardando_cartao", "aguardando_boleto",
];

export const PRESENTER_UNCONFIRMED_STAGES = ["pre_sale", "incomplete_order", "awaiting_confirmation"];

export interface PresenterCommentOrder {
  id: string;
  event_id: string;
  customer_id: string | null;
  handle: string;
  whatsapp: string | null;
  products: any[];
  stage: string;
  is_paid: boolean;
  paid_externally: boolean;
  paid_at: string | null;
  registered_at: string | null;
  created_at: string;
}

export interface PresenterPurchaseItem {
  title: string;
  variant: string;
  quantity: number;
}

export interface PresenterPurchase {
  order_id: string;
  event_name: string;
  paid_at: string;
  items: PresenterPurchaseItem[];
}

export interface IgHandleSummary {
  handle: string;
  customer_id: string | null;
  whatsapp: string | null;
  open_other: number;
  unconfirmed_other: number;
  paid_other: number;
  cancelled_other: number;
  paid_other_events: string[];
  cancelled_other_events: string[];
  purchases: PresenterPurchase[];
}

export interface PresenterSelfServiceAccess {
  id: string;
  event_id?: string;
  order_ids?: string[] | null;
  phone_key?: string | null;
  confirmed_phone_key?: string | null;
  instagram?: string | null;
  registered_at?: string | null;
}

export type RegistrationAlert = "none" | "not_opened" | "opened_unfinished";

export interface PresenterCart {
  orderId: string;
  productCount: number;
  total: number;
  whatsapp: string | null;
  createdAt: string | null;
  productNames: string[];
}

export interface PresenterHandleData {
  handle: string;
  customerId: string | null;
  whatsapp: string | null;
  latestOrderId: string | null;
  openCurrent: number;
  openOther: number;
  unconfirmedCurrent: number;
  unconfirmedOther: number;
  paidCurrent: number;
  paidOther: number;
  cancelledCurrent: number;
  cancelledOther: number;
  paidOtherEvents: string[];
  cancelledOtherEvents: string[];
  hasAnyOrder: boolean;
  hasWhatsapp: boolean;
  cart: PresenterCart | null;
  registrationAlert: RegistrationAlert;
  purchases: PresenterPurchase[];
  /** Fontes imutáveis: permitem reutilizar o objeto dos @ que não mudaram. */
  sourceOrders: PresenterCommentOrder[];
  sourceHistory: IgHandleSummary | undefined;
  sourceAccess: PresenterSelfServiceAccess | undefined;
  sourceEventId: string;
  sourceEventName: string;
}

export const cleanPresenterHandle = (value?: string | null) =>
  (value || "").replace(/^@+/, "").trim().toLowerCase();

const phoneSuffix8 = (value?: string | null) => {
  const digits = (value || "").replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(-8) : "";
};

const samePhone = (accessPhone: string | null | undefined, whatsapp: string | null) => {
  const accessSuffix = phoneSuffix8(accessPhone);
  return !!accessSuffix && accessSuffix === phoneSuffix8(whatsapp);
};

export function findRegistrationAccess(
  order: PresenterCommentOrder,
  whatsapp: string | null,
  accesses: PresenterSelfServiceAccess[],
) {
  const matches = accesses.filter((access) =>
    !!access.order_ids?.includes(order.id)
    || samePhone(access.phone_key, whatsapp)
    || samePhone(access.confirmed_phone_key, whatsapp)
    || (!!cleanPresenterHandle(access.instagram)
      && cleanPresenterHandle(access.instagram) === cleanPresenterHandle(order.handle)),
  );
  return matches.find((access) => !!access.registered_at) || matches[0];
}

export function getRegistrationAlert(
  cartOrder: PresenterCommentOrder | null,
  whatsapp: string | null,
  accesses: PresenterSelfServiceAccess[],
): { alert: RegistrationAlert; access?: PresenterSelfServiceAccess } {
  if (!cartOrder || cartOrder.registered_at) return { alert: "none" };
  const access = findRegistrationAccess(cartOrder, whatsapp, accesses);
  if (access?.registered_at) return { alert: "none", access };
  return { alert: access ? "opened_unfinished" : "not_opened", access };
}

const productQuantity = (product: any) => {
  const quantity = Number(product?.quantity ?? 1);
  return Number.isFinite(quantity) ? quantity : 1;
};

export const presenterProductName = (product: any) =>
  [product?.title || product?.name || "Produto", product?.variant]
    .filter(Boolean)
    .join(" · ");

function currentPurchase(order: PresenterCommentOrder, eventName: string): PresenterPurchase {
  return {
    order_id: order.id,
    event_name: eventName || "Esta live",
    paid_at: order.paid_at || order.created_at,
    items: (order.products || []).map((product) => ({
      title: String(product?.title || product?.name || "Produto"),
      variant: String(product?.variant || ""),
      quantity: productQuantity(product),
    })),
  };
}

const sameOrderSources = (a: PresenterCommentOrder[], b: PresenterCommentOrder[]) =>
  a.length === b.length && a.every((order, index) => order === b[index]);

function buildCart(orders: PresenterCommentOrder[], whatsapp: string | null): PresenterCart | null {
  const openOrders = orders.filter((order) =>
    order.stage !== "cancelled"
    && !isOrderMarkedPaid(order)
    && PRESENTER_OPEN_STAGES.includes(order.stage),
  );
  if (!openOrders.length) return null;
  const withTotals = openOrders.map((order) => ({
    order,
    total: (order.products || []).reduce(
      (sum, product) => sum + Number(product?.price || 0) * productQuantity(product),
      0,
    ),
  }));
  withTotals.sort((a, b) => b.total - a.total);
  const selected = withTotals[0];
  return {
    orderId: selected.order.id,
    productCount: (selected.order.products || []).reduce((sum, product) => sum + productQuantity(product), 0),
    total: selected.total,
    whatsapp: selected.order.whatsapp || whatsapp,
    createdAt: selected.order.created_at || null,
    productNames: (selected.order.products || []).map(presenterProductName).filter(Boolean),
  };
}

export function buildPresenterHandleData(
  eventId: string,
  eventName: string,
  handles: string[],
  currentOrders: PresenterCommentOrder[],
  histories: Map<string, IgHandleSummary>,
  accesses: PresenterSelfServiceAccess[],
  previous: Map<string, PresenterHandleData> = new Map(),
) {
  const next = new Map<string, PresenterHandleData>();
  for (const rawHandle of handles) {
    const handle = cleanPresenterHandle(rawHandle);
    if (!handle) continue;
    const orders = currentOrders.filter((order) => cleanPresenterHandle(order.handle) === handle);
    const history = histories.get(handle);
    const old = previous.get(handle);
    const tentativeWhatsapp = orders.find((order) => !!order.whatsapp)?.whatsapp || history?.whatsapp || null;
    const selectedCart = buildCart(orders, tentativeWhatsapp);
    const cartOrder = orders.find((order) => order.id === selectedCart?.orderId) || null;
    const registration = getRegistrationAlert(cartOrder, selectedCart?.whatsapp || tentativeWhatsapp, accesses);
    if (
      old
      && old.sourceEventId === eventId
      && old.sourceEventName === eventName
      && old.sourceHistory === history
      && old.sourceAccess === registration.access
      && sameOrderSources(old.sourceOrders, orders)
    ) {
      next.set(handle, old);
      continue;
    }

    const paidCurrentOrders = orders.filter((order) => order.stage !== "cancelled" && isOrderMarkedPaid(order));
    const currentOrderIds = new Set(orders.map((order) => order.id));
    const purchases = [
      ...paidCurrentOrders.map((order) => currentPurchase(order, eventName)),
      ...(history?.purchases || []).filter((purchase) => !currentOrderIds.has(purchase.order_id)),
    ].sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime());
    const whatsapp = selectedCart?.whatsapp || tentativeWhatsapp;
    const cart = selectedCart;
    const latestCurrent = [...orders].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
    const paidOther = Number(history?.paid_other || 0);
    const cancelledOther = Number(history?.cancelled_other || 0);
    const openOther = Number(history?.open_other || 0);
    const unconfirmedOther = Number(history?.unconfirmed_other || 0);
    const paidCurrent = paidCurrentOrders.length;
    const cancelledCurrent = orders.filter((order) => order.stage === "cancelled").length;
    const openCurrent = orders.filter((order) =>
      order.stage !== "cancelled" && !isOrderMarkedPaid(order) && PRESENTER_OPEN_STAGES.includes(order.stage),
    ).length;
    const unconfirmedCurrent = orders.filter((order) =>
      order.stage !== "cancelled" && !isOrderMarkedPaid(order) && PRESENTER_UNCONFIRMED_STAGES.includes(order.stage),
    ).length;

    next.set(handle, {
      handle,
      customerId: history?.customer_id || orders.find((order) => !!order.customer_id)?.customer_id || null,
      whatsapp,
      latestOrderId: cart?.orderId || latestCurrent?.id || purchases[0]?.order_id || null,
      openCurrent,
      openOther,
      unconfirmedCurrent,
      unconfirmedOther,
      paidCurrent,
      paidOther,
      cancelledCurrent,
      cancelledOther,
      paidOtherEvents: history?.paid_other_events || [],
      cancelledOtherEvents: history?.cancelled_other_events || [],
      hasAnyOrder: orders.length > 0 || openOther + unconfirmedOther + paidOther + cancelledOther > 0 || purchases.length > 0,
      hasWhatsapp: !!whatsapp,
      cart,
      registrationAlert: registration.alert,
      purchases,
      sourceOrders: orders,
      sourceHistory: history,
      sourceAccess: registration.access,
      sourceEventId: eventId,
      sourceEventName: eventName,
    });
  }
  return next;
}
