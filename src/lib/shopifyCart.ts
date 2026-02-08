import { storefrontApiRequest } from "./shopify";
import { OrderProduct } from "@/types/order";

const CART_CREATE_MUTATION = `
  mutation cartCreate($input: CartInput!) {
    cartCreate(input: $input) {
      cart {
        id
        checkoutUrl
        lines(first: 100) {
          edges {
            node {
              id
              merchandise {
                ... on ProductVariant {
                  id
                }
              }
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_FIRST_VARIANT_QUERY = `
  query getProductFirstVariant($id: ID!) {
    node(id: $id) {
      ... on Product {
        variants(first: 1) {
          edges {
            node {
              id
            }
          }
        }
      }
    }
  }
`;

function formatCheckoutUrl(checkoutUrl: string): string {
  try {
    const url = new URL(checkoutUrl);
    url.searchParams.set("channel", "online_store");
    return url.toString();
  } catch {
    return checkoutUrl;
  }
}

function isProductGid(id: string | undefined | null) {
  return !!id && id.includes("gid://shopify/Product/");
}

function extractVariantIdFromCompositeId(compositeId: string): string | null {
  // We build ids like: `${productGid}-${variantGid}`
  const parts = compositeId.split("-");
  const maybeVariant = parts[parts.length - 1];
  if (maybeVariant?.includes("gid://shopify/ProductVariant/")) return maybeVariant;
  return null;
}

async function resolveMerchandiseId(product: OrderProduct): Promise<string | null> {
  // New format: already a variant GID
  if (product.shopifyId?.includes("gid://shopify/ProductVariant/")) return product.shopifyId;

  // Migration/backwards-compat: some old orders stored Product GID in shopifyId
  if (isProductGid(product.shopifyId)) {
    // First: try extracting variant from our composite local id
    const extracted = extractVariantIdFromCompositeId(product.id);
    if (extracted) return extracted;

    // Fallback: query first variant for that product
    const data = await storefrontApiRequest(PRODUCT_FIRST_VARIANT_QUERY, { id: product.shopifyId });
    const variantId = data?.data?.node?.variants?.edges?.[0]?.node?.id as string | undefined;
    return variantId || null;
  }

  // Unknown id format
  return null;
}

export async function createShopifyCartFromOrder(products: OrderProduct[]): Promise<string | null> {
  if (products.length === 0) return null;

  try {
    const resolved = await Promise.all(
      products.map(async (product) => {
        const merchandiseId = await resolveMerchandiseId(product);
        if (!merchandiseId) {
          console.error("Invalid merchandise id for product:", product);
          return null;
        }
        return {
          quantity: product.quantity,
          merchandiseId,
        };
      })
    );

    const lines = resolved.filter(Boolean) as Array<{ quantity: number; merchandiseId: string }>;
    if (lines.length === 0) return null;

    const data = await storefrontApiRequest(CART_CREATE_MUTATION, {
      input: { lines },
    });

    if (data?.data?.cartCreate?.userErrors?.length > 0) {
      console.error("Cart creation failed:", data.data.cartCreate.userErrors);
      return null;
    }

    const cart = data?.data?.cartCreate?.cart;
    if (!cart?.checkoutUrl) return null;

    return formatCheckoutUrl(cart.checkoutUrl);
  } catch (error) {
    console.error("Failed to create Shopify cart:", error);
    return null;
  }
}

