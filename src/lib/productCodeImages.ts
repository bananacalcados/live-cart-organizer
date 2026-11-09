// Fotos dos produtos da fila da apresentadora.
// A foto vem do espelho Shopify (shopify_variant_mirror.image_url), que só a equipe
// autenticada pode ler. A correspondência é por produto Shopify + cor, com tolerância
// a acento, caixa, hífen e espaço; sem cor correspondente usa a foto do próprio produto.

export interface CodeImageSource {
  code: string;
  color: string | null;
  shopify_product_id?: string | null;
}

export interface MirrorImageRow {
  shopify_product_id: string | null;
  option_color: string | null;
  image_url: string | null;
}

export const normalizeImageColor = (value: string | null | undefined) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s\-_./]+/g, "")
    .trim();

/**
 * Monta code -> imagem. Uma única passada sobre as linhas do espelho e uma sobre os
 * códigos: sem consulta por produto.
 */
export function buildCodeImageMap(
  codes: CodeImageSource[],
  rows: MirrorImageRow[],
): Map<string, string> {
  const byProduct = new Map<string, { byColor: Map<string, string>; any?: string }>();

  for (const row of rows || []) {
    const productId = row?.shopify_product_id;
    const url = row?.image_url?.trim();
    if (!productId || !url) continue;
    let entry = byProduct.get(productId);
    if (!entry) {
      entry = { byColor: new Map<string, string>() };
      byProduct.set(productId, entry);
    }
    const color = normalizeImageColor(row.option_color);
    if (color && !entry.byColor.has(color)) entry.byColor.set(color, url);
    if (!entry.any) entry.any = url;
  }

  const images = new Map<string, string>();
  for (const code of codes || []) {
    const productId = code?.shopify_product_id;
    if (!productId || !code.code) continue;
    const entry = byProduct.get(productId);
    if (!entry) continue;
    const color = normalizeImageColor(code.color);
    const url = (color ? entry.byColor.get(color) : undefined) || entry.any;
    if (url) images.set(code.code, url);
  }
  return images;
}
