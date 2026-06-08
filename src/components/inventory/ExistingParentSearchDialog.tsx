import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Search, Package, Link2 } from "lucide-react";

interface ParentResult {
  parent_sku: string;
  name: string;
  variant_count: number;
  total_stock: number;
}

/**
 * Busca um PRODUTO PAI existente no PDV (pos_products) por nome/SKU/parent_sku,
 * agrupando por parent_sku, para vincular linhas da NF-e a ele.
 */
export function ExistingParentSearchDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSelect: (parentSku: string, name: string) => void;
}) {
  const [term, setTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ParentResult[]>([]);

  async function search() {
    const q = term.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    const like = `%${q}%`;
    const { data } = await supabase
      .from("pos_products")
      .select("parent_sku, name, sku, barcode, stock")
      .or(`name.ilike.${like},sku.ilike.${like},parent_sku.ilike.${like},barcode.ilike.${like}`)
      .not("parent_sku", "is", null)
      .limit(400);

    // Agrupa por parent_sku
    const map = new Map<string, ParentResult>();
    for (const r of (data || []) as any[]) {
      if (!r.parent_sku) continue;
      const existing = map.get(r.parent_sku);
      const baseName = (r.name || "").includes(" - ")
        ? (r.name as string).slice(0, (r.name as string).lastIndexOf(" - "))
        : r.name;
      if (existing) {
        existing.variant_count += 1;
        existing.total_stock += Number(r.stock) || 0;
      } else {
        map.set(r.parent_sku, {
          parent_sku: r.parent_sku,
          name: baseName || r.parent_sku,
          variant_count: 1,
          total_stock: Number(r.stock) || 0,
        });
      }
    }
    setResults([...map.values()].slice(0, 50));
    setLoading(false);
  }

  useEffect(() => {
    if (!open) {
      setTerm("");
      setResults([]);
      return;
    }
  }, [open]);

  useEffect(() => {
    const t = setTimeout(search, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" /> Vincular a produto pai existente
          </DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            className="pl-8"
            placeholder="Buscar por nome, SKU ou GTIN..."
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>

        <div className="max-h-[55vh] overflow-y-auto space-y-1.5 mt-1">
          {loading && (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {!loading && term.trim().length >= 2 && results.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-6">Nenhum produto encontrado.</p>
          )}
          {!loading && term.trim().length < 2 && (
            <p className="text-center text-sm text-muted-foreground py-6">Digite ao menos 2 caracteres.</p>
          )}
          {results.map((r) => (
            <button
              key={r.parent_sku}
              onClick={() => onSelect(r.parent_sku, r.name)}
              className="w-full text-left flex items-center gap-3 p-2.5 rounded border hover:bg-muted/50 transition"
            >
              <Package className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{r.name}</div>
                <div className="text-xs text-muted-foreground">
                  {r.parent_sku} · {r.variant_count} variações · estoque {r.total_stock}
                </div>
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
