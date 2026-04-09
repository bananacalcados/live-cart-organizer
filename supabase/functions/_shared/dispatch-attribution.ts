export interface BuyerProduct {
  name: string;
  variant?: string;
  qty: number;
  price: number;
}

export interface PreviousPurchase {
  reference_id?: string;
  source: string;
  purchased_at: string;
  total: number | null;
  store_name: string | null;
  seller_name: string | null;
  products: BuyerProduct[];
  note?: string | null;
}

export interface BuyerResult {
  name: string;
  phone: string;
  total: number;
  source: string;
  purchased_at: string;
  store_name: string | null;
  seller_name: string | null;
  products: BuyerProduct[];
  is_first_purchase: boolean;
  previous_purchases: PreviousPurchase[];
}

export const extractPhoneKey = (rawPhone: string | null | undefined): string | null => {
  if (!rawPhone) return null;

  let digits = String(rawPhone).replace(/\D/g, "");
  if (!digits) return null;

  if (digits.length >= 12 && digits.startsWith("55")) {
    digits = digits.slice(2);
  }

  if (digits.length < 10) return null;

  const ddd = digits.slice(0, 2);
  const suffix = digits.slice(-8);

  return `${ddd}${suffix}`;
};

export const parseLineItems = (lineItems: any): BuyerProduct[] => {
  if (!Array.isArray(lineItems)) return [];

  return lineItems.map((item) => ({
    name: item?.title || item?.name || "Produto",
    variant: item?.variant_title || item?.variant || undefined,
    qty: Number(item?.quantity || 1),
    price: Number(item?.price || 0),
  }));
};

export const parseOrderProducts = (products: any): { items: BuyerProduct[]; total: number } => {
  if (!Array.isArray(products)) return { items: [], total: 0 };

  let total = 0;
  const items = products.map((product) => {
    const qty = Number(product?.quantity || 1);
    const price = Number(product?.price || 0);
    total += price * qty;

    return {
      name: product?.title || "Produto",
      variant: product?.variant || undefined,
      qty,
      price,
    } satisfies BuyerProduct;
  });

  return { items, total };
};

export const sortPurchasesDesc = <T extends { purchased_at: string }>(items: T[]) =>
  items.sort((a, b) => new Date(b.purchased_at).getTime() - new Date(a.purchased_at).getTime());
