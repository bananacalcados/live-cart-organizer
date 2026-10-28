import { useEffect, useRef, useState } from "react";
import { Loader2, Plus, Search, ArrowLeft, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { searchPosAndUnifiedCustomers, type PosCustomerSearchRow } from "@/lib/posCustomerResolve";
import { refundApi, type RefundEligibility, type RefundSource } from "@/lib/refunds";
import { RefundDialog } from "./RefundDialog";
import { ManualRefundDialog } from "./ManualRefundDialog";
import { RefundWindowNotice } from "./RefundWindowNotice";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString("pt-BR") : "—");
const maskPhone = (p?: string | null) => {
  const d = (p || "").replace(/\D/g, "");
  return d.length >= 4 ? `(**) *****-${d.slice(-4)}` : "—";
};
const maskCpf = (c?: string | null) => {
  const d = (c || "").replace(/\D/g, "");
  return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : null;
};

interface Purchase {
  key: string;
  source: RefundSource | "site";
  id: string;
  date: string;
  channel: "Live" | "PDV" | "Site";
  code: string;
  items: string;
  total: number;
  payLabel: string;
  systemStatus: string;
}

const DAYS = 180;

async function loadPurchases(c: PosCustomerSearchRow): Promise<Purchase[]> {
  const digits = (c.whatsapp || "").replace(/\D/g, "");
  const s8 = digits.length >= 8 ? digits.slice(-8) : "";
  const cpf = (c.cpf || "").replace(/\D/g, "");
  const since = new Date(Date.now() - DAYS * 864e5).toISOString();
  const saleFilters = [s8 && `phone_suffix8.eq.${s8}`, cpf.length === 11 && `customer_cpf.eq.${cpf}`].filter(Boolean).join(",");
  if (!saleFilters) return [];

  const [salesR, custR, siteR] = await Promise.all([
    supabase.from("pos_sales").select("id,created_at,total,status,paid_at,payment_method,payment_gateway")
      .or(saleFilters).gte("created_at", since).order("created_at", { ascending: false }).limit(50),
    s8 ? supabase.from("customers").select("id").ilike("whatsapp", `%${s8}%`).limit(10) : Promise.resolve({ data: [] as any[] }),
    s8 ? supabase.from("expedition_orders").select("id,shopify_order_name,total_price,shopify_created_at,financial_status")
      .ilike("customer_phone", `%${s8}%`).gte("shopify_created_at", since).order("shopify_created_at", { ascending: false }).limit(20)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const sales = (salesR.data || []) as any[];
  const custIds = ((custR.data || []) as any[]).map((x) => x.id);
  const saleIds = sales.map((s) => s.id);
  const [ordersR, itemsR] = await Promise.all([
    custIds.length ? supabase.from("orders").select("id,created_at,products,discount_type,discount_value,free_shipping,shipping_cost,stage,is_paid,paid_externally,pos_sale_id,payment_method_label")
      .in("customer_id", custIds).gte("created_at", since).order("created_at", { ascending: false }).limit(50)
      : Promise.resolve({ data: [] as any[] }),
    saleIds.length ? supabase.from("pos_sale_items").select("sale_id,product_name,quantity").in("sale_id", saleIds).limit(300)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const itemsBySale = new Map<string, string[]>();
  for (const it of (itemsR.data || []) as any[]) {
    const arr = itemsBySale.get(it.sale_id) || [];
    arr.push(`${Number(it.quantity) > 1 ? `${it.quantity}x ` : ""}${it.product_name}`);
    itemsBySale.set(it.sale_id, arr);
  }
  const saleSet = new Set(saleIds);
  const out: Purchase[] = sales.map((s) => ({
    key: `s-${s.id}`, source: "pos_sale", id: s.id, date: s.created_at, channel: "PDV",
    code: `#${s.id.slice(0, 8).toUpperCase()}`, items: (itemsBySale.get(s.id) || []).join(", ") || "—",
    total: Number(s.total || 0),
    payLabel: [s.payment_method, s.payment_gateway].filter(Boolean).join(" · ") || "—",
    systemStatus: s.paid_at || ["paid", "completed", "shipped", "delivered"].includes(String(s.status)) ? "Pago" : String(s.status || "—"),
  }));
  // Pedido convertido em venda = mesma compra: mostra só a venda.
  for (const o of (ordersR.data || []) as any[]) {
    if (o.pos_sale_id && saleSet.has(o.pos_sale_id)) continue;
    const prods = Array.isArray(o.products) ? o.products : [];
    const pt = prods.reduce((a: number, p: any) => a + (Number(p?.price) || 0) * (Number(p?.quantity) || 0), 0);
    const disc = o.discount_type && o.discount_value ? (o.discount_type === "percentage" ? pt * (Number(o.discount_value) / 100) : Number(o.discount_value)) : 0;
    out.push({
      key: `o-${o.id}`, source: "order", id: o.id, date: o.created_at, channel: "Live",
      code: `#${o.id.slice(0, 8).toUpperCase()}`,
      items: prods.map((p: any) => `${Number(p?.quantity) > 1 ? `${p.quantity}x ` : ""}${p?.title || p?.name || "Produto"}`).join(", ") || "—",
      total: Math.max(0, pt - disc + (o.free_shipping ? 0 : Number(o.shipping_cost || 0))),
      payLabel: o.payment_method_label || "—",
      systemStatus: o.is_paid ? "Pago" : o.paid_externally ? "Pago fora do sistema" : String(o.stage || "—"),
    });
  }
  for (const e of (siteR.data || []) as any[]) {
    out.push({
      key: `e-${e.id}`, source: "site", id: e.id, date: e.shopify_created_at, channel: "Site",
      code: e.shopify_order_name || "—", items: "—", total: Number(e.total_price || 0),
      payLabel: "Shopify", systemStatus: e.financial_status || "—",
    });
  }
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function eligText(e: RefundEligibility) {
  const forma = e.method === "pix" ? "Pix" : e.method === "debito" ? `Débito •••• ${e.cardLast4 || "?"}` : `Cartão •••• ${e.cardLast4 || "?"}${e.installments ? ` ${e.installments}x` : ""}`;
  return `${forma} · restante ${brl(e.remaining || 0)} · aprovado em ${fmtDate(e.dateApproved)}`;
}

/** Fase C: "Novo estorno" — busca a cliente, lista compras (180 dias) e checa elegibilidade em lote. */
export function RefundRequestDialog({ onDone }: { onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<PosCustomerSearchRow[]>([]);
  const [customer, setCustomer] = useState<PosCustomerSearchRow | null>(null);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [elig, setElig] = useState<Map<string, RefundEligibility>>(new Map());
  const [loadingP, setLoadingP] = useState(false);
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    if (!open || customer) return;
    const term = q.trim();
    if (term.length < 3) { setResults([]); return; }
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await searchPosAndUnifiedCustomers(term);
        if (id === reqId.current) setResults(r);
      } catch (e: any) { if (id === reqId.current) setErr(e?.message || "Erro na busca"); }
      finally { if (id === reqId.current) setSearching(false); }
    }, 450);
    return () => clearTimeout(t);
  }, [q, open, customer]);

  const checkEligibility = async (list: Purchase[]) => {
    const items = list.filter((p) => p.source !== "site").map((p) => ({ source: p.source as RefundSource, id: p.id }));
    if (!items.length) return;
    setChecking(true);
    try {
      const r = await refundApi.eligibility(items);
      setElig((prev) => {
        const m = new Map(prev);
        for (const e of r.results) m.set(`${e.source === "order" ? "o" : "s"}-${e.id}`, e);
        return m;
      });
    } catch (e: any) { setErr(e?.message || "Não foi possível consultar o gateway agora"); }
    finally { setChecking(false); }
  };

  const selectCustomer = async (c: PosCustomerSearchRow) => {
    setCustomer(c); setErr(null); setElig(new Map()); setLoadingP(true);
    try {
      const list = await loadPurchases(c);
      setPurchases(list);
      setLoadingP(false);
      await checkEligibility(list);
    } catch (e: any) { setErr(e?.message || "Erro ao carregar compras"); setLoadingP(false); }
  };

  const reset = () => { setCustomer(null); setPurchases([]); setElig(new Map()); setErr(null); };
  const retryItems = purchases.filter((p) => elig.get(p.key)?.retry);

  return (
    <>
      <button onClick={() => { reset(); setQ(""); setResults([]); setOpen(true); }}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-black uppercase text-primary-foreground hover:bg-primary/90">
        <Plus className="h-4 w-4" /> Novo estorno
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Novo estorno</DialogTitle></DialogHeader>
          {err && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{err}</p>}

          {!customer ? (
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, telefone ou CPF" className="pl-9" />
              </div>
              {searching && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
              {!searching && q.trim().length >= 3 && results.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma cliente encontrada.</p>}
              <div className="space-y-2">
                {results.map((c) => (
                  <button key={c.id} onClick={() => void selectCustomer(c)} className="w-full rounded-md border border-border p-3 text-left hover:bg-muted">
                    <p className="font-bold">{c.name || "(sem nome)"}</p>
                    <p className="text-xs text-muted-foreground">
                      {maskPhone(c.whatsapp)}{maskCpf(c.cpf) ? ` · CPF ${maskCpf(c.cpf)}` : ""}{c.city ? ` · ${[c.city, c.state].filter(Boolean).join("/")}` : ""}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <button onClick={reset} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Trocar cliente</button>
                <p className="text-sm"><b>{customer.name}</b> · {maskPhone(customer.whatsapp)}</p>
              </div>
              <p className="text-xs text-muted-foreground">Compras dos últimos {DAYS} dias (limite do Mercado Pago).</p>
              {retryItems.length > 0 && (
                <button disabled={checking} onClick={() => void checkEligibility(retryItems)} className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1 text-xs font-bold hover:bg-muted">
                  <RefreshCw className={`h-3 w-3 ${checking ? "animate-spin" : ""}`} /> Consultar de novo ({retryItems.length})
                </button>
              )}
              {loadingP ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : purchases.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma compra nos últimos {DAYS} dias.</p>
              ) : (
                <div className="space-y-2">
                  {purchases.map((p) => {
                    const e = elig.get(p.key);
                    return (
                      <div key={p.key} className="rounded-md border border-border p-3 text-sm">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-bold">{fmtDate(p.date)} · {p.channel} {p.code} · {brl(p.total)}</p>
                            <p className="truncate text-xs text-muted-foreground">{p.items}</p>
                            <p className="text-xs text-muted-foreground">Pagamento: {p.payLabel}{e?.gateway ? ` · transação: ${e.gateway}` : ""} · Sistema: {p.systemStatus}</p>
                          </div>
                          {p.source !== "site" && e?.eligible && (
                            <RefundDialog source={p.source as RefundSource} sourceId={p.id} label={`${p.channel} ${p.code}`} customerName={customer.name}
                              onDone={() => { onDone?.(); void checkEligibility([p]); }} />
                          )}
                          {p.source!=="site" && e?.gateway && !e.eligible && e.gateway_window_open===false && <ManualRefundDialog source={p.source} sourceId={p.id} gateway={e.gateway} maxAmount={e.remaining??p.total} onDone={()=>{onDone?.();void checkEligibility([p]);}}/>}
                        </div>
                        <RefundWindowNotice closesAt={e?.gateway_window_closes_at} open={e?.gateway_window_open} note={e?.gateway_window_note}/>
                        <p className={`mt-1 text-xs font-bold ${e?.eligible ? "text-primary" : "text-muted-foreground"}`}>
                          {p.source === "site" ? "Pedido do site — apenas informativo"
                            : !e ? (checking ? "Verificando…" : "—")
                            : e.eligible ? `Pode estornar: ${eligText(e)}` : `Não pode: ${e.reason}`}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
