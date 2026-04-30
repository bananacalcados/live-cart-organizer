import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Search, User, Phone, FileText, Copy, Gift, ShoppingBag, Loader2, CalendarClock, Store as StoreIcon, Sparkles, Star, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { buildPhoneVariations, normalizeBRPhone } from "@/lib/phoneUtils";

interface Props {
  storeId: string;
  initialQuery?: string;
}

interface NpsRow { id: string; score: number | null; feedback: string | null; sent_at: string; responded_at: string | null }
interface AiInsights {
  resumo?: string;
  tamanho_preferido?: string;
  categorias_favoritas?: string[];
  ticket_medio_perfil?: string;
  frequencia?: string;
  proxima_acao?: string;
  alertas?: string[];
}

interface CustomerRow {
  id: string;
  name: string | null;
  whatsapp: string | null;
  cpf: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  previous_whatsapp_numbers?: string[] | null;
}

interface CashbackRow {
  id: string;
  coupon_code: string;
  cashback_amount: number;
  min_purchase: number;
  expires_at: string;
  is_used: boolean;
  origin_type: string;
}

interface SaleRow {
  id: string;
  created_at: string;
  total: number;
  discount: number;
  status: string;
  payment_method: string | null;
  store_id: string;
  seller_id: string | null;
  invoice_number: string | null;
  pos_sale_items?: { product_name: string; size: string | null; quantity: number; unit_price: number }[];
}

