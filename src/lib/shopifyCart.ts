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

function formatCheckoutUrl(checkoutUrl: string): string {
  try {
    const url = new URL(checkoutUrl);
    url.searchParams.set('channel', 'online_store');
    return url.toString();
  } catch {
    return checkoutUrl;
  }
}

export async function createShopifyCartFromOrder(products: OrderProduct[]): Promise<string | null> {
  if (products.length === 0) return null;

  const lines = products.map((product) => ({
    quantity: product.quantity,
    merchandiseId: product.shopifyId,
  }));

  try {
    const data = await storefrontApiRequest(CART_CREATE_MUTATION, {
      input: { lines },
    });

    if (data?.data?.cartCreate?.userErrors?.length > 0) {
      console.error('Cart creation failed:', data.data.cartCreate.userErrors);
      return null;
    }

    const cart = data?.data?.cartCreate?.cart;
    if (!cart?.checkoutUrl) return null;

    return formatCheckoutUrl(cart.checkoutUrl);
  } catch (error) {
    console.error('Failed to create Shopify cart:', error);
    return null;
  }
}
