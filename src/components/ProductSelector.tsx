import { useState, useEffect } from "react";
import { Search, Plus, Minus, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fetchProducts, ShopifyProduct } from "@/lib/shopify";
import { OrderProduct } from "@/types/order";

interface ProductSelectorProps {
  selectedProducts: OrderProduct[];
  onAddProduct: (product: OrderProduct) => void;
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

  useEffect(() => {
    loadProducts();
  }, []);

  const loadProducts = async () => {
    setLoading(true);
    const data = await fetchProducts(50);
    setProducts(data);
    setLoading(false);
  };

  const filteredProducts = products.filter((p) =>
    p.node.title.toLowerCase().includes(search.toLowerCase())
  );

  const handleAddProduct = (product: ShopifyProduct, variantIndex: number = 0) => {
    const variant = product.node.variants.edges[variantIndex]?.node;
    if (!variant) return;

    const orderProduct: OrderProduct = {
      id: `${product.node.id}-${variant.id}`,
      shopifyId: product.node.id,
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
        <ScrollArea className="h-[300px]">
          <div className="space-y-2 pr-4">
            {filteredProducts.length === 0 ? (
              <p className="text-center text-muted-foreground py-4">
                Nenhum produto encontrado
              </p>
            ) : (
              filteredProducts.map((product) => {
                const variant = product.node.variants.edges[0]?.node;
                if (!variant) return null;

                const quantity = getSelectedQuantity(product.node.id, variant.id);
                const isSelected = quantity > 0;

                return (
                  <div
                    key={product.node.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    {product.node.images.edges[0]?.node && (
                      <img
                        src={product.node.images.edges[0].node.url}
                        alt={product.node.title}
                        className="w-14 h-14 rounded-md object-cover"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">
                        {product.node.title}
                      </p>
                      <p className="text-sm text-accent font-semibold">
                        R${" "}
                        {parseFloat(
                          product.node.priceRange.minVariantPrice.amount
                        ).toFixed(2)}
                      </p>
                    </div>

                    {isSelected ? (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() =>
                            onUpdateQuantity(
                              `${product.node.id}-${variant.id}`,
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
                              `${product.node.id}-${variant.id}`,
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
                        onClick={() => handleAddProduct(product)}
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Adicionar
                      </Button>
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
