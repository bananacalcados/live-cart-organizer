export const normalizePushValue = (value: unknown): string =>
  String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

export const numericShopifyId = (value: unknown): string =>
  String(value ?? "").split("/").pop()?.replace(/\D/g, "") || "";

const normalizedName = (value: unknown) => normalizePushValue(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const skuOf = (variant: any) => normalizePushValue(variant?.inventoryItem?.sku ?? variant?.sku);
const gtinOf = (variant: any) => String(variant?.barcode ?? variant?.gtin ?? "").trim();

export function exactPushColor(objects: any[], name: string) {
  const matches = objects.filter((object) => normalizePushValue(object.displayName) === normalizePushValue(name));
  if (matches.length !== 1) {
    throw new Error(`A cor "${name}" ${matches.length ? "está ambígua" : "não existe"} na lista de cores da Shopify. Nada foi criado.`);
  }
  return matches[0].id as string;
}

function selectedCombo(product: any, variant: any, options: any[]) {
  return options.map((option) => normalizePushValue(
    variant.selectedOptions?.find((selected: any) => selected.name === option.name)?.value,
  )).join("|");
}

/**
 * Planeja somente criações e vínculos comprovados. Nunca inclui mídia, quantidade
 * ou dados de outras cores; correspondências usam ID, SKU ou GTIN, nunca a ordem.
 */
export function buildPushPlan(localVariants: any[], product: any, salePrice: number, colorObjects: any[] = []) {
  const options = product.options || [];
  const colorOptions = options.filter((option: any) => {
    const name = normalizedName(option.name);
    return name.includes("cor") || name.includes("color");
  });
  const sizeOptions = options.filter((option: any) => {
    const name = normalizedName(option.name);
    return /tamanho|tam|size|numeracao|numero/.test(name);
  });
  if (colorOptions.length !== 1) throw new Error("Não consegui identificar com segurança a opção de cor na Shopify. Nada foi criado.");
  if (sizeOptions.length > 1) throw new Error("Há mais de uma opção de tamanho na Shopify. Nada foi criado.");
  const colorOption = colorOptions[0];
  const sizeOption = sizeOptions[0] || null;
  const known = new Set([colorOption.id, ...(sizeOption ? [sizeOption.id] : [])]);
  const unknown = options.filter((option: any) => !known.has(option.id));
  if (unknown.length) {
    throw new Error(`A opção "${unknown[0].name}" não foi reconhecida. Nada foi criado.`);
  }
  if (!sizeOption && localVariants.some((variant) => String(variant.size || "").trim())) {
    throw new Error("O ERP tem tamanhos, mas a Shopify não tem opção de tamanho. Nada foi criado.");
  }

  const additions = new Map<string, { optionId: string; gid: string }>();
  const create: any[] = [];
  const links: Array<{ variant_id: string; shopify_variant_id: string }> = [];
  const existingVariants: any[] = [];
  const claimedShopify = new Set<string>();
  const claimedCombos = new Set<string>();
  const resolvedOptions = [colorOption, ...(sizeOption ? [sizeOption] : [])];

  const optionValues = (variant: any) => resolvedOptions.map((option) => {
    const value = String(option.id === colorOption.id ? variant.color : variant.size);
    const matches = (option.optionValues || []).filter((item: any) => normalizePushValue(item.name) === normalizePushValue(value));
    if (matches.length > 1) throw new Error(`A opção "${option.name}" tem valores duplicados na Shopify. Nada foi criado.`);
    if (matches.length === 1) return { optionName: option.name, id: matches[0].id };
    if (option.linkedMetafield) {
      if (option.linkedMetafield.namespace !== "shopify" || option.linkedMetafield.key !== "color-pattern") {
        throw new Error(`A opção vinculada "${option.name}" precisa de conferência. Nada foi criado.`);
      }
      const gid = exactPushColor(colorObjects, value);
      additions.set(`${option.id}:${gid}`, { optionId: option.id, gid });
      return { optionName: option.name, name: value, linkedMetafieldValue: gid };
    }
    return { optionName: option.name, name: value };
  });

  for (const variant of localVariants) {
    const shopifyVariants = product.variants?.nodes || [];
    let existing = variant.shopify_variant_id
      ? shopifyVariants.find((item: any) => numericShopifyId(item.id) === String(variant.shopify_variant_id))
      : null;
    if (!existing) {
      const identityMatches = shopifyVariants.filter((item: any) =>
        (variant.sku && skuOf(item) && skuOf(item) === normalizePushValue(variant.sku)) ||
        (variant.gtin && gtinOf(item) && gtinOf(item) === String(variant.gtin).trim()),
      );
      if (identityMatches.length > 1) throw new Error(`SKU/GTIN de ${variant.sku} apontam para mais de uma variação. Nada foi criado.`);
      existing = identityMatches[0] || null;
    }
    if (existing) {
      if (claimedShopify.has(existing.id)) throw new Error("Duas variações do ERP apontam para a mesma variação da Shopify. Nada foi criado.");
      claimedShopify.add(existing.id);
      if (String(variant.shopify_variant_id || "") !== numericShopifyId(existing.id)) {
        links.push({ variant_id: variant.id, shopify_variant_id: numericShopifyId(existing.id) });
      }
      existingVariants.push(existing);
      continue;
    }

    const values = optionValues(variant);
    const combo = values.map((item: any) => normalizePushValue(item.name ?? product.options
      .flatMap((option: any) => option.optionValues || [])
      .find((optionValue: any) => optionValue.id === item.id)?.name)).join("|");
    if (claimedCombos.has(combo)) throw new Error(`Cor/tamanho duplicados no ERP: ${variant.color} / ${variant.size || "único"}. Nada foi criado.`);
    claimedCombos.add(combo);
    const comboExists = shopifyVariants.some((item: any) => selectedCombo(product, item, resolvedOptions) === combo);
    if (comboExists) {
      throw new Error(`A combinação ${variant.color} / ${variant.size || "único"} já existe com outro SKU/GTIN na Shopify. Nada foi criado.`);
    }
    create.push({
      owner: variant,
      input: {
        barcode: variant.gtin || null,
        price: String(salePrice),
        inventoryItem: { sku: variant.sku, tracked: true },
        optionValues: values,
      },
    });
  }

  return { additions: [...additions.values()], create, links, existingVariants };
}

export function resolvePushOptionInputs(values: any[], options: any[]) {
  return values.map((value) => {
    if (!value.linkedMetafieldValue) return value.id
      ? { optionName: value.optionName, id: value.id }
      : { optionName: value.optionName, name: value.name };
    const option = options.find((item) => item.name === value.optionName);
    const linked = option?.optionValues?.find((item: any) => item.linkedMetafieldValue === value.linkedMetafieldValue);
    if (!linked?.id) throw new Error(`A Shopify não confirmou a cor "${value.name}". Nenhuma variação foi criada.`);
    return { optionName: value.optionName, id: linked.id };
  });
}

export function matchCreatedVariant(created: any, candidates: any[]) {
  const matches = candidates.filter(({ owner }) =>
    (owner.sku && skuOf(created) && skuOf(created) === normalizePushValue(owner.sku)) ||
    (owner.gtin && gtinOf(created) && gtinOf(created) === String(owner.gtin).trim()),
  );
  return matches.length === 1 ? matches[0] : null;
}
