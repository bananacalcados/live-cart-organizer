import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronDown, ChevronRight, AlertTriangle, Loader2, Radio, User, Phone, Package, CreditCard, Calendar } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export interface ChannelSale {
  id: string;
  total: number | null;
  seller_id: string | null;
  status: string | null;
  sale_type: string | null;
  subtotal: number | null;
  discount: number | null;
  payment_details: any;
  paid_at: string | null;
  created_at: string;
  event_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  payment_method: string | null;
  customer_cpf: string | null;
}

interface SaleItem {
  sale_id: string;
  product_name: string | null;
  variant_name: string | null;
  size: string | null;
  sku: string | null;
  quantity: number | null;
  unit_price: number | null;
  total_price: number | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  channel: "physical" | "online" | "live";
  sales: ChannelSale[];
}

const BRL = (v: number) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Últimos 8 dígitos do telefone (padrão do projeto para casar contatos). */
function phoneKey(phone: string | null): string {
  const digits = (phone || "").replace(/\D/g, "");
  return digits.slice(-8);
}

function dupIdentityKey(s: ChannelSale): string {
  const pk = phoneKey(s.customer_phone);
  const ident = pk || (s.customer_name || "").trim().toLowerCase();
  const totalCents = Math.round(Number(s.total || 0) * 100);
  return `${ident}|${totalCents}`;
}

