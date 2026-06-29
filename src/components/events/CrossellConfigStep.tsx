import { useEffect, useRef, useState } from "react";
import { Search, Plus, Trash2, Loader2, Ruler, Package, Gift } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fetchProducts, ShopifyProduct } from "@/lib/shopify";

export interface CrossellOfferDraft {
  id?: string;
  shopify_product_id: string;
  product_title: string;
  image: string | null;
  has_sizes: boolean;
  original_price: string;
  discount_price: string;
}

interface Props {
  noCrossell: boolean;
  offers: CrossellOfferDraft[];
  onChange: (next: { noCrossell: boolean; offers: CrossellOfferDraft[] }) => void;
}

const MAX_OFFERS = 5;
const SIZE_NAMES = ["tamanho", "numeracao", "numero", "size", "tam"];

const norm = (s: string) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Detect whether a Shopify product has a numeric size option (footwear)
function detectHasSizes(p: ShopifyProduct): boolean {
  const opt = (p.node.options || []).find((o) => SIZE_NAMES.includes(norm(o.name)));
  if (!opt) return false;
  return (opt.values || []).some((v) => /\b\d{2}([.,]\d)?\b/.test(v));
}

export function CrossellConfigStep({ noCrossell, offers, onChange }: Props) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebounced(search.trim()), 350);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  useEffect(() => {
    if (noCrossell) return;
    if (debounced.length < 2) {
      setResults([]);
      return;
    }
    let active = true;
    setLoading(true);
    fetchProducts(20, debounced)
      .then((list) => active && setResults(list))
      .catch(() => active && setResults([]))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [debounced, noCrossell]);

  const update = (patch: Partial<{ noCrossell: boolean; offers: CrossellOfferDraft[] }>) =>
    onChange({ noCrossell, offers, ...patch });

  const addProduct = (p: ShopifyProduct) => {
    if (offers.length >= MAX_OFFERS) return;
    if (offers.some((o) => o.shopify_product_id === p.node.id)) return;
    const draft: CrossellOfferDraft = {
      shopify_product_id: p.node.id,
      product_title: p.node.title,
      image: p.node.images?.edges?.[0]?.node?.url || null,
      has_sizes: detectHasSizes(p),
      original_price: p.node.priceRange?.minVariantPrice?.amount
        ? Number(p.node.priceRange.minVariantPrice.amount).toFixed(2)
        : "",
      discount_price: "",
    };
    update({ offers: [...offers, draft] });
    setSearch("");
    setResults([]);
  };

  const patchOffer = (idx: number, patch: Partial<CrossellOfferDraft>) => {
    const next = offers.map((o, i) => (i === idx ? { ...o, ...patch } : o));
    update({ offers: next });
  };

  const removeOffer = (idx: number) => update({ offers: offers.filter((_, i) => i !== idx) });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Selecione de 3 a 5 produtos da Shopify para oferecer como <strong>oferta especial</strong> no
        link do checkout. A oferta só aparece para quem já adicionou um produto ao carrinho, e nunca
        repete um produto que o cliente já tem.
      </p>

      {/* Toggle: sem crossell */}
      <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-4">
        <div className="flex items-center gap-2">
          <Gift className="h-5 w-5 text-accent" />
          <div>
            <div className="text-sm font-medium">Realizar evento sem crossell</div>
            <div className="text-xs text-muted-foreground">
              Nenhuma oferta extra será exibida no checkout deste evento.
            </div>
          </div>
        </div>
        <Switch checked={noCrossell} onCheckedChange={(v) => update({ noCrossell: v })} />
      </div>

      {!noCrossell && (
        <>
          {/* Search */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-xs font-semibold">
              <Search className="h-4 w-4 text-accent" /> Buscar produto na Shopify
            </Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Digite o nome do produto..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                disabled={offers.length >= MAX_OFFERS}
              />
            </div>
            {offers.length >= MAX_OFFERS && (
              <p className="text-xs text-amber-600">Limite de {MAX_OFFERS} ofertas atingido.</p>
            )}

            {(loading || results.length > 0) && (
              <ScrollArea className="max-h-52 rounded-md border">
                <div className="divide-y">
                  {loading && (
                    <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Buscando...
                    </div>
                  )}
                  {!loading &&
                    results.map((p) => {
                      const added = offers.some((o) => o.shopify_product_id === p.node.id);
                      return (
                        <button
                          key={p.node.id}
                          type="button"
                          disabled={added}
                          onClick={() => addProduct(p)}
                          className="flex w-full items-center gap-3 p-2 text-left hover:bg-muted/50 disabled:opacity-50"
                        >
                          <img
                            src={p.node.images?.edges?.[0]?.node?.url}
                            alt=""
                            className="h-12 w-12 rounded object-cover bg-muted"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{p.node.title}</div>
                            <div className="text-xs text-muted-foreground">
                              {detectHasSizes(p) ? "Calçado (com tamanho)" : "Sem tamanho"}
                            </div>
                          </div>
                          {added ? (
                            <Badge variant="secondary">Adicionado</Badge>
                          ) : (
                            <Plus className="h-4 w-4 text-accent" />
                          )}
                        </button>
                      );
                    })}
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Selected offers */}
          <div className="space-y-3">
            <Label className="text-xs font-semibold text-muted-foreground">
              Ofertas selecionadas ({offers.length})
            </Label>
            {offers.length === 0 && (
              <p className="text-sm text-muted-foreground rounded-md border border-dashed p-4 text-center">
                Nenhuma oferta selecionada ainda.
              </p>
            )}
            {offers.map((o, idx) => (
              <div key={o.shopify_product_id} className="rounded-lg border bg-card p-3">
                <div className="flex items-start gap-3">
                  <img
                    src={o.image || undefined}
                    alt=""
                    className="h-16 w-16 rounded object-cover bg-muted"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{o.product_title}</span>
                      <Badge variant="outline" className="gap-1 text-[10px]">
                        {o.has_sizes ? <Ruler className="h-3 w-3" /> : <Package className="h-3 w-3" />}
                        {o.has_sizes ? "Calçado" : "Sem tamanho"}
                      </Badge>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-[11px]">Valor original (R$)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={o.original_price}
                          onChange={(e) => patchOffer(idx, { original_price: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label className="text-[11px] text-accent">Valor com desconto (R$)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={o.discount_price}
                          onChange={(e) => patchOffer(idx, { discount_price: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Switch
                        checked={o.has_sizes}
                        onCheckedChange={(v) => patchOffer(idx, { has_sizes: v })}
                        id={`hassize-${idx}`}
                      />
                      <Label htmlFor={`hassize-${idx}`} className="text-[11px] text-muted-foreground">
                        Filtrar pelo tamanho do cliente (calçados)
                      </Label>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    onClick={() => removeOffer(idx)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
