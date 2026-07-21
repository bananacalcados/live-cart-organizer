import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Plus, X, Search } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: "category" | "brand";
  entityId: string;
  entityName: string;
  onChanged?: () => void;
}

interface Row {
  parent_sku: string;
  name: string;
  brand: string | null;
  category: string | null;
  cost_price: number | null;
  sale_price: number | null;
  images: string[] | null;
}

export function ManageLinkedProductsDialog({
  open, onOpenChange, mode, entityId, entityName, onChanged,
}: Props) {
  const idCol = mode === "category" ? "category_id" : "brand_id";
  const [linked, setLinked] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"linked" | "add">("linked");

  // add tab
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  async function loadLinked() {
    setLoading(true);
    const { data } = await supabase
      .from("product_master_data")
      .select("parent_sku,name,brand,category,cost_price,sale_price,images")
      .eq(idCol, entityId)
      .order("name")
      .limit(500);
    setLinked((data || []) as any);
    setLoading(false);
  }

  async function loadCandidates() {
    setLoading(true);
    let q = supabase
      .from("product_master_data")
      .select("parent_sku,name,brand,category,cost_price,sale_price,images")
      .neq(idCol, entityId)
      .order("name")
      .limit(200);
    if (search.trim()) {
      q = q.or(`name.ilike.%${search.trim()}%,parent_sku.ilike.%${search.trim()}%`);
    } else {
      // when no search, prefer products that DON'T have this field yet
      q = supabase
        .from("product_master_data")
        .select("parent_sku,name,brand,category,cost_price,sale_price,images")
        .is(idCol, null)
        .order("name")
        .limit(200);
    }
    const { data } = await q;
    setCandidates((data || []) as any);
    setSelected(new Set());
    setLoading(false);
  }

  useEffect(() => {
    if (!open) return;
    setTab("linked");
    setSearch("");
    loadLinked();
  }, [open, entityId]);

  useEffect(() => {
    if (!open || tab !== "add") return;
    const t = setTimeout(loadCandidates, 250);
    return () => clearTimeout(t);
  }, [tab, search, open]);

  async function linkSelected() {
    if (selected.size === 0) return;
    setSaving(true);
    const { error } = await supabase
      .from("product_master_data")
      .update({ [idCol]: entityId } as any)
      .in("parent_sku", Array.from(selected));
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${selected.size} produto(s) vinculado(s)`);
    setSelected(new Set());
    await loadLinked();
    setTab("linked");
    onChanged?.();
  }

  async function unlink(sku: string) {
    const { error } = await supabase
      .from("product_master_data")
      .update({ [idCol]: null, [mode === "category" ? "category" : "brand"]: null } as any)
      .eq("parent_sku", sku);
    if (error) { toast.error(error.message); return; }
    toast.success("Removido");
    await loadLinked();
    onChanged?.();
  }

  const linkedCount = linked.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "category" ? "Categoria" : "Marca"}: {entityName}
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-1 border-b">
          <button
            className={`px-3 py-2 text-sm font-medium border-b-2 ${tab === "linked" ? "border-primary" : "border-transparent text-muted-foreground"}`}
            onClick={() => setTab("linked")}
          >
            Produtos vinculados ({linkedCount})
          </button>
          <button
            className={`px-3 py-2 text-sm font-medium border-b-2 ${tab === "add" ? "border-primary" : "border-transparent text-muted-foreground"}`}
            onClick={() => setTab("add")}
          >
            <Plus className="h-3 w-3 inline mr-1" /> Vincular produtos
          </button>
        </div>

        {tab === "linked" && (
          <ScrollArea className="max-h-[60vh]">
            {loading ? <Loader2 className="animate-spin m-4" /> : linked.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Nenhum produto vinculado. Use "Vincular produtos" para adicionar.
              </p>
            ) : (
              <div className="divide-y">
                {linked.map(p => (
                  <div key={p.parent_sku} className="flex items-center gap-3 py-2 px-1">
                    {p.images?.[0] && (
                      <img src={p.images[0]} className="h-10 w-10 rounded object-cover" alt="" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{p.name}</p>
                      <div className="flex gap-1 mt-0.5 flex-wrap">
                        <Badge variant="outline" className="text-[10px]">{p.parent_sku}</Badge>
                        {mode === "category" && p.brand && <Badge variant="secondary" className="text-[10px]">{p.brand}</Badge>}
                        {mode === "brand" && p.category && <Badge variant="secondary" className="text-[10px]">{p.category}</Badge>}
                        {p.sale_price != null && <Badge variant="outline" className="text-[10px]">R$ {Number(p.sale_price).toFixed(2)}</Badge>}
                      </div>
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => unlink(p.parent_sku)} title="Remover">
                      <X className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        )}

        {tab === "add" && (
          <>
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome ou SKU..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <ScrollArea className="max-h-[50vh]">
              {loading ? <Loader2 className="animate-spin m-4" /> : candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  {search ? "Nenhum produto encontrado." : "Todos os produtos já têm essa " + (mode === "category" ? "categoria" : "marca") + "."}
                </p>
              ) : (
                <div className="divide-y">
                  {candidates.map(p => {
                    const checked = selected.has(p.parent_sku);
                    return (
                      <label key={p.parent_sku} className="flex items-center gap-3 py-2 px-1 cursor-pointer hover:bg-muted/50">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const s = new Set(selected);
                            checked ? s.delete(p.parent_sku) : s.add(p.parent_sku);
                            setSelected(s);
                          }}
                        />
                        {p.images?.[0] && (
                          <img src={p.images[0]} className="h-8 w-8 rounded object-cover" alt="" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate">{p.name}</p>
                          <div className="flex gap-1 flex-wrap">
                            <Badge variant="outline" className="text-[10px]">{p.parent_sku}</Badge>
                            {mode === "category" && p.category && <Badge variant="secondary" className="text-[10px]">atual: {p.category}</Badge>}
                            {mode === "brand" && p.brand && <Badge variant="secondary" className="text-[10px]">atual: {p.brand}</Badge>}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
            <DialogFooter>
              <p className="text-xs text-muted-foreground mr-auto self-center">
                {selected.size} selecionado(s)
              </p>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
              <Button onClick={linkSelected} disabled={saving || selected.size === 0}>
                {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Vincular {selected.size > 0 ? `(${selected.size})` : ""}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
