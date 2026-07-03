import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Pagination, PaginationContent, PaginationItem, PaginationPrevious, PaginationNext,
} from "@/components/ui/pagination";
import { Loader2, Search, Package, User, ChevronRight, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 12;

export interface ConditionalCartItem {
  id: string;
  tiny_id?: number;
  sku: string;
  name: string;
  variant: string;
  size?: string;
  category?: string;
  price: number;
  quantity: number;
  barcode: string;
  stock?: number;
}

export interface ConditionalCustomer {
  id?: string;
  name?: string;
  cpf?: string;
  whatsapp?: string;
  email?: string;
  cep?: string;
  address?: string;
  address_number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
}

export interface ConditionalPickResult {
  saleId: string;
  storeId: string | null;
  customer: ConditionalCustomer;
  items: ConditionalCartItem[];
  originalItems: Array<{ sku: string; barcode: string; name: string; variant: string; quantity: number; unit_price: number }>;
}

interface CondSale {
  id: string;
  store_id: string | null;
  notes: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_cpf: string | null;
  total: number | null;
  created_at: string;
}

interface Props {
  open: boolean;
  storeId?: string | null;
  onCancel: () => void;
  onConfirm: (result: ConditionalPickResult) => void;
}

export function ConditionalFinalizePicker({ open, storeId, onCancel, onConfirm }: Props) {
  const [sales, setSales] = useState<CondSale[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loadingOrder, setLoadingOrder] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSales([]);
      setPage(0);
      setSearch("");
      setDebouncedSearch("");
    }
  }, [open]);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search.trim()); setPage(0); }, 450);
    return () => clearTimeout(t);
  }, [search]);

  const loadSales = useCallback(async () => {
    setLoading(true);
    try {
      let q = supabase
        .from("pos_sales")
        .select("id, store_id, notes, customer_name, customer_phone, customer_cpf, total, created_at")
        .eq("is_conditional", true)
        .eq("conditional_status", "draft_sent")
        .eq("status", "conditional")
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

      if (debouncedSearch) {
        const term = debouncedSearch;
        const digits = term.replace(/\D/g, "");
        const ors = [`customer_name.ilike.%${term}%`, `notes.ilike.%${term}%`];
        if (digits) {
          ors.push(`customer_phone.ilike.%${digits}%`);
          ors.push(`customer_cpf.ilike.%${digits}%`);
        }
        q = q.or(ors.join(","));
      }

      const { data, error } = await q;
      if (error) throw error;
      const rows = (data || []) as CondSale[];
      setHasMore(rows.length > PAGE_SIZE);
      setSales(rows.slice(0, PAGE_SIZE));
    } catch (e: any) {
      console.error("[ConditionalFinalizePicker] loadSales", e);
      toast.error("Erro ao carregar condicionais");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch]);

  useEffect(() => {
    if (open) loadSales();
  }, [open, loadSales]);

  const selectSale = async (sale: CondSale) => {
    setLoadingOrder(sale.id);
    try {
      const { data: items, error: itemsErr } = await supabase
        .from("pos_sale_items")
        .select("sku, product_name, variant_name, size, category, unit_price, quantity, barcode, tiny_product_id")
        .eq("sale_id", sale.id);
      if (itemsErr) throw itemsErr;

      const skus = [...new Set((items || []).map((i: any) => (i.sku || "").trim()).filter(Boolean))];
      const bySku = new Map<string, { barcode: string; tiny_id?: number; stock?: number }>();
      if (skus.length > 0) {
        const { data: prods } = await supabase
          .from("pos_products")
          .select("sku, barcode, tiny_id, stock")
          .in("sku", skus);
        for (const p of prods || []) {
          const k = String((p as any).sku || "");
          if (k && !bySku.has(k)) {
            bySku.set(k, { barcode: (p as any).barcode || "", tiny_id: (p as any).tiny_id ?? undefined, stock: (p as any).stock ?? undefined });
          }
        }
      }

      const cartItems: ConditionalCartItem[] = (items || []).map((i: any, idx: number) => {
        const resolved = bySku.get(String(i.sku || "")) || { barcode: "", tiny_id: undefined, stock: undefined };
        return {
          id: `cond-${sale.id}-${idx}`,
          tiny_id: i.tiny_product_id ?? resolved.tiny_id,
          sku: i.sku || "",
          name: i.product_name || "Produto",
          variant: i.variant_name || "",
          size: i.size || undefined,
          category: i.category || undefined,
          price: Number(i.unit_price || 0),
          quantity: Number(i.quantity || 1),
          barcode: (i.barcode || resolved.barcode || "") as string,
          stock: resolved.stock,
        };
      });

      const originalItems = cartItems.map((c) => ({
        sku: c.sku, barcode: c.barcode, name: c.name, variant: c.variant,
        quantity: c.quantity, unit_price: c.price,
      }));

      const { data: full } = await supabase
        .from("pos_sales")
        .select("customer_id, customer_name, customer_phone, customer_cpf, customer_email, customer_cep, customer_city, customer_state, shipping_address")
        .eq("id", sale.id)
        .maybeSingle();
      const addr: any = (full as any)?.shipping_address || {};
      const customer: ConditionalCustomer = {
        id: (full as any)?.customer_id || undefined,
        name: (full as any)?.customer_name || addr.name || undefined,
        cpf: (full as any)?.customer_cpf || addr.cpf || undefined,
        whatsapp: (full as any)?.customer_phone || addr.phone || undefined,
        email: (full as any)?.customer_email || undefined,
        cep: (full as any)?.customer_cep || addr.cep || undefined,
        address: addr.address || undefined,
        address_number: addr.address_number || addr.number || undefined,
        complement: addr.complement || undefined,
        neighborhood: addr.neighborhood || undefined,
        city: (full as any)?.customer_city || addr.city || undefined,
        state: (full as any)?.customer_state || addr.state || undefined,
      };

      onConfirm({
        saleId: sale.id,
        storeId: sale.store_id,
        customer,
        items: cartItems,
        originalItems,
      });
    } catch (e: any) {
      console.error("[ConditionalFinalizePicker] selectSale", e);
      toast.error("Erro ao puxar o condicional");
    } finally {
      setLoadingOrder(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="bg-pos-black border-emerald-500/40 max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-pos-white text-xl flex items-center gap-2">
            <Package className="h-5 w-5 text-emerald-400" /> Finalizar condicional
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-pos-white/40" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, telefone ou CPF"
              className="pl-8 bg-pos-white/5 border-emerald-500/30 text-pos-white"
            />
          </div>

          <ScrollArea className="h-[46vh] pr-2">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-pos-white/50">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando condicionais...
              </div>
            ) : sales.length === 0 ? (
              <div className="text-center py-10 text-pos-white/50 text-sm">Nenhum condicional em aberto.</div>
            ) : (
              <div className="space-y-2">
                {sales.map((s) => (
                  <button
                    key={s.id}
                    disabled={loadingOrder === s.id}
                    onClick={() => selectSale(s)}
                    className={cn(
                      "w-full text-left rounded-xl border p-3 transition-all flex items-center justify-between gap-3",
                      "border-emerald-500/20 bg-pos-white/5 hover:border-emerald-400 hover:bg-emerald-500/10",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-pos-white text-sm">
                          {s.customer_name || "Sem nome"}
                        </span>
                        <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[10px]">📦 Condicional</Badge>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-pos-white/60 mt-0.5 truncate">
                        <User className="h-3 w-3 shrink-0" />
                        {s.customer_phone || "sem telefone"}
                        {s.customer_cpf ? ` · ${s.customer_cpf}` : ""}
                      </div>
                      <div className="text-[11px] text-pos-white/40 mt-0.5">
                        {new Date(s.created_at).toLocaleString("pt-BR")} · R$ {Number(s.total || 0).toFixed(2)}
                      </div>
                    </div>
                    {loadingOrder === s.id
                      ? <Loader2 className="h-4 w-4 animate-spin text-emerald-400 shrink-0" />
                      : <ChevronRight className="h-4 w-4 text-pos-white/40 shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>

          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" className="text-pos-white/60" onClick={onCancel}>
              Cancelar
            </Button>
            <Pagination className="mx-0 w-auto">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    className={cn("text-pos-white/70 hover:text-pos-white", page === 0 && "opacity-40 pointer-events-none")}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  />
                </PaginationItem>
                <PaginationItem>
                  <span className="px-3 text-sm text-pos-white/60">Pág. {page + 1}</span>
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    className={cn("text-pos-white/70 hover:text-pos-white", !hasMore && "opacity-40 pointer-events-none")}
                    onClick={() => hasMore && setPage((p) => p + 1)}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>

          <p className="flex items-start gap-1.5 text-[11px] text-pos-white/40">
            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0 text-amber-400" />
            Remova do carrinho os produtos DEVOLVIDOS (o estoque deles é restaurado). Os que ficarem serão cobrados e entram no faturamento.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
