import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Pagination, PaginationContent, PaginationItem, PaginationPrevious, PaginationNext,
} from "@/components/ui/pagination";
import { Loader2, Search, RotateCcw, User, Package, ChevronRight, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Loja "Tiny Shopify" — onde os pedidos do site são espelhados como pos_sales.
const TINY_SHOPIFY_STORE_ID = "2bd2c08d-321c-47ee-98a9-e27e936818ab";
const PAGE_SIZE = 12;

export const EXCHANGE_REASONS = [
  "Falta de tamanho",
  "Falta de cor",
  "Produto esgotado",
  "Produto com defeito",
  "Cliente preferiu outro modelo",
  "Outro",
];

export interface SiteExchangeCartItem {
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

export interface SiteExchangeCustomer {
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

export interface SiteExchangeResult {
  reason: string;
  originalSaleId: string | null;
  shopifyOrderId: string;
  shopifyOrderName: string | null;
  customer: SiteExchangeCustomer;
  items: SiteExchangeCartItem[];
  originalItems: Array<{ sku: string; barcode: string; name: string; variant: string; quantity: number; unit_price: number }>;
}

interface SiteSale {
  id: string;
  external_order_id: string | null;
  notes: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_cpf: string | null;
  total: number | null;
  created_at: string;
}

interface Props {
  open: boolean;
  onCancel: () => void;
  onConfirm: (result: SiteExchangeResult) => void;
}

function orderNameFromNotes(notes: string | null): string | null {
  const m = (notes || "").match(/#\s*(\d+)/);
  return m ? `#${m[1]}` : null;
}

export function SiteExchangePicker({ open, onCancel, onConfirm }: Props) {
  const [phase, setPhase] = useState<"reason" | "list">("reason");
  const [reason, setReason] = useState<string>("");
  const [reasonOther, setReasonOther] = useState("");

  const [sales, setSales] = useState<SiteSale[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loadingOrder, setLoadingOrder] = useState<string | null>(null);
  const [exchangedIds, setExchangedIds] = useState<Set<string>>(new Set());

  // reset ao abrir
  useEffect(() => {
    if (open) {
      setPhase("reason");
      setReason("");
      setReasonOther("");
      setSales([]);
      setPage(0);
      setSearch("");
      setDebouncedSearch("");
    }
  }, [open]);

  // debounce da busca
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search.trim()); setPage(0); }, 450);
    return () => clearTimeout(t);
  }, [search]);

  const loadSales = useCallback(async () => {
    setLoading(true);
    try {
      let q = supabase
        .from("pos_sales")
        .select("id, external_order_id, notes, customer_name, customer_phone, customer_cpf, total, created_at")
        .eq("store_id", TINY_SHOPIFY_STORE_ID)
        .eq("external_source", "shopify")
        .neq("status", "cancelled")
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE); // +1 p/ saber se há próxima

      if (debouncedSearch) {
        const term = debouncedSearch;
        const digits = term.replace(/\D/g, "");
        const ors = [
          `customer_name.ilike.%${term}%`,
          `notes.ilike.%${term}%`,
        ];
        if (digits) {
          ors.push(`customer_phone.ilike.%${digits}%`);
          ors.push(`customer_cpf.ilike.%${digits}%`);
          ors.push(`external_order_id.ilike.%${digits}%`);
        }
        q = q.or(ors.join(","));
      }

      const { data, error } = await q;
      if (error) throw error;
      const rows = (data || []) as SiteSale[];
      setHasMore(rows.length > PAGE_SIZE);
      setSales(rows.slice(0, PAGE_SIZE));

      // marca pedidos já convertidos em troca
      const orderIds = rows.map((r) => r.external_order_id).filter(Boolean) as string[];
      if (orderIds.length > 0) {
        const { data: ex } = await supabase
          .from("pos_site_exchanges")
          .select("shopify_order_id")
          .in("shopify_order_id", orderIds);
        setExchangedIds(new Set((ex || []).map((e: any) => String(e.shopify_order_id))));
      } else {
        setExchangedIds(new Set());
      }
    } catch (e: any) {
      console.error("[SiteExchangePicker] loadSales", e);
      toast.error("Erro ao carregar pedidos do site");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch]);

  useEffect(() => {
    if (open && phase === "list") loadSales();
  }, [open, phase, loadSales]);

  const confirmReason = () => {
    const finalReason = reason === "Outro" ? (reasonOther.trim() || "Outro") : reason;
    if (!finalReason) { toast.error("Selecione o motivo da troca"); return; }
    setReason(finalReason);
    setPhase("list");
  };

  const selectOrder = async (sale: SiteSale) => {
    if (!sale.external_order_id) {
      toast.error("Pedido sem vínculo com a Shopify.");
      return;
    }
    if (exchangedIds.has(String(sale.external_order_id))) {
      toast.error("Este pedido já foi convertido em troca.");
      return;
    }
    setLoadingOrder(sale.id);
    try {
      // 1) itens do pedido
      const { data: items, error: itemsErr } = await supabase
        .from("pos_sale_items")
        .select("sku, product_name, variant_name, size, category, unit_price, quantity, barcode, tiny_product_id")
        .eq("sale_id", sale.id);
      if (itemsErr) throw itemsErr;

      // Rateia desconto para achar preço efetivamente pago
      const { data: saleTotals } = await supabase
        .from("pos_sales")
        .select("discount, total")
        .eq("id", sale.id)
        .maybeSingle();
      const { computeEffectiveUnitPrices } = await import("@/lib/pos/effectivePrice");
      const eff = computeEffectiveUnitPrices(
        (items || []).map((i: any) => ({
          unit_price: Number(i.unit_price || 0),
          quantity: Number(i.quantity || 1),
        })),
        Number((saleTotals as any)?.discount || 0),
        Number((saleTotals as any)?.total || 0) || null,
      );

      // 2) resolve barcode/tiny_id/estoque a partir do SKU (catálogo do PDV)
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

      const cartItems: SiteExchangeCartItem[] = (items || []).map((i: any, idx: number) => {
        const resolved = bySku.get(String(i.sku || "")) || { barcode: "", tiny_id: undefined, stock: undefined };
        return {
          id: `site-${sale.id}-${idx}`,
          tiny_id: i.tiny_product_id ?? resolved.tiny_id,
          sku: i.sku || "",
          name: i.product_name || "Produto",
          variant: i.variant_name || "",
          size: i.size || undefined,
          category: i.category || undefined,
          price: eff.effective[idx] ?? Number(i.unit_price || 0),
          quantity: Number(i.quantity || 1),
          barcode: (i.barcode || resolved.barcode || "") as string,
          stock: resolved.stock,
        };
      });

      const originalItems = cartItems.map((c) => ({
        sku: c.sku, barcode: c.barcode, name: c.name, variant: c.variant,
        quantity: c.quantity, unit_price: c.price,
      }));

      // 3) cliente (colunas + snapshot de endereço)
      const { data: full } = await supabase
        .from("pos_sales")
        .select("customer_id, customer_name, customer_phone, customer_cpf, customer_email, customer_cep, customer_city, customer_state, shipping_address")
        .eq("id", sale.id)
        .maybeSingle();
      const addr: any = (full as any)?.shipping_address || {};
      const customer: SiteExchangeCustomer = {
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

      const proceed = () => onConfirm({
        reason,
        originalSaleId: sale.id,
        shopifyOrderId: String(sale.external_order_id),
        shopifyOrderName: orderNameFromNotes(sale.notes),
        customer,
        items: cartItems,
        originalItems,
      });

      // Aviso silencioso (não bloqueante): venda já tem NF emitida?
      const { data: fdoc } = await supabase
        .from("fiscal_documents")
        .select("chave_acesso")
        .eq("pos_sale_id", sale.id)
        .not("chave_acesso", "is", null)
        .neq("chave_acesso", "")
        .limit(1)
        .maybeSingle();

      if (fdoc?.chave_acesso) {
        toast("Essa venda já tem nota fiscal emitida. Confirma que é uma troca pré-faturamento?", {
          duration: Infinity,
          action: { label: "Confirmar", onClick: () => proceed() },
          cancel: { label: "Cancelar", onClick: () => {} },
        });
        return;
      }

      proceed();
    } catch (e: any) {
      console.error("[SiteExchangePicker] selectOrder", e);
      toast.error("Erro ao puxar o pedido do site");
    } finally {
      setLoadingOrder(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="bg-pos-black border-pos-orange/40 max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-pos-white text-xl flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-pos-orange" /> Trocas do Site
          </DialogTitle>
        </DialogHeader>

        {phase === "reason" && (
          <div className="space-y-4 pt-2">
            <p className="text-sm text-pos-white/60">Qual o motivo da troca deste pedido do site?</p>
            <div className="grid grid-cols-2 gap-2">
              {EXCHANGE_REASONS.map((r) => (
                <button
                  key={r}
                  onClick={() => setReason(r)}
                  className={cn(
                    "rounded-xl border-2 p-3 text-sm font-medium text-left transition-all",
                    reason === r
                      ? "border-pos-orange bg-pos-orange/15 text-pos-white"
                      : "border-pos-orange/20 bg-pos-white/5 text-pos-white/70 hover:border-pos-orange/50",
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
            {reason === "Outro" && (
              <Input
                value={reasonOther}
                onChange={(e) => setReasonOther(e.target.value)}
                placeholder="Descreva o motivo"
                className="bg-pos-white/5 border-pos-orange/30 text-pos-white"
              />
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" className="text-pos-white/70" onClick={onCancel}>Cancelar</Button>
              <Button
                className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold"
                disabled={!reason}
                onClick={confirmReason}
              >
                Continuar <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {phase === "list" && (
          <div className="space-y-3 pt-1">
            <div className="flex items-center gap-2">
              <Badge className="bg-pos-orange/20 text-pos-orange border-pos-orange/40 shrink-0">{reason}</Badge>
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-pos-white/40" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por nome, telefone, CPF ou nº do pedido"
                  className="pl-8 bg-pos-white/5 border-pos-orange/30 text-pos-white"
                />
              </div>
            </div>

            <ScrollArea className="h-[46vh] pr-2">
              {loading ? (
                <div className="flex items-center justify-center py-10 text-pos-white/50">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando pedidos do site...
                </div>
              ) : sales.length === 0 ? (
                <div className="text-center py-10 text-pos-white/50 text-sm">Nenhum pedido do site encontrado.</div>
              ) : (
                <div className="space-y-2">
                  {sales.map((s) => {
                    const already = s.external_order_id && exchangedIds.has(String(s.external_order_id));
                    return (
                      <button
                        key={s.id}
                        disabled={!!already || loadingOrder === s.id}
                        onClick={() => selectOrder(s)}
                        className={cn(
                          "w-full text-left rounded-xl border p-3 transition-all flex items-center justify-between gap-3",
                          already
                            ? "border-pos-white/10 bg-pos-white/5 opacity-50 cursor-not-allowed"
                            : "border-pos-orange/20 bg-pos-white/5 hover:border-pos-orange hover:bg-pos-orange/10",
                        )}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-pos-white text-sm">
                              {orderNameFromNotes(s.notes) || `#${s.external_order_id || "?"}`}
                            </span>
                            {already && <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40 text-[10px]">Já trocado</Badge>}
                          </div>
                          <div className="flex items-center gap-1 text-xs text-pos-white/60 mt-0.5 truncate">
                            <User className="h-3 w-3 shrink-0" /> {s.customer_name || "Sem nome"}
                            {s.customer_phone ? ` · ${s.customer_phone}` : ""}
                          </div>
                          <div className="text-[11px] text-pos-white/40 mt-0.5">
                            {new Date(s.created_at).toLocaleString("pt-BR")} · R$ {Number(s.total || 0).toFixed(2)}
                          </div>
                        </div>
                        {loadingOrder === s.id
                          ? <Loader2 className="h-4 w-4 animate-spin text-pos-orange shrink-0" />
                          : <Package className="h-4 w-4 text-pos-white/40 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </ScrollArea>

            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" className="text-pos-white/60" onClick={() => setPhase("reason")}>
                ← Motivo
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
              Ao finalizar, o pedido é cancelado na Shopify/Expedição/PDV do Site e o estoque do item removido é zerado em todas as lojas.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
