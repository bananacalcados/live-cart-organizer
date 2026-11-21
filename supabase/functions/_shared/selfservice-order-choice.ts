/** Resolve only server-loaded, current-event open orders. Never trust the typed Instagram. */
export type ChoiceOrder = {
  id: string;
  customer_id: string;
  phone_last4?: string | null;
  customer?: { instagram_handle?: string | null; whatsapp?: string | null } | null;
  registration?: { whatsapp?: string | null } | { whatsapp?: string | null }[] | null;
  claimedPhones?: string[];
};

const digits = (v?: string | null) => String(v || "").replace(/\D/g, "");
const phoneIdentity = (v: string) => {
  const n = digits(v).replace(/^55(?=\d{10,11}$)/, "");
  return n.length === 10 ? n.slice(0, 2) + "9" + n.slice(2) : n;
};
export const choiceIdentity = (o: ChoiceOrder) => {
  const handle = String(o.customer?.instagram_handle || "").trim().replace(/^@/, "").toLowerCase();
  return handle ? `ig:${handle}` : `customer:${o.customer_id}`;
};

export function resolveOrderChoice<T extends ChoiceOrder>(rows: T[], phone: string, selectedId?: string | null) {
  const key = phoneIdentity(phone);
  const eligible = rows.filter((o) => !(o.claimedPhones || []).some((p) => phoneIdentity(p) !== key));
  const fullPhones = (o: T) => {
    const regs = Array.isArray(o.registration) ? o.registration : o.registration ? [o.registration] : [];
    return [o.customer?.whatsapp, ...regs.map((r) => r.whatsapp), ...(o.claimedPhones || [])]
      .filter((p): p is string => digits(p).length >= 10);
  };
  const incomplete = eligible.filter((o) => !fullPhones(o).length && o.phone_last4 === digits(phone).slice(-4));
  // A complete order never competes with a new incomplete order just because of its suffix.
  const pool = incomplete.length ? incomplete : eligible.filter((o) => {
    const phones = fullPhones(o);
    return phones.length > 0 && phones.every((p) => phoneIdentity(p) === key);
  });
  const identities = new Set(pool.map(choiceIdentity));
  const selected = selectedId ? pool.find((o) => o.id === selectedId) : null;
  const invalidSelection = !!selectedId && !selected;
  const ambiguous = identities.size > 1 && !selected;
  const orders = invalidSelection || ambiguous ? [] : selected
    ? pool.filter((o) => choiceIdentity(o) === choiceIdentity(selected)) : pool;
  return { orders, candidates: ambiguous ? pool : [], ambiguous, invalidSelection, hasCandidates: pool.length > 0 };
}