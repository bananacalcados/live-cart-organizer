import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Search, PackageCheck, Loader2, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUserId } from "@/hooks/useCurrentUserId";
import { toast } from "sonner";

interface PosProductRow {
  id: string;
  name: string;
  size: string | null;
  color: string | null;
  barcode: string | null;
  parent_sku: string | null;
  image_url: string | null;
  stock: number | null;
  store_id: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phone: string;
  customerName?: string;
  whatsappNumberId?: string | null;
  storeId?: string | null;
  sellerName?: string | null;
  onSaved?: () => void;
}

/**
 * Permite anotar que o cliente da conversa atual está aguardando a reposição de
 * um produto específico. A vendedora pesquisa no estoque (pos_products) e escolhe
 * a variação exata (cor + tamanho). Quando essa variação ganhar estoque, o
 * sistema avisa automaticamente.
 */
export function ProductWaitlistDialog({
  open,
  onOpenChange,
  phone,
  customerName,
  whatsappNumberId,
  storeId,
  sellerName,
  onSaved,
}: Props) {
  const currentUserId = useCurrentUserId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PosProductRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<PosProductRow | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setSelected(null);
      setNotes("");
    }
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let alive = true;
    setSearching(true);
    const t = setTimeout(async () => {
      const like = `%${q}%`;
      const { data, error } = await supabase
        .from("pos_products")
        .select("id, name, size, color, barcode, parent_sku, image_url, stock, store_id")
        .or(`name.ilike.${like},sku.ilike.${like},barcode.ilike.${like},parent_sku.ilike.${like}`)
        .order("name", { ascending: true })
        .limit(80);
      if (!alive) return;
      if (error) {
        console.error("[ProductWaitlist] search error", error);
        setResults([]);
      } else {
        setResults((data || []) as PosProductRow[]);
      }
      setSearching(false);
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query]);

  // Agrupa variações idênticas (mesma cor+tamanho) somando o estoque entre lojas,
  // já que o estoque é compartilhado. Mostra uma linha por variação.
  const grouped = useMemo(() => {
    const map = new Map<string, PosProductRow & { totalStock: number }>();
    for (const r of results) {
      const key = (r.barcode && r.barcode.trim())
        ? `b:${r.barcode}`
        : `v:${(r.parent_sku || r.name).toLowerCase()}|${(r.size || "").toLowerCase()}|${(r.color || "").toLowerCase()}`;
      const existing = map.get(key);
      if (existing) {
        existing.totalStock += Number(r.stock || 0);
        if (!existing.image_url && r.image_url) existing.image_url = r.image_url;
      } else {
        map.set(key, { ...r, totalStock: Number(r.stock || 0) });
      }
    }
    return Array.from(map.values());
  }, [results]);

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    const { error } = await (supabase as any).from("product_wait_notifications").insert({
      phone,
      customer_name: customerName || null,
      whatsapp_number_id: whatsappNumberId || null,
      store_id: storeId || selected.store_id || null,
      pos_product_id: selected.id,
      product_name: selected.name,
      size: selected.size,
      color: selected.color,
      barcode: selected.barcode,
      parent_sku: selected.parent_sku,
      image_url: selected.image_url,
      requested_by_user_id: currentUserId || null,
      requested_by_name: sellerName || null,
      status: "waiting",
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (error) {
      console.error("[ProductWaitlist] insert error", error);
      toast.error("Erro ao anotar aguardando produto");
      return;
    }
    toast.success("Cliente marcado como aguardando reposição 📦");
    onSaved?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 overflow-hidden gap-0">
        <DialogHeader className="px-4 py-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <PackageCheck className="h-5 w-5 text-amber-500" />
            Aguardando produto
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            {customerName || phone} será avisado quando a variação chegar no estoque.
          </p>
        </DialogHeader>

        <div className="p-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              autoFocus
              placeholder="Buscar por nome, SKU ou código de barras..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {selected ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3">
              <div className="flex items-center gap-3">
                {selected.image_url ? (
                  <img src={selected.image_url} alt="" className="h-12 w-12 rounded object-cover" />
                ) : (
                  <div className="h-12 w-12 rounded bg-muted flex items-center justify-center">
                    <PackageCheck className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{selected.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {selected.size ? `Tam ${selected.size}` : "—"}
                    {selected.color ? ` · ${selected.color}` : ""}
                    {selected.barcode ? ` · ${selected.barcode}` : ""}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                  Trocar
                </Button>
              </div>
              <textarea
                placeholder="Observação (opcional)..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="mt-3 w-full text-sm rounded-md border border-input bg-background px-3 py-2 resize-none"
              />
            </div>
          ) : (
            <ScrollArea className="h-72 rounded-lg border">
              {searching ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground text-sm gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Buscando...
                </div>
              ) : grouped.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  {query.trim().length < 2 ? "Digite ao menos 2 letras para buscar" : "Nenhum produto encontrado"}
                </div>
              ) : (
                <div className="divide-y">
                  {grouped.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelected(p)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/60 transition"
                    >
                      {p.image_url ? (
                        <img src={p.image_url} alt="" className="h-10 w-10 rounded object-cover flex-shrink-0" />
                      ) : (
                        <div className="h-10 w-10 rounded bg-muted flex items-center justify-center flex-shrink-0">
                          <PackageCheck className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{p.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {p.size ? `Tam ${p.size}` : "—"}
                          {p.color ? ` · ${p.color}` : ""}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={p.totalStock > 0 ? "text-emerald-600 border-emerald-300" : "text-red-500 border-red-300"}
                      >
                        {p.totalStock > 0 ? `${p.totalStock} em estoque` : "Sem estoque"}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t bg-muted/30">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={!selected || saving} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Anotar aguardando
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