export function POSChannelSalesModal({ open, onClose, title, channel, sales }: Props) {
  const [loading, setLoading] = useState(false);
  const [itemsBySale, setItemsBySale] = useState<Map<string, SaleItem[]>>(new Map());
  const [sellerNames, setSellerNames] = useState<Map<string, string>>(new Map());
  const [eventNames, setEventNames] = useState<Map<string, string>>(new Map());
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!open || sales.length === 0) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const saleIds = sales.map((s) => s.id);
        const items: SaleItem[] = [];
        for (let i = 0; i < saleIds.length; i += 300) {
          const slice = saleIds.slice(i, i + 300);
          const { data } = await supabase
            .from("pos_sale_items")
            .select("sale_id, product_name, variant_name, size, sku, quantity, unit_price, total_price")
            .in("sale_id", slice)
            .limit(20000);
          if (data) items.push(...(data as any));
        }
        const map = new Map<string, SaleItem[]>();
        for (const it of items) {
          const list = map.get(it.sale_id) || [];
          list.push(it);
          map.set(it.sale_id, list);
        }

        const sellerIds = [...new Set(sales.map((s) => s.seller_id).filter(Boolean))] as string[];
        const sMap = new Map<string, string>();
        if (sellerIds.length > 0) {
          const { data: sellers } = await supabase.from("pos_sellers").select("id, name").in("id", sellerIds);
          for (const s of sellers || []) sMap.set(s.id, s.name);
        }

        const eventIds = [...new Set(sales.map((s) => s.event_id).filter(Boolean))] as string[];
        const eMap = new Map<string, string>();
        if (eventIds.length > 0) {
          const { data: events } = await supabase.from("events").select("id, name").in("id", eventIds);
          for (const e of events || []) eMap.set(e.id, e.name);
        }

        if (!cancelled) {
          setItemsBySale(map);
          setSellerNames(sMap);
          setEventNames(eMap);
        }
      } catch (e) {
        console.error("Channel modal load error:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, sales]);

  // Grupos de possíveis duplicatas: mesma pessoa + mesmo valor.
  const dupGroups = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const s of sales) {
      const key = dupIdentityKey(s);
      // ignora chaves sem identidade real
      const [ident] = key.split("|");
      if (!ident) continue;
      const list = groups.get(key) || [];
      list.push(s.id);
      groups.set(key, list);
    }
    return groups;
  }, [sales]);

  // sku assinatura por venda (para reforçar a detecção com produtos)
  const productSignature = (saleId: string): string => {
    const items = itemsBySale.get(saleId) || [];
    return items
      .map((i) => `${i.sku || i.product_name || "?"}:${i.quantity || 0}`)
      .sort()
      .join("|");
  };

  const dupInfoFor = (s: ChannelSale): { isDup: boolean; strong: boolean; count: number } => {
    const key = dupIdentityKey(s);
    const [ident] = key.split("|");
    if (!ident) return { isDup: false, strong: false, count: 0 };
    const group = dupGroups.get(key) || [];
    if (group.length < 2) return { isDup: false, strong: false, count: 0 };
    // strong = também compartilha assinatura de produtos com outra venda do grupo
    const sig = productSignature(s.id);
    const sameProducts = group.filter((id) => id !== s.id && productSignature(id) === sig).length > 0;
    return { isDup: true, strong: sameProducts && sig.length > 0, count: group.length };
  };

  const dupCount = useMemo(() => {
    let c = 0;
    for (const [, ids] of dupGroups) if (ids.length >= 2) c += ids.length;
    return c;
  }, [dupGroups]);

  const sorted = useMemo(
    () => [...sales].sort((a, b) => new Date(b.paid_at || b.created_at).getTime() - new Date(a.paid_at || a.created_at).getTime()),
    [sales]
  );

  const total = sales.reduce((a, s) => a + Number(s.total || 0), 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl bg-zinc-950 border-zinc-800 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="text-zinc-100 flex items-center gap-2">
            {channel === "live" && <Radio className="h-4 w-4 text-rose-400" />}
            {title}
          </DialogTitle>
          <div className="flex items-center gap-3 text-xs text-zinc-400">
            <span>{sales.length} vendas · {BRL(total)}</span>
            {dupCount > 0 && (
              <span className="flex items-center gap-1 text-amber-400 font-medium">
                <AlertTriangle className="h-3.5 w-3.5" /> {dupCount} possíveis duplicadas
              </span>
            )}
          </div>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 text-zinc-400 text-sm px-1">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando itens...
          </div>
        )}

        <ScrollArea className="h-[65vh] rounded border border-zinc-800">
          <div className="divide-y divide-zinc-800/60">
            {sorted.length === 0 && (
              <p className="text-center p-6 text-zinc-500 text-sm">Nenhuma venda neste canal no período.</p>
            )}
            {sorted.map((s) => {
              const dup = dupInfoFor(s);
              const isOpen = expanded === s.id;
              const items = itemsBySale.get(s.id) || [];
              const pd = s.payment_details || {};
              const shipping = Number(pd?.shipping_amount || 0);
              return (
                <div key={s.id} className={dup.isDup ? "bg-amber-500/[0.06]" : ""}>
                  <button
                    onClick={() => setExpanded(isOpen ? null : s.id)}
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-zinc-900/60 transition-colors"
                  >
                    {isOpen ? <ChevronDown className="h-4 w-4 text-zinc-500 shrink-0" /> : <ChevronRight className="h-4 w-4 text-zinc-500 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-zinc-200 truncate">
                          {s.customer_name || <span className="italic text-zinc-500">Sem cliente</span>}
                        </span>
                        {dup.isDup && (
                          <Badge className={`text-[10px] border-0 ${dup.strong ? "bg-red-500/20 text-red-300" : "bg-amber-500/20 text-amber-300"}`}>
                            <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                            {dup.strong ? "duplicada" : "verificar"} ({dup.count})
                          </Badge>
                        )}
                        {channel === "live" && s.event_id && (
                          <Badge className="text-[10px] border-0 bg-rose-500/20 text-rose-300">
                            {eventNames.get(s.event_id) || "evento"}
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-500 truncate">
                        {format(new Date(s.paid_at || s.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                        {" · "}{sellerNames.get(s.seller_id || "") || "sem vendedor"}
                        {s.customer_phone ? ` · ${s.customer_phone}` : ""}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-emerald-400">{BRL(Number(s.total || 0))}</p>
                      <p className="text-[10px] text-zinc-500">{s.payment_method || pd?.method || "—"}</p>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4 pt-1 space-y-3 bg-zinc-900/40">
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-[11px]">
                        <Detail icon={User} label="Cliente" value={s.customer_name || "—"} />
                        <Detail icon={Phone} label="Telefone" value={s.customer_phone || "—"} />
                        <Detail icon={CreditCard} label="Pagamento" value={s.payment_method || pd?.method || "—"} />
                        <Detail icon={Calendar} label="Data" value={format(new Date(s.paid_at || s.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })} />
                        <Detail icon={User} label="Vendedor" value={sellerNames.get(s.seller_id || "") || "—"} />
                        <Detail icon={Package} label="Pedido" value={`#${s.id.slice(0, 8)}`} />
                        {s.customer_cpf && <Detail icon={User} label="CPF" value={s.customer_cpf} />}
                        {channel === "live" && s.event_id && (
                          <Detail icon={Radio} label="Evento" value={eventNames.get(s.event_id) || s.event_id.slice(0, 8)} />
                        )}
                      </div>

                      <div className="rounded border border-zinc-800 overflow-hidden">
                        <table className="w-full text-[11px]">
                          <thead className="bg-zinc-900 text-zinc-500">
                            <tr>
                              <th className="text-left p-2 font-medium">Produto</th>
                              <th className="text-center p-2 font-medium">Qtd</th>
                              <th className="text-right p-2 font-medium">Unit.</th>
                              <th className="text-right p-2 font-medium">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.length === 0 && (
                              <tr><td colSpan={4} className="p-2 text-center text-zinc-500 italic">Sem itens registrados</td></tr>
                            )}
                            {items.map((it, idx) => (
                              <tr key={idx} className="border-t border-zinc-800/60">
                                <td className="p-2 text-zinc-300">
                                  {it.product_name || it.sku || "—"}
                                  {(it.variant_name || it.size) && (
                                    <span className="text-zinc-500"> · {[it.variant_name, it.size].filter(Boolean).join(" ")}</span>
                                  )}
                                </td>
                                <td className="p-2 text-center text-zinc-300">{it.quantity || 0}</td>
                                <td className="p-2 text-right text-zinc-400">{BRL(Number(it.unit_price || 0))}</td>
                                <td className="p-2 text-right text-zinc-300">{BRL(Number(it.total_price || 0))}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-zinc-400">
                        <span>Subtotal: <b className="text-zinc-200">{BRL(Number(s.subtotal || 0))}</b></span>
                        {Number(s.discount || 0) > 0 && <span>Desconto: <b className="text-zinc-200">{BRL(Number(s.discount || 0))}</b></span>}
                        {shipping > 0 && <span>Frete: <b className="text-zinc-200">{BRL(shipping)}</b></span>}
                        <span>Total: <b className="text-emerald-400">{BRL(Number(s.total || 0))}</b></span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function Detail({ icon: Icon, label, value }: { icon: typeof User; label: string; value: string }) {
  return (
    <div className="flex items-start gap-1.5">
      <Icon className="h-3 w-3 text-zinc-500 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-zinc-500">{label}</p>
        <p className="text-zinc-200 truncate">{value}</p>
      </div>
    </div>
  );
}
