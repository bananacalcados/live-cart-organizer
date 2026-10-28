export const normalize = (value: unknown): string => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

export function productData(master: any) {
  // Photos are deliberately excluded: updating data must not replace media or variant associations.
  return {
    title: master.name,
    descriptionHtml: master.description || "",
    vendor: master.brand || "",
    productType: master.category || "",
    status: master.is_active ? "ACTIVE" : "DRAFT",
  };
}

export function optionValue(variant: any, name: string): string {
  const key = normalize(name);
  if (/cor|color|colour/.test(key)) return String(variant.color || "Único").trim();
  if (/tam|size/.test(key)) return String(variant.size || "Único").trim();
  throw new Error(`Opção "${name}" não reconhecida. Nada foi atualizado; confira as opções na Shopify.`);
}

export function exactColor(objects: any[], name: string): string {
  const matches = objects.filter((object) => normalize(object.displayName) === normalize(name));
  if (matches.length !== 1) {
    const available = objects.map((o) => String(o.displayName)).sort().join(", ");
    const why = matches.length === 0 ? "não existe" : `existe ${matches.length} vezes`;
    throw new Error(`A cor "${name}" ${why} na lista de cores da Shopify. Nada foi atualizado. Cores disponíveis: ${available}`);
  }
  return matches[0].id;
}

export function planVariants(variants: any[], product: any, colorObjects: any[]) {
  const additions = new Map<string, { optionId: string; gid: string }>();
  const create: any[] = [];
  const update: any[] = [];
  const links: any[] = [];
  const claimed = new Set<string>();
  const combos = new Set<string>();
  for (const variant of variants) {
    const linked = (product.variants.nodes as any[]).find((existing) => existing.id.split("/").pop() === String(variant.shopify_variant_id));
    const values = product.options.map((option: any) => {
      // Existing local↔Shopify links preserve manual legacy option naming.
      const oldValue = linked?.selectedOptions.find((selected: any) => selected.name === option.name)?.value;
      const value = oldValue || optionValue(variant, option.name);
      const matches = option.optionValues.filter((ov: any) => normalize(ov.name) === normalize(value));
      if (matches.length > 1) throw new Error(`Opção ambígua: ${option.name} / ${value}`);
      const existing = matches[0];
      if (existing) return { optionName: option.name, name: existing.name, id: existing.id };
      if (option.linkedMetafield) {
        if (option.linkedMetafield.namespace !== "shopify" || option.linkedMetafield.key !== "color-pattern") {
          throw new Error(`A opção vinculada "${option.name}" precisa de conferência. Nada foi atualizado.`);
        }
        const gid = exactColor(colorObjects, value);
        additions.set(`${option.id}:${gid}`, { optionId: option.id, gid });
        return { optionName: option.name, name: value, linkedMetafieldValue: gid };
      }
      return { optionName: option.name, name: value };
    });
    const key = values.map((ov: any) => normalize(ov.name)).join("|");
    if (combos.has(key)) throw new Error(`Cor/tamanho duplicados no cadastro: ${variant.color} / ${variant.size}. Nada foi atualizado.`);
    combos.add(key);
    const match = linked || product.variants.nodes.find((existing: any) =>
      product.options.map((option: any) => normalize(existing.selectedOptions.find((so: any) => so.name === option.name)?.value)).join("|") === key,
    );
    const input = {
      price: String(variant.sale_price_override ?? 0),
      barcode: variant.gtin || null,
      inventoryItem: {
        sku: variant.sku || null,
        tracked: true,
        requiresShipping: true,
        measurement: { weight: { value: Number(variant.weight_kg_override ?? 0), unit: "KILOGRAMS" } },
      },
    };
    if (match) {
      if (claimed.has(match.id)) throw new Error("Duas variações locais apontam para a mesma variação Shopify. Nada foi atualizado.");
      // Never claim another existing combination based on color/size alone.
      if (!linked && !((variant.gtin && String(match.barcode) === String(variant.gtin)) ||
        (variant.sku && normalize(match.inventoryItem?.sku) === normalize(variant.sku)))) {
        throw new Error(`A combinação ${variant.color} / ${variant.size} já existe com outro código na Shopify. Confira o vínculo; nada foi atualizado.`);
      }
      claimed.add(match.id);
      update.push({ id: match.id, ...input });
      if (String(variant.shopify_variant_id) !== match.id.split("/").pop()) links.push({ variant_id: variant.id, shopify_variant_id: match.id.split("/").pop() });
    } else {
      create.push({ owner: variant, input: { ...input, optionValues: values } });
    }
  }
  return { additions: [...additions.values()], create, update, links };
}

export function resolveOptionInputs(values: any[], options: any[]) {
  return values.map((value) => {
    if (!value.linkedMetafieldValue) return value.id ? { optionName: value.optionName, id: value.id } : { optionName: value.optionName, name: value.name };
    const option = options.find((item) => item.name === value.optionName);
    const linked = option?.optionValues.find((item: any) => item.linkedMetafieldValue === value.linkedMetafieldValue);
    if (!linked?.id) throw new Error(`A Shopify não confirmou a cor "${value.name}"; nenhuma variação foi criada.`);
    return { optionName: value.optionName, id: linked.id };
  });
}