import { useState, useEffect, useRef, useCallback } from "react";
import { Search, Plus, Minus, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fetchProducts, ShopifyProduct } from "@/lib/shopify";
import { DbOrderProduct } from "@/types/database";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ProductSelectorProps {
  selectedProducts: DbOrderProduct[];
  onAddProduct: (product: DbOrderProduct) => void;
  onRemoveProduct: (productId: string) => void;
  onUpdateQuantity: (productId: string, quantity: number) => void;
}

export function ProductSelector({
  selectedProducts,
  onAddProduct,
  onRemoveProduct,
  onUpdateQuantity,
}: ProductSelectorProps) {
  const [allProducts, setAllProducts] = useState<ShopifyProduct[]>([]);
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [selectedVariants, setSelectedVariants] = useState<Record<string, number>>({});
  const pendingAutoAddRef = useRef<{ product: ShopifyProduct; variantIndex: number } | null>(null);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Load all products once on mount
  useEffect(() => {
    loadAllProducts();
  }, []);

  // Process pending auto-add
  useEffect(() => {
    if (pendingAutoAddRef.current) {
      const { product, variantIndex } = pendingAutoAddRef.current;
      const variant = product.node.variants.edges[variantIndex]?.node;
      if (variant) {
        const existingId = `${product.node.id}-${variant.id}`;
        const alreadyAdded = selectedProducts.some((sp) => sp.id === existingId);
        if (!alreadyAdded) {
          const compareAt = variant.compareAtPrice ? parseFloat(variant.compareAtPrice.amount) : undefined;
          const price = parseFloat(variant.price.amount);
          onAddProduct({
            id: existingId,
            shopifyId: variant.id,
            sku: variant.sku || undefined,
            title: product.node.title,
            variant: variant.title !== "Default Title" ? variant.title : "",
            price,
            compareAtPrice: compareAt && compareAt > price ? compareAt : undefined,
            quantity: 1,
            image: variant.image?.url || product.node.images.edges[0]?.node.url,
          });
          setSearch("");
        }
      }
      pendingAutoAddRef.current = null;
    }
  });

  // Filter products when search changes
  useEffect(() => {
    if (!debouncedSearch.trim()) {
      setProducts(allProducts);
      return;
    }
    const q = debouncedSearch.trim().toLowerCase();
    const isSkuOrGtin = /^[a-z0-9\-]+$/i.test(q) && q.length >= 4 && !q.includes(" ");

    const filtered = allProducts.filter((p) => {
      if (p.node.title.toLowerCase().includes(q)) return true;
      return p.node.variants.edges.some(
        (v) =>
          (v.node.sku && v.node.sku.toLowerCase().includes(q)) ||
          (v.node.barcode && v.node.barcode.toLowerCase().includes(q))
      );
    });

    // Auto-select and auto-add when SKU/GTIN match found
    if (isSkuOrGtin) {
      for (const p of filtered) {
        const matchIdx = p.node.variants.edges.findIndex(
          (v) =>
            (v.node.sku && v.node.sku.toLowerCase() === q) ||
            (v.node.barcode && v.node.barcode.toLowerCase() === q) ||
            (v.node.sku && v.node.sku.toLowerCase().includes(q)) ||
            (v.node.barcode && v.node.barcode.toLowerCase().includes(q))
        );
        if (matchIdx >= 0) {
          setSelectedVariants((prev) => ({ ...prev, [p.node.id]: matchIdx }));
          pendingAutoAddRef.current = { product: p, variantIndex: matchIdx };
          break;
        }
      }
    } else {
      filtered.forEach((p) => {
        const matchIdx = p.node.variants.edges.findIndex(
          (v) =>
            (v.node.sku && v.node.sku.toLowerCase().includes(q)) ||
            (v.node.barcode && v.node.barcode.toLowerCase().includes(q))
        );
        if (matchIdx >= 0) {
          setSelectedVariants((prev) => ({ ...prev, [p.node.id]: matchIdx }));
        }
      });
    }

    setProducts(filtered);
  }, [debouncedSearch, allProducts]);

  const loadAllProducts = async () => {
    setLoading(true);
    const data = await fetchProducts(250);
    setAllProducts(data);
    setProducts(data);
    setLoading(false);
  };

  const handleAddProduct = (product: ShopifyProduct, variantIndex: number = 0) => {
    const variant = product.node.variants.edges[variantIndex]?.node;
    if (!variant) return;

    const compareAt = variant.compareAtPrice ? parseFloat(variant.compareAtPrice.amount) : undefined;
    const price = parseFloat(variant.price.amount);

    const orderProduct: DbOrderProduct = {
      id: `${product.node.id}-${variant.id}`,
      shopifyId: variant.id,
      sku: variant.sku || undefined,
      title: product.node.title,
      variant: variant.title !== "Default Title" ? variant.title : "",
      price,
      compareAtPrice: compareAt && compareAt > price ? compareAt : undefined,
      quantity: 1,
      image: product.node.images.edges[0]?.node.url,
    };

    onAddProduct(orderProduct);
  };

  const getSelectedQuantity = (productId: string, variantId: string) => {
    const selected = selectedProducts.find(
      (p) => p.id === `${productId}-${variantId}`
    );
    return selected?.quantity || 0;
  };

  const hasMultipleVariants = (product: ShopifyProduct) => {
    return product.node.variants.edges.length > 1;
  };

  const getVariantLabel = (variant: ShopifyProduct["node"]["variants"]["edges"][0]["node"]) => {
    if (variant.title === "Default Title") return "Padrão";
    const skuLabel = variant.sku ? ` (${variant.sku})` : "";
    return `${variant.title}${skuLabel}`;
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome, SKU ou GTIN..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <ScrollArea className="h-[350px]">
          <div className="space-y-2 pr-4">
            {products.length === 0 ? (
              <p className="text-center text-muted-foreground py-4">
                Nenhum produto encontrado
              </p>
            ) : (
              products.map((product) => {
                const variants = product.node.variants.edges;
                const hasVariants = hasMultipleVariants(product);
                const isExpanded = expandedProduct === product.node.id;
                const selectedVariantIndex = selectedVariants[product.node.id] || 0;
                const currentVariant = variants[selectedVariantIndex]?.node;

                if (!currentVariant) return null;

                const quantity = getSelectedQuantity(product.node.id, currentVariant.id);
                const isSelected = quantity > 0;

                return (
                  <div
                    key={product.node.id}
                    className={`rounded-lg border transition-colors ${
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <div className="flex items-center gap-3 p-3">
                      {product.node.images.edges[0]?.node && (
                        <img
                          src={product.node.images.edges[0].node.url}
                          alt={product.node.title}
                          className="w-14 h-14 rounded-md object-cover flex-shrink-0"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {product.node.title}
                        </p>
                        {hasVariants && (
                          <button
                            onClick={() => setExpandedProduct(isExpanded ? null : product.node.id)}
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-1"
                          >
                            {variants.length} variações
                            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          </button>
                        )}
                        {currentVariant.compareAtPrice && parseFloat(currentVariant.compareAtPrice.amount) > parseFloat(currentVariant.price.amount) ? (
                          <p className="text-sm">
                            <span className="text-muted-foreground line-through mr-1">
                              R$ {parseFloat(currentVariant.compareAtPrice.amount).toFixed(2)}
                            </span>
                            <span className="text-accent font-semibold">
                              R$ {parseFloat(currentVariant.price.amount).toFixed(2)}
                            </span>
                          </p>
                        ) : (
                          <p className="text-sm text-accent font-semibold">
                            R$ {parseFloat(currentVariant.price.amount).toFixed(2)}
                          </p>
                        )}
                      </div>

                      {isSelected ? (
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() =>
                              onUpdateQuantity(
                                `${product.node.id}-${currentVariant.id}`,
                                quantity - 1
                              )
                            }
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="w-8 text-center font-medium">
                            {quantity}
                          </span>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() =>
                              onUpdateQuantity(
                                `${product.node.id}-${currentVariant.id}`,
                                quantity + 1
                              )
                            }
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-shrink-0"
                          onClick={() => handleAddProduct(product, selectedVariantIndex)}
                        >
                          <Plus className="h-4 w-4 mr-1" />
                          Adicionar
                        </Button>
                      )}
                    </div>

                    {/* Variant selector */}
                    {hasVariants && isExpanded && (
                      <div className="px-3 pb-3 pt-1 border-t border-border/50">
                        <div className="space-y-2">
                          {product.node.options.map((option, optionIndex) => (
                            <div key={option.name} className="space-y-1">
                              <label className="text-xs font-medium text-muted-foreground">
                                {option.name}
                              </label>
                              <Select
                                value={
                                  currentVariant.selectedOptions.find(
                                    (o) => o.name === option.name
                                  )?.value || option.values[0]
                                }
                                onValueChange={(value) => {
                                  // Find the variant that matches the selected options
                                  const currentOptions = currentVariant.selectedOptions.map(o => ({
                                    name: o.name,
                                    value: o.name === option.name ? value : o.value
                                  }));
                                  
                                  const newVariantIndex = variants.findIndex((v) => {
                                    return currentOptions.every(co => {
                                      const variantOption = v.node.selectedOptions.find(vo => vo.name === co.name);
                                      return variantOption?.value === co.value;
                                    });
                                  });
                                  
                                  if (newVariantIndex >= 0) {
                                    setSelectedVariants((prev) => ({
                                      ...prev,
                                      [product.node.id]: newVariantIndex,
                                    }));
                                    // Auto-add product when selecting from dropdown
                                    const newVariant = variants[newVariantIndex]?.node;
                                    if (newVariant) {
                                      const existingQty = getSelectedQuantity(product.node.id, newVariant.id);
                                      if (existingQty === 0) {
                                        handleAddProduct(product, newVariantIndex);
                                      }
                                    }
                                  }
                                }}
                              >
                                <SelectTrigger className="h-8 text-sm">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="max-h-48 overflow-y-auto z-50">
                                  {option.values.map((value) => (
                                    <SelectItem key={value} value={value}>
                                      {value}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ))}
                        </div>

                        {/* Show all variants as scrollable buttons */}
                        <div className="mt-3 max-h-32 overflow-y-auto">
                          <div className="flex flex-wrap gap-1">
                            {variants.map((variant, idx) => {
                              const variantQty = getSelectedQuantity(product.node.id, variant.node.id);
                              const isVariantSelected = variantQty > 0;
                              
                              return (
                                <Button
                                  key={variant.node.id}
                                  variant={isVariantSelected ? "default" : "outline"}
                                  size="sm"
                                  className="text-xs h-7 px-2 whitespace-nowrap"
                                  onClick={() => {
                                    if (isVariantSelected) {
                                      onUpdateQuantity(
                                        `${product.node.id}-${variant.node.id}`,
                                        variantQty + 1
                                      );
                                    } else {
                                      setSelectedVariants((prev) => ({
                                        ...prev,
                                        [product.node.id]: idx,
                                      }));
                                      handleAddProduct(product, idx);
                                    }
                                  }}
                                  disabled={!variant.node.availableForSale}
                                >
                                  {getVariantLabel(variant.node)}
                                  {isVariantSelected && ` (${variantQty})`}
                                  {!variant.node.availableForSale && " - Esgotado"}
                                </Button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
