import { useState, useEffect } from "react";
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
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [selectedVariants, setSelectedVariants] = useState<Record<string, number>>({});

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch products when search changes
  useEffect(() => {
    loadProducts(debouncedSearch);
  }, [debouncedSearch]);

  const loadProducts = async (searchQuery: string = "") => {
    setLoading(true);
    const query = searchQuery.trim() ? `title:*${searchQuery}*` : undefined;
    const data = await fetchProducts(250, query);
    setProducts(data);
    setLoading(false);
  };

  const handleAddProduct = (product: ShopifyProduct, variantIndex: number = 0) => {
    const variant = product.node.variants.edges[variantIndex]?.node;
    if (!variant) return;

    const orderProduct: DbOrderProduct = {
      id: `${product.node.id}-${variant.id}`,
      shopifyId: variant.id, // Use variant ID for cart API, not product ID
      title: product.node.title,
      variant: variant.title !== "Default Title" ? variant.title : "",
      price: parseFloat(variant.price.amount),
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
    return variant.title;
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar produtos..."
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
                        <p className="text-sm text-accent font-semibold">
                          R$ {parseFloat(currentVariant.price.amount).toFixed(2)}
                        </p>
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
                                  const newVariantIndex = variants.findIndex((v) => {
                                    const optionValue = v.node.selectedOptions.find(
                                      (o) => o.name === option.name
                                    )?.value;
                                    return optionValue === value;
                                  });
                                  if (newVariantIndex >= 0) {
                                    setSelectedVariants((prev) => ({
                                      ...prev,
                                      [product.node.id]: newVariantIndex,
                                    }));
                                  }
                                }}
                              >
                                <SelectTrigger className="h-8 text-sm">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
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

                        {/* Show all variants as quick buttons */}
                        <div className="mt-3 flex flex-wrap gap-1">
                          {variants.map((variant, idx) => {
                            const variantQty = getSelectedQuantity(product.node.id, variant.node.id);
                            const isVariantSelected = variantQty > 0;
                            
                            return (
                              <Button
                                key={variant.node.id}
                                variant={isVariantSelected ? "default" : "outline"}
                                size="sm"
                                className="text-xs h-7 px-2"
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
