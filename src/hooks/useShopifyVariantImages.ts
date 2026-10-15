import { useEffect, useState } from "react";
import { storefrontApiRequest } from "@/lib/shopify";

const cache = new Map<string, string | null>();

/** Busca a foto atual na Shopify para itens do pedido que foram salvos sem foto. */
export function useShopifyVariantImages(products: any[] | undefined) {
  const ids = Array.from(
    new Set(
      (products || [])
        .filter((p) => !p?.image && String(p?.shopifyId || "").includes("ProductVariant"))
        .map((p) => String(p.shopifyId)),
    ),
  );
  const key = ids.join(",");
  const [, setTick] = useState(0);

  useEffect(() => {
    const missing = ids.filter((id) => !cache.has(id));
    if (!missing.length) return;
    let alive = true;
    storefrontApiRequest(
      `query($ids:[ID!]!){nodes(ids:$ids){... on ProductVariant{id image{url} product{featuredImage{url}}}}}`,
      { ids: missing },
    )
      .then((res: any) => {
        for (const id of missing) cache.set(id, null);
        for (const n of res?.data?.nodes || []) {
          if (n?.id) cache.set(n.id, n.image?.url || n.product?.featuredImage?.url || null);
        }
        if (alive) setTick((t) => t + 1);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (p: any): string | undefined => p?.image || cache.get(String(p?.shopifyId || "")) || undefined;
}