const fmtMoney = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (d: string) => new Date(d).toLocaleDateString("pt-BR");
const fmtDateTime = (d: string) => new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function POSCustomer360({ storeId, initialQuery }: Props) {
  const [query, setQuery] = useState(initialQuery || "");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<CustomerRow[]>([]);
  const [selected, setSelected] = useState<CustomerRow | null>(null);

  const [cashbacks, setCashbacks] = useState<CashbackRow[]>([]);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [loyalty, setLoyalty] = useState<{ total_points: number; lifetime_points: number; expires_at: string } | null>(null);
  const [npsList, setNpsList] = useState<NpsRow[]>([]);
  const [stores, setStores] = useState<Record<string, string>>({});
  const [sellers, setSellers] = useState<Record<string, string>>({});
  const [loadingDetail, setLoadingDetail] = useState(false);

  // AI insights state
  const [aiInsights, setAiInsights] = useState<AiInsights | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // Load store map once
  useEffect(() => {
    supabase.from("pos_stores").select("id, name").then(({ data }) => {
      const m: Record<string, string> = {};
      (data || []).forEach((s: any) => { m[s.id] = s.name; });
      setStores(m);
    });
  }, []);

  // Auto-search when initialQuery is provided (deep-link from customer form)
  useEffect(() => {
    if (initialQuery && initialQuery.trim().length >= 3) {
      setQuery(initialQuery);
      setTimeout(() => { handleSearch(initialQuery); }, 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  const handleSearch = async (override?: string) => {
    const q = (override ?? query).trim();
    if (q.length < 3) {
      toast.error("Digite ao menos 3 caracteres");
      return;
    }
    setSearching(true);
    setSelected(null);
    try {
      const digits = q.replace(/\D/g, "");
      const isPhone = digits.length >= 8;
      const isCpf = digits.length === 11;

      let queryBuilder = supabase
        .from("pos_customers")
        .select("id, name, whatsapp, cpf, email, city, state, previous_whatsapp_numbers")
        .limit(25);

      if (isCpf) {
        queryBuilder = queryBuilder.ilike("cpf", `%${digits}%`);
      } else if (isPhone) {
        const variations = buildPhoneVariations(q);
        const last8 = digits.slice(-8);
        // search by whatsapp containing last 8 digits (covers 9th-digit variations)
        queryBuilder = queryBuilder.or(
          variations.map(v => `whatsapp.ilike.%${v}%`).join(",") + `,whatsapp.ilike.%${last8}%`
        );
      } else {
        queryBuilder = queryBuilder.or(`name.ilike.%${q}%,email.ilike.%${q}%`);
      }

      const { data, error } = await queryBuilder;
      if (error) throw error;
      setResults((data as CustomerRow[]) || []);
      if (!data || data.length === 0) toast.info("Nenhum cliente encontrado");
      else if (data.length === 1) handleSelect(data[0] as CustomerRow);
    } catch (e: any) {
      toast.error("Erro ao buscar: " + e.message);
    } finally {
      setSearching(false);
    }
  };

  const handleSelect = async (c: CustomerRow) => {
    setSelected(c);
    setLoadingDetail(true);
    setCashbacks([]);
    setSales([]);
    setLoyalty(null);
    setNpsList([]);
    setAiInsights(null);
    try {
      const phoneVariations = c.whatsapp ? buildPhoneVariations(c.whatsapp) : [];
      const last8 = c.whatsapp ? c.whatsapp.replace(/\D/g, "").slice(-8) : null;

      const cashbackPromise = last8
        ? supabase
            .from("internal_cashback")
            .select("id, coupon_code, cashback_amount, min_purchase, expires_at, is_used, origin_type")
            .ilike("customer_phone", `%${last8}%`)
            .order("expires_at", { ascending: true })
        : Promise.resolve({ data: [], error: null } as any);

      const salesPromise = supabase
        .from("pos_sales")
        .select("id, created_at, total, discount, status, payment_method, store_id, seller_id, invoice_number, pos_sale_items(product_name, size, quantity, unit_price)")
        .eq("customer_id", c.id)
        .order("created_at", { ascending: false })
        .limit(50);

      const loyaltyPromise = phoneVariations.length
        ? supabase
            .from("customer_loyalty_points")
            .select("total_points, lifetime_points, expires_at, store_id")
            .in("customer_phone", phoneVariations)
        : Promise.resolve({ data: [], error: null } as any);

      // NPS — by phone variations
      const npsPromise = phoneVariations.length
        ? supabase
            .from("chat_nps_surveys")
            .select("id, score, feedback, sent_at, responded_at")
            .in("phone", phoneVariations)
            .order("sent_at", { ascending: false })
            .limit(20)
        : Promise.resolve({ data: [], error: null } as any);

      const sellersPromise = supabase.from("pos_sellers").select("id, name");

      const [cb, sl, ly, np, sel] = await Promise.all([cashbackPromise, salesPromise, loyaltyPromise, npsPromise, sellersPromise]);

      setCashbacks((cb.data as CashbackRow[]) || []);
      setSales((sl.data as SaleRow[]) || []);
      setNpsList((np.data as NpsRow[]) || []);
      const lyData = (ly.data as any[]) || [];
      if (lyData.length) {
        const total = lyData.reduce((acc, r) => acc + (r.total_points || 0), 0);
        const lifetime = lyData.reduce((acc, r) => acc + (r.lifetime_points || 0), 0);
        const earliestExpires = lyData.reduce((min: string | null, r: any) => !min || r.expires_at < min ? r.expires_at : min, null as string | null);
        setLoyalty({ total_points: total, lifetime_points: lifetime, expires_at: earliestExpires || "" });
      }
      const sm: Record<string, string> = {};
      (sel.data || []).forEach((s: any) => { sm[s.id] = s.name; });
      setSellers(sm);
    } catch (e: any) {
      toast.error("Erro ao carregar perfil: " + e.message);
    } finally {
      setLoadingDetail(false);
    }
  };

  const generateInsights = async () => {
    if (!selected) return;
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("pos-customer-360-insights", {
        body: {
          customer: {
            name: selected.name,
            city: selected.city,
          },
          sales,
          cashbacks,
        },
      });
      if (error) throw error;
      if (data?.error === "rate_limited") { toast.error("Limite de IA atingido. Tente em alguns segundos."); return; }
      if (data?.error === "credits_exhausted") { toast.error("Créditos de IA esgotados. Adicione créditos na Lovable AI."); return; }
      setAiInsights(data?.insights || null);
    } catch (e: any) {
      toast.error("Erro IA: " + (e?.message || ""));
    } finally {
      setAiLoading(false);
    }
  };

  const copyCoupon = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success(`Cupom ${code} copiado!`);
  };

  const stats = useMemo(() => {
    const completedStatuses = ["completed", "paid", "delivered"];
    const valid = sales.filter(s => completedStatuses.includes(s.status) || !["cancelled", "canceled"].includes(s.status));
    const ltv = valid.reduce((acc, s) => acc + Number(s.total || 0), 0);
    const count = valid.length;
    const avg = count ? ltv / count : 0;
    const lastPurchase = valid[0]?.created_at;
    return { ltv, count, avg, lastPurchase };
  }, [sales]);

  const activeCashbacks = cashbacks.filter(c => !c.is_used && new Date(c.expires_at) > new Date());
  const expiredOrUsedCashbacks = cashbacks.filter(c => c.is_used || new Date(c.expires_at) <= new Date());

  // Computed insights from history (offline, no AI)
  const computedInsights = useMemo(() => {
    const sizeCount: Record<string, number> = {};
    const productCount: Record<string, number> = {};
    const paymentCount: Record<string, number> = {};
    sales.forEach(s => {
      if (s.payment_method) paymentCount[s.payment_method] = (paymentCount[s.payment_method] || 0) + 1;
      (s.pos_sale_items || []).forEach(it => {
        if (it.size) sizeCount[it.size] = (sizeCount[it.size] || 0) + (it.quantity || 1);
        const firstWord = (it.product_name || "").split(" ")[0];
        if (firstWord) productCount[firstWord] = (productCount[firstWord] || 0) + (it.quantity || 1);
      });
    });
    const topSizes = Object.entries(sizeCount).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const topProducts = Object.entries(productCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topPayment = Object.entries(paymentCount).sort((a, b) => b[1] - a[1])[0];
    return { topSizes, topProducts, topPayment };
  }, [sales]);

  const npsRespondida = npsList.filter(n => n.responded_at && n.score !== null);
  const npsAvg = npsRespondida.length
    ? npsRespondida.reduce((a, n) => a + (n.score || 0), 0) / npsRespondida.length
    : null;

  return (
    <div className="flex-1 flex flex-col bg-pos-black text-pos-white overflow-hidden">
      {/* Header / Search */}
      <div className="p-4 border-b border-pos-white/10 bg-[hsl(0,0%,8%)]">
        <div className="flex items-center gap-2 mb-2">
          <User className="h-5 w-5 text-pos-yellow" />
          <h2 className="text-lg font-bold">Cliente 360°</h2>
          <span className="text-xs text-pos-white/50">— histórico, cashback e fidelidade</span>
        </div>
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            placeholder="Buscar por Nome, CPF, WhatsApp ou Email…"
            className="bg-pos-white/5 border-pos-white/15 text-pos-white placeholder:text-pos-white/40"
          />
          <Button onClick={() => handleSearch()} disabled={searching} className="bg-pos-yellow text-pos-black hover:bg-pos-yellow/90">
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Results list (when multiple) */}
      {!selected && results.length > 0 && (
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-2">
            {results.map(c => (
              <Card
                key={c.id}
                onClick={() => handleSelect(c)}
                className="p-3 bg-pos-white/5 border-pos-white/10 hover:bg-pos-white/10 cursor-pointer transition"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold truncate text-pos-white">{c.name || "(sem nome)"}</p>
                    <p className="text-xs text-pos-white/60 flex items-center gap-1"><Phone className="h-3 w-3" />{c.whatsapp || "—"}</p>
                    {c.cpf && <p className="text-xs text-pos-white/60 flex items-center gap-1"><FileText className="h-3 w-3" />{c.cpf}</p>}
                  </div>
                  {(c.city || c.state) && (
                    <Badge variant="outline" className="text-[10px] border-pos-white/20 text-pos-white/70">
                      {[c.city, c.state].filter(Boolean).join("/")}
                    </Badge>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </ScrollArea>
      )}

      {!selected && results.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center text-pos-white/40 p-8 text-center">
          <Search className="h-12 w-12 mb-3 opacity-30" />
          <p className="text-sm">Pesquise um cliente para ver o histórico completo</p>
          <p className="text-xs mt-1">Cashback ativo, compras anteriores, fidelidade e mais</p>
        </div>
      )}

      {/* Detail */}
      {selected && (
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4 max-w-5xl mx-auto">
            {/* Header card */}
            <Card className="p-4 bg-gradient-to-br from-pos-yellow/10 to-pos-white/5 border-pos-yellow/30">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <h3 className="text-xl font-bold text-pos-white">{selected.name || "(sem nome)"}</h3>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-pos-white/70">
                    {selected.whatsapp && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{selected.whatsapp}</span>}
                    {selected.cpf && <span className="flex items-center gap-1"><FileText className="h-3 w-3" />{selected.cpf}</span>}
                    {selected.email && <span>{selected.email}</span>}
                  </div>
                  {(selected.city || selected.state) && (
                    <p className="text-xs text-pos-white/50 mt-1">{[selected.city, selected.state].filter(Boolean).join(" / ")}</p>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSelected(null)} className="text-pos-white/60 hover:text-pos-white">
                  ← Voltar
                </Button>
              </div>

              {/* KPIs */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
                <div className="bg-pos-black/40 rounded-lg p-2">
                  <p className="text-[10px] text-pos-white/50 uppercase">LTV</p>
                  <p className="text-sm font-bold text-pos-yellow">{fmtMoney(stats.ltv)}</p>
                </div>
                <div className="bg-pos-black/40 rounded-lg p-2">
                  <p className="text-[10px] text-pos-white/50 uppercase">Compras</p>
                  <p className="text-sm font-bold text-pos-white">{stats.count}</p>
                </div>
                <div className="bg-pos-black/40 rounded-lg p-2">
                  <p className="text-[10px] text-pos-white/50 uppercase">Ticket Médio</p>
                  <p className="text-sm font-bold text-pos-white">{fmtMoney(stats.avg)}</p>
                </div>
                <div className="bg-pos-black/40 rounded-lg p-2">
                  <p className="text-[10px] text-pos-white/50 uppercase">Última Compra</p>
                  <p className="text-sm font-bold text-pos-white">{stats.lastPurchase ? fmtDate(stats.lastPurchase) : "—"}</p>
                </div>
              </div>
            </Card>

            {loadingDetail ? (
              <div className="flex items-center justify-center py-12 text-pos-white/50"><Loader2 className="h-6 w-6 animate-spin mr-2" />Carregando perfil…</div>
            ) : (
              <Tabs defaultValue="cashback" className="w-full">
                <TabsList className="bg-pos-white/5 border border-pos-white/10">
                  <TabsTrigger value="cashback" className="data-[state=active]:bg-pos-yellow data-[state=active]:text-pos-black">
                    <Gift className="h-3 w-3 mr-1" /> Cashback ({activeCashbacks.length})
                  </TabsTrigger>
                  <TabsTrigger value="history" className="data-[state=active]:bg-pos-yellow data-[state=active]:text-pos-black">
                    <ShoppingBag className="h-3 w-3 mr-1" /> Compras ({sales.length})
                  </TabsTrigger>
                  <TabsTrigger value="loyalty" className="data-[state=active]:bg-pos-yellow data-[state=active]:text-pos-black">
                    Fidelidade
                  </TabsTrigger>
                </TabsList>

                {/* CASHBACK */}
                <TabsContent value="cashback" className="space-y-2">
                  {activeCashbacks.length === 0 && (
                    <Card className="p-6 text-center bg-pos-white/5 border-pos-white/10 text-pos-white/50">
                      Nenhum cashback ativo no momento.
                    </Card>
                  )}
                  {activeCashbacks.map(c => (
                    <Card key={c.id} className="p-3 bg-gradient-to-r from-emerald-500/10 to-pos-white/5 border-emerald-500/30">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <code className="text-base font-mono font-bold text-emerald-400">{c.coupon_code}</code>
                            <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-300">
                              {c.origin_type}
                            </Badge>
                          </div>
                          <p className="text-sm text-pos-white mt-1">
                            <span className="font-bold text-emerald-400">{fmtMoney(c.cashback_amount)}</span>
                            {" "}de desconto · mín. {fmtMoney(c.min_purchase)}
                          </p>
                          <p className="text-xs text-pos-white/50 flex items-center gap-1 mt-1">
                            <CalendarClock className="h-3 w-3" /> Expira em {fmtDate(c.expires_at)}
                          </p>
                        </div>
                        <Button size="sm" onClick={() => copyCoupon(c.coupon_code)} className="bg-emerald-500 hover:bg-emerald-600 text-white">
                          <Copy className="h-3 w-3 mr-1" /> Copiar
                        </Button>
                      </div>
                    </Card>
                  ))}
                  {expiredOrUsedCashbacks.length > 0 && (
                    <details className="mt-3">
                      <summary className="text-xs text-pos-white/50 cursor-pointer hover:text-pos-white/70">
                        Ver {expiredOrUsedCashbacks.length} cupons usados/expirados
                      </summary>
                      <div className="space-y-1 mt-2">
                        {expiredOrUsedCashbacks.map(c => (
                          <div key={c.id} className="text-xs p-2 bg-pos-white/5 rounded flex justify-between text-pos-white/40">
                            <code>{c.coupon_code}</code>
                            <span>{c.is_used ? "Usado" : "Expirado"} · {fmtDate(c.expires_at)}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </TabsContent>

                {/* HISTORY */}
                <TabsContent value="history" className="space-y-2">
                  {sales.length === 0 && (
                    <Card className="p-6 text-center bg-pos-white/5 border-pos-white/10 text-pos-white/50">
                      Nenhuma compra registrada.
                    </Card>
                  )}
                  {sales.map(s => (
                    <Card key={s.id} className="p-3 bg-pos-white/5 border-pos-white/10">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-pos-white">{fmtDateTime(s.created_at)}</span>
                            <Badge className="text-[10px] bg-pos-yellow/20 text-pos-yellow border-0">
                              <StoreIcon className="h-3 w-3 mr-1" />{stores[s.store_id] || "Loja"}
                            </Badge>
                            {s.seller_id && sellers[s.seller_id] && (
                              <span className="text-[10px] text-pos-white/50">por {sellers[s.seller_id]}</span>
                            )}
                            <Badge variant="outline" className="text-[10px] border-pos-white/20 text-pos-white/70">{s.status}</Badge>
                          </div>
                          {s.pos_sale_items && s.pos_sale_items.length > 0 && (
                            <ul className="mt-2 space-y-0.5 text-xs text-pos-white/70">
                              {s.pos_sale_items.slice(0, 5).map((it, i) => (
                                <li key={i} className="truncate">
                                  • {it.quantity}× {it.product_name}{it.size ? ` (${it.size})` : ""} — {fmtMoney(it.unit_price)}
                                </li>
                              ))}
                              {s.pos_sale_items.length > 5 && (
                                <li className="text-pos-white/40">+ {s.pos_sale_items.length - 5} item(s)…</li>
                              )}
                            </ul>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-base font-bold text-pos-yellow">{fmtMoney(Number(s.total))}</p>
                          {Number(s.discount) > 0 && <p className="text-[10px] text-pos-white/50">desc. {fmtMoney(Number(s.discount))}</p>}
                          {s.payment_method && <p className="text-[10px] text-pos-white/50 mt-1">{s.payment_method}</p>}
                          {s.invoice_number && <p className="text-[10px] text-pos-white/40">NF {s.invoice_number}</p>}
                        </div>
                      </div>
                    </Card>
                  ))}
                </TabsContent>

                {/* LOYALTY */}
                <TabsContent value="loyalty">
                  {!loyalty ? (
                    <Card className="p-6 text-center bg-pos-white/5 border-pos-white/10 text-pos-white/50">
                      Cliente ainda não acumulou pontos.
                    </Card>
                  ) : (
                    <Card className="p-4 bg-gradient-to-br from-pos-yellow/10 to-pos-white/5 border-pos-yellow/30">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-[10px] uppercase text-pos-white/50">Pontos Disponíveis</p>
                          <p className="text-2xl font-bold text-pos-yellow">{loyalty.total_points}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase text-pos-white/50">Pontos Acumulados (vida)</p>
                          <p className="text-2xl font-bold text-pos-white">{loyalty.lifetime_points}</p>
                        </div>
                      </div>
                      {loyalty.expires_at && (
                        <p className="text-xs text-pos-white/50 mt-3 flex items-center gap-1">
                          <CalendarClock className="h-3 w-3" /> Próxima expiração: {fmtDate(loyalty.expires_at)}
                        </p>
                      )}
                    </Card>
                  )}
                </TabsContent>
              </Tabs>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
