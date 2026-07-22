import { toast } from "sonner";

const SHOPIFY_API_VERSION = '2025-07';
const SHOPIFY_STORE_PERMANENT_DOMAIN = 'ftx2e2-np.myshopify.com';
const SHOPIFY_STOREFRONT_URL = `https://${SHOPIFY_STORE_PERMANENT_DOMAIN}/api/${SHOPIFY_API_VERSION}/graphql.json`;
const SHOPIFY_STOREFRONT_TOKEN = '01d9be4b81f3be57729bc07e9d552252';

export interface ShopifyProduct {
  node: {
    id: string;
    title: string;
    description: string;
    handle: string;
    productType: string;
    priceRange: {
      minVariantPrice: {
        amount: string;
        currencyCode: string;
      };
    };
    images: {
      edges: Array<{
        node: {
          url: string;
          altText: string | null;
        };
      }>;
    };
    collections: {
      edges: Array<{
        node: {
          title: string;
          handle: string;
        };
      }>;
    };
    variants: {
      edges: Array<{
        node: {
          id: string;
          title: string;
          sku: string | null;
          barcode: string | null;
          price: {
            amount: string;
            currencyCode: string;
          };
          compareAtPrice: {
            amount: string;
            currencyCode: string;
          } | null;
          availableForSale: boolean;
          quantityAvailable: number | null;
          selectedOptions: Array<{
            name: string;
            value: string;
          }>;
          image: {
            url: string;
          } | null;
        };
      }>;
    };
    options: Array<{
      name: string;
      values: string[];
    }>;
  };
}

type ShopifyVariantNode = ShopifyProduct["node"]["variants"]["edges"][number]["node"];

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Resolve a imagem que realmente corresponde à VARIAÇÃO selecionada (ex: cor).
 * Ordem de prioridade:
 * 1. Imagem vinculada diretamente à variação na Shopify (variant.image).
 * 2. Imagem do produto cujo altText casa com o valor da opção de cor selecionada.
 * 3. Primeira imagem do produto (fallback).
 *
 * Evita que o checkout mostre a cor "padrão" (primeira foto) em vez da cor escolhida.
 */
export function getVariantImage(
  product: ShopifyProduct,
  variant: ShopifyVariantNode | undefined,
): string | undefined {
  const images = product.node.images.edges;
  const firstImage = images[0]?.node.url;

  if (!variant) return firstImage;

  // 1. Imagem atribuída diretamente à variação na Shopify
  if (variant.image?.url) return variant.image.url;

  // 2. Casar pela opção de cor com o altText das fotos
  const colorOption = variant.selectedOptions.find((o) =>
    ["cor", "color", "colour"].includes(normalizeText(o.name)),
  );

  if (colorOption?.value) {
    const target = normalizeText(colorOption.value);
    const match = images.find((img) => {
      const alt = img.node.altText ? normalizeText(img.node.altText) : "";
      return alt && (alt.includes(target) || target.includes(alt));
    });
    if (match) return match.node.url;
  }

  // 3. Fallback
  return firstImage;
}

/**
 * Calcula o preço REAL de venda (com desconto) e o preço "de" (compare-at) de um
 * produto Shopify a partir de suas variações. A Shopify expõe o desconto de venda
 * na variação: `variant.price` é o valor já com desconto e `variant.compareAtPrice`
 * é o valor original (riscado). Usamos a variação disponível mais barata como
 * "a partir de", garantindo que a Link Page sempre mostre o valor promocional.
 */
export function computeProductPricing(
  node: ShopifyProduct["node"],
): { price: number; compareAtPrice: number | null } {
  const variants = (node.variants?.edges || []).map((e) => e.node);
  let candidates = variants.filter((v) => v.availableForSale);
  if (!candidates.length) candidates = variants;

  let price = Infinity;
  let compareAtPrice: number | null = null;
  for (const v of candidates) {
    const p = Number(v.price?.amount || 0);
    if (!p) continue;
    if (p < price) {
      price = p;
      const cmp = v.compareAtPrice ? Number(v.compareAtPrice.amount || 0) : 0;
      compareAtPrice = cmp > p ? cmp : null;
    }
  }
  if (!Number.isFinite(price)) price = Number(node.priceRange?.minVariantPrice?.amount || 0);
  return { price, compareAtPrice };
}


const STOREFRONT_QUERY = `
  query GetProducts($first: Int!, $query: String) {
    products(first: $first, query: $query) {
      edges {
        node {
          id
          title
          description
          handle
          productType
          priceRange {
            minVariantPrice {
              amount
              currencyCode
            }
          }
          images(first: 20) {
            edges {
              node {
                url
                altText
              }
            }
          }
          collections(first: 20) {
            edges {
              node {
                title
                handle
              }
            }
          }
          variants(first: 100) {
            edges {
              node {
                id
                title
                sku
                price {
                  amount
                  currencyCode
                }
                compareAtPrice {
                  amount
                  currencyCode
                }
                availableForSale
                selectedOptions {
                  name
                  value
                }
                barcode
                image {
                  url
                }
              }
            }
          }
          options {
            name
            values
          }
        }
      }
    }
  }
`;

export async function storefrontApiRequest(query: string, variables: Record<string, unknown> = {}) {
  const response = await fetch(SHOPIFY_STOREFRONT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': SHOPIFY_STOREFRONT_TOKEN
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  });

  if (response.status === 402) {
    toast.error("Shopify: Pagamento necessário", {
      description: "O acesso à API do Shopify requer um plano ativo.",
    });
    return;
  }

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  
  if (data.errors) {
    throw new Error(`Error calling Shopify: ${data.errors.map((e: { message: string }) => e.message).join(', ')}`);
  }

  return data;
}

export async function fetchProducts(limit: number = 250, searchQuery?: string): Promise<ShopifyProduct[]> {
  try {
    const data = await storefrontApiRequest(STOREFRONT_QUERY, { 
      first: Math.min(limit, 250), // Shopify max is 250 per request
      query: searchQuery || null
    });
    return data?.data?.products?.edges || [];
  } catch (error) {
    console.error('Failed to fetch products:', error);
    toast.error("Erro ao carregar produtos");
    return [];
  }
}
