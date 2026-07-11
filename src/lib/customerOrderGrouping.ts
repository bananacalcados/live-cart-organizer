import { DbOrder } from "@/types/database";

/** Ficha mínima usada para identidade/endereço na unificação de pedidos. */
export interface OrderRegLite {
  order_id?: string;
  full_name?: string | null;
  cpf?: string | null;
  whatsapp?: string | null;
  cep?: string | null;
  address?: string | null;
  address_number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
}

const digits = (s?: string | null) => (s || "").replace(/\D/g, "");
const last8 = (s?: string | null) => {
  const d = digits(s);
  return d.length >= 8 ? d.slice(-8) : "";
};
const igKey = (s?: string | null) =>
  (s || "").trim().toLowerCase().replace(/^@+/, "");

/**
 * Chaves de identidade FORTES do cliente: Instagram, WhatsApp e CPF.
 * Dois pedidos são do mesmo cliente se compartilharem QUALQUER uma dessas chaves.
 */
export function identityKeys(order: DbOrder, reg?: OrderRegLite | null): string[] {
  const keys: string[] = [];
  const ig = igKey(order.customer?.instagram_handle);
  if (ig) keys.push("ig:" + ig);
  const wa = last8(order.customer?.whatsapp || reg?.whatsapp);
  if (wa) keys.push("wa:" + wa);
  const cpf = digits(reg?.cpf);
  if (cpf.length === 11) keys.push("cpf:" + cpf);
  return keys;
}

/**
 * Agrupa pedidos por cliente usando union-find sobre as chaves de identidade.
 * Retorna os grupos preservando a ordem de entrada dos pedidos.
 */
export function groupOrdersByCustomer(
  orders: DbOrder[],
  regByOrderId: Record<string, OrderRegLite | undefined>,
): DbOrder[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // path compression
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const ensure = (x: string) => {
    if (!parent.has(x)) parent.set(x, x);
  };

  // node id per order
  for (const o of orders) ensure("o:" + o.id);

  // link orders that share an identity key
  const keyToOrder = new Map<string, string>();
  for (const o of orders) {
    const keys = identityKeys(o, regByOrderId[o.id]);
    for (const k of keys) {
      ensure(k);
      union("o:" + o.id, k);
      const prev = keyToOrder.get(k);
      if (prev) union("o:" + o.id, prev);
      keyToOrder.set(k, "o:" + o.id);
    }
  }

  const groupsMap = new Map<string, DbOrder[]>();
  const order0 = new Map<string, number>();
  orders.forEach((o, i) => order0.set(o.id, i));
  for (const o of orders) {
    const root = find("o:" + o.id);
    if (!groupsMap.has(root)) groupsMap.set(root, []);
    groupsMap.get(root)!.push(o);
  }

  const groups = Array.from(groupsMap.values());
  // sort each group by original order, and groups by first member order
  for (const g of groups) g.sort((a, b) => (order0.get(a.id)! - order0.get(b.id)!));
  groups.sort((a, b) => order0.get(a[0].id)! - order0.get(b[0].id)!);
  return groups;
}

/**
 * Chave normalizada do endereço de entrega. Retorna null quando não há
 * endereço válido (sem CEP real). Só é possível unificar quando todos os
 * pedidos do grupo têm a MESMA chave de endereço.
 */
export function addressKey(reg?: OrderRegLite | null): string | null {
  if (!reg) return null;
  const cep = digits(reg.cep);
  if (cep.length !== 8 || cep === "00000000") return null;
  const num = (reg.address_number || "").trim().toLowerCase();
  const addr = (reg.address || "").trim().toLowerCase();
  return `${cep}|${num}|${addr}`;
}

/** Todos os pedidos do grupo têm o mesmo endereço de entrega válido? */
export function sameShippingAddress(
  orders: DbOrder[],
  regByOrderId: Record<string, OrderRegLite | undefined>,
): boolean {
  const keys = orders.map((o) => addressKey(regByOrderId[o.id]));
  if (keys.some((k) => k === null)) return false;
  return keys.every((k) => k === keys[0]);
}
