// Troca Presencial — fluxo único (cliente na loja)
// Reaproveita createNewExchange + finalizeExchange (NF-e devolução, estoque,
// voucher, estorno, venda-espelho já implementados).
// Extras deste fluxo:
//  • Se diferença a favor da loja → cliente paga na hora (registra cash_flow IN).
//  • Se diferença a favor do cliente → voucher (padrão) ou estorno financeiro.
//  • Redenção de voucher existente também descontada da diferença a pagar.
//  • Se o pedido original não tem NF → segue sem emitir devolução fiscal.

import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Loader2, Search, Store, User, ChevronRight, Plus, Trash2, CheckCircle2, Ticket, Wallet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { POSTinyProductPicker } from "./POSTinyProductPicker";
import {
  createNewExchange, motivoReposEstoquePadrao,
  type ExchangeItemInput, type ReposicaoItemInput,
} from "@/lib/pos/newExchange";
import { finalizeExchange, type ConferItemInput } from "@/lib/pos/finalizeExchange";
import type { Database } from "@/integrations/supabase/types";

type TdMotivo = Database["public"]["Enums"]["td_motivo"];

const STORES: { id: string; name: string }[] = [
  { id: "4ade7b44-5043-4ab1-a124-7a6ab5468e29", name: "Loja Centro" },
  { id: "1c08a9d8-fc12-4657-8ecf-d442f0c0e9f2", name: "Loja Perola" },
];

const MOTIVOS: { value: TdMotivo; label: string }[] = [
  { value: "defeito_avaria", label: "Defeito / Avaria" },
  { value: "tamanho", label: "Tamanho errado" },
  { value: "arrependimento", label: "Arrependimento" },
  { value: "erro_expedicao", label: "Erro de expedição (nosso)" },
  { value: "outro", label: "Outro" },
];

const PAY_METHODS = [
  { value: "dinheiro", label: "Dinheiro" },
  { value: "pix", label: "PIX" },
  { value: "cartao_debito", label: "Cartão débito" },
  { value: "cartao_credito", label: "Cartão crédito" },
] as const;

const PAGE_SIZE = 12;

interface Sale {
  id: string;
  external_order_id: string | null;
  notes: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_cpf: string | null;
  total: number | null;
  created_at: string;
}

interface SaleItemRow {
  key: string;
  produto_id: string | null;
  sku: string;
  name: string;
  variant: string;
  size: string | null;
  barcode: string;
  unit_price: number;
  quantity: number;
  returned: boolean;
}

interface ReposRow {
  id: string;
  produto_id?: string | null;
  sku: string;
  produto_nome: string;
  tamanho?: string;
  barcode?: string;
  valor_unitario: number;
  quantidade: number;
}

interface VoucherRedeem {
  id: string;
  codigo: string;
  saldo: number;
}

interface Props {
  open: boolean;
  sellerId?: string;
  sellerName?: string;
  onCancel: () => void;
  onDone: () => void;
}

function orderName(notes: string | null, ext: string | null): string | null {
  const m = (notes || "").match(/#\s*(\d+)/);
  if (m) return `#${m[1]}`;
  return ext ? `#${ext}` : null;
}

export function PresentialExchangePicker({ open, sellerId, sellerName, onCancel, onDone }: Props) {
  const [phase, setPhase] = useState<"store" | "list" | "config">("store");
  const [storeId, setStoreId] = useState<string>("");

  const [sales, setSales] = useState<Sale[]>([]);
  const [loadingSales, setLoadingSales] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [loadingOrder, setLoadingOrder] = useState<string | null>(null);

  const [sale, setSale] = useState<Sale | null>(null);
  const [chaveOriginal, setChaveOriginal] = useState<string | null>(null);
  const [customer, setCustomer] = useState<{ id?: string; name?: string; whatsapp?: string } | null>(null);
  const [items, setItems] = useState<SaleItemRow[]>([]);

  const [motivo, setMotivo] = useState<TdMotivo | "">("");
  const [repos, setRepos] = useState<ReposRow[]>([]);

  // Resolução de diferença
  const [creditoResolucao, setCreditoResolucao] = useState<"voucher" | "estorno_financeiro">("voucher");
  const [estornoForma, setEstornoForma] = useState<"pix" | "cartao" | "dinheiro">("pix");
  const [pagForma, setPagForma] = useState<typeof PAY_METHODS[number]["value"]>("pix");

  // Voucher redenção
  const [voucherCodigo, setVoucherCodigo] = useState("");
  const [voucherLoading, setVoucherLoading] = useState(false);
  const [voucherAplicado, setVoucherAplicado] = useState<VoucherRedeem | null>(null);

  const [saving, setSaving] = useState(false);

  const lojaNome = STORES.find((s) => s.id === storeId)?.name || "";

  useEffect(() => {
    if (open) {
      setPhase("store"); setStoreId(""); setSales([]); setPage(0);
      setSearch(""); setDebounced(""); setSale(null); setChaveOriginal(null);
      setCustomer(null); setItems([]); setMotivo(""); setRepos([]);
      setCreditoResolucao("voucher"); setEstornoForma("pix"); setPagForma("pix");
      setVoucherCodigo(""); setVoucherAplicado(null);
    }
  }, [open]);

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search.trim()); setPage(0); }, 400);
    return () => clearTimeout(t);
  }, [search]);

  const loadSales = useCallback(async () => {
    if (!storeId) return;
    setLoadingSales(true);
    try {
      let q = supabase
        .from("pos_sales")
        .select("id, external_order_id, notes, customer_name, customer_phone, customer_cpf, total, created_at")
        .eq("store_id", storeId)
        .neq("status", "cancelled")
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
      if (debounced) {
        const digits = debounced.replace(/\D/g, "");
        const ors = [`customer_name.ilike.%${debounced}%`, `notes.ilike.%${debounced}%`];
        if (digits) {
          ors.push(`customer_phone.ilike.%${digits}%`);
          ors.push(`customer_cpf.ilike.%${digits}%`);
          ors.push(`external_order_id.ilike.%${digits}%`);
        }
        q = q.or(ors.join(","));
      }
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data || []) as Sale[];
      setHasMore(rows.length > PAGE_SIZE);
      setSales(rows.slice(0, PAGE_SIZE));
    } catch (e) {
      console.error("[PresentialExchangePicker] loadSales", e);
      toast.error("Erro ao carregar vendas");
    } finally {
      setLoadingSales(false);
    }
  }, [storeId, page, debounced]);

  useEffect(() => { if (open && phase === "list") loadSales(); }, [open, phase, loadSales]);

  const selectSale = async (s: Sale) => {
    setLoadingOrder(s.id);
    try {
      const { data: rawItems, error: itErr } = await supabase
        .from("pos_sale_items")
        .select("sku, product_name, variant_name, size, unit_price, quantity, barcode")
        .eq("sale_id", s.id);
      if (itErr) throw itErr;

      const { data: saleTotals } = await supabase
        .from("pos_sales")
        .select("discount, total, subtotal")
        .eq("id", s.id)
        .maybeSingle();
      const { computeEffectiveUnitPrices } = await import("@/lib/pos/effectivePrice");
      const eff = computeEffectiveUnitPrices(
        (rawItems || []).map((i: any) => ({
          unit_price: Number(i.unit_price || 0),
          quantity: Number(i.quantity || 1),
        })),
        Number((saleTotals as any)?.discount || 0),
        Number((saleTotals as any)?.total || 0) || null,
      );

      const skus = [...new Set((rawItems || []).map((i: any) => (i.sku || "").trim()).filter(Boolean))];
      const bySku = new Map<string, { id: string; barcode: string }>();
      if (skus.length > 0) {
        const { data: prods } = await supabase
          .from("pos_products")
          .select("id, sku, barcode")
          .in("sku", skus)
          .eq("store_id", storeId);
        for (const p of prods || []) {
          const k = String((p as any).sku || "");
          if (k && !bySku.has(k)) bySku.set(k, { id: (p as any).id, barcode: (p as any).barcode || "" });
        }
      }

      const rows: SaleItemRow[] = (rawItems || []).map((i: any, idx: number) => {
        const resolved = bySku.get(String(i.sku || ""));
        return {
          key: `${s.id}-${idx}`,
          produto_id: resolved?.id || null,
          sku: i.sku || "",
          name: i.product_name || "Produto",
          variant: i.variant_name || "",
          size: i.size || null,
          barcode: (i.barcode || resolved?.barcode || "") as string,
          unit_price: eff.effective[idx] ?? Number(i.unit_price || 0),
          quantity: Number(i.quantity || 1),
          returned: true,
        };
      });

      const { data: full } = await supabase
        .from("pos_sales")
        .select("customer_id, customer_name, customer_phone")
        .eq("id", s.id)
        .maybeSingle();
      setCustomer({
        id: (full as any)?.customer_id || undefined,
        name: (full as any)?.customer_name || undefined,
        whatsapp: (full as any)?.customer_phone || undefined,
      });

      const { data: fdoc } = await supabase
        .from("fiscal_documents")
        .select("chave_acesso")
        .eq("pos_sale_id", s.id)
        .not("chave_acesso", "is", null)
        .neq("chave_acesso", "")
        .limit(1)
        .maybeSingle();
      setChaveOriginal(fdoc?.chave_acesso || null);

      setSale(s);
      setItems(rows);
      setPhase("config");
    } catch (e) {
      console.error("[PresentialExchangePicker] selectSale", e);
      toast.error("Erro ao puxar dados da venda");
    } finally {
      setLoadingOrder(null);
    }
  };

  const devolvidos = items.filter((i) => i.returned);
  const totalDevolvido = devolvidos.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  const devolucaoTotal = items.length > 0 && devolvidos.length === items.length;
  const totalReposicao = repos.reduce((s, r) => s + r.valor_unitario * r.quantidade, 0);
  const bruto = Number((totalReposicao - totalDevolvido).toFixed(2));
  const voucherDesconto = voucherAplicado ? Math.min(voucherAplicado.saldo, Math.max(0, bruto)) : 0;
  const diferenca = Number((bruto - voucherDesconto).toFixed(2));
  const clientePaga = diferenca > 0.009 ? diferenca : 0;
  const favorCliente = diferenca < -0.009 ? Math.abs(diferenca) : 0;

  const addRepos = () =>
    setRepos((r) => [...r, { id: crypto.randomUUID(), sku: "", produto_nome: "", valor_unitario: 0, quantidade: 1 }]);

  const aplicarVoucher = async () => {
    const codigo = voucherCodigo.trim();
    if (!codigo) return;
    setVoucherLoading(true);
    try {
      const { data, error } = await supabase
        .from("vouchers")
        .select("id, codigo, saldo, status, validade")
        .eq("codigo", codigo)
        .maybeSingle();
      if (error) throw error;
      if (!data) { toast.error("Voucher não encontrado"); return; }
      if ((data as any).status !== "ativo") { toast.error("Voucher não está ativo"); return; }
      const saldo = Number((data as any).saldo || 0);
      if (saldo <= 0) { toast.error("Voucher sem saldo"); return; }
      const validade = (data as any).validade ? new Date((data as any).validade) : null;
      if (validade && validade.getTime() < Date.now()) { toast.error("Voucher expirado"); return; }
      setVoucherAplicado({ id: (data as any).id, codigo: (data as any).codigo, saldo });
      toast.success(`Voucher ${(data as any).codigo}: R$ ${saldo.toFixed(2)} disponível`);
    } catch (e: any) {
      console.error("[PresentialExchangePicker] aplicarVoucher", e);
      toast.error(e?.message || "Erro ao aplicar voucher");
    } finally {
      setVoucherLoading(false);
    }
  };

  const finalize = async () => {
    if (!sale || !motivo) { toast.error("Selecione o motivo"); return; }
    if (devolvidos.length === 0) { toast.error("Selecione ao menos 1 item devolvido"); return; }
    const tipo: "troca" | "devolucao" = repos.length > 0 ? "troca" : "devolucao";
    if (tipo === "troca") {
      const validos = repos.filter((r) => r.sku && r.produto_nome);
      if (validos.length === 0) { toast.error("Selecione o(s) produto(s) de reposição"); return; }
    }

    setSaving(true);
    try {
      // 1) Cria o evento com produto em mãos (status recebido_conferencia).
      const reposEstoquePadrao = motivoReposEstoquePadrao(motivo as TdMotivo);
      const devolvidosInput: ExchangeItemInput[] = devolvidos.map((i) => ({
        produto_id: i.produto_id,
        sku: i.sku,
        barcode: i.barcode,
        produto_nome: i.variant ? `${i.name} - ${i.variant}` : i.name,
        tamanho: i.size,
        quantidade: i.quantity,
        valor_unitario: i.unit_price,
        repoe_estoque: reposEstoquePadrao,
      }));
      const reposicoesInput: ReposicaoItemInput[] =
        tipo === "troca"
          ? repos.filter((r) => r.sku && r.produto_nome).map((r) => ({
              produto_id: r.produto_id,
              sku: r.sku,
              barcode: r.barcode,
              produto_nome: r.produto_nome,
              tamanho: r.tamanho,
              quantidade: r.quantidade,
              valor_unitario: r.valor_unitario,
              estado_estoque: "reservado" as any,
            }))
          : [];

      const created = await createNewExchange({
        tipo,
        motivo: motivo as TdMotivo,
        origem_canal: "fisica",
        loja_origem_id: storeId,
        loja_nome: lojaNome,
        pedido_original_id: sale.id,
        chave_acesso_original: chaveOriginal,
        cliente_id: customer?.id || null,
        cliente_nome: customer?.name || null,
        cliente_whatsapp: customer?.whatsapp || null,
        cliente_endereco: null,
        codigo_postagem_reversa: null,
        modo_expedicao: "aguarda_retorno",
        status: "recebido_conferencia" as any,
        vendedora_troca_id: sellerId || null,
        devolvidos: devolvidosInput,
        reposicoes: reposicoesInput,
      });

      // 2) Puxa IDs dos itens recém criados p/ conferência + reposição.
      const { data: itensCriados } = await supabase
        .from("trocas_devolucoes_itens")
        .select("id, sku, barcode, direcao, produto_id, produto_nome, quantidade")
        .eq("troca_devolucao_id", created.id);

      const devIds = (itensCriados || []).filter((r: any) => r.direcao === "devolvido");
      const repIds = (itensCriados || []).filter((r: any) => r.direcao === "reposicao").map((r: any) => r.id);

      const conferidos: ConferItemInput[] = devIds.map((row: any, idx: number) => {
        const orig = devolvidos[idx];
        return {
          itemId: row.id,
          produto_id: row.produto_id || orig?.produto_id || null,
          sku: row.sku || orig?.sku || null,
          barcode: row.barcode || orig?.barcode || null,
          produto_nome: row.produto_nome || null,
          quantidade: Number(row.quantidade || orig?.quantity || 1),
          confirmado: true,
          condicao: reposEstoquePadrao ? "vendavel" : "avaria",
        };
      });

      // 3) Finaliza (NF-e devolução se aplicável + estoque + venda-espelho + voucher/estorno).
      const result = await finalizeExchange({
        eventId: created.id,
        tipo,
        loja_origem_id: storeId,
        pedido_original_id: sale.id,
        modo_expedicao: "aguarda_retorno",
        motivo_cancelamento: tipo,
        sellerId: sellerId || null,
        sellerName: sellerName || null,
        conferidos,
        reposicaoItemIds: repIds,
        emitirDevolucao: !!chaveOriginal,
        origem_canal: "fisica",
        cliente_id: customer?.id || null,
        valor_devolvido: totalDevolvido,
        valor_reposicao: totalReposicao,
        resolucao_diferenca: favorCliente > 0 ? creditoResolucao : undefined,
        estorno_forma: favorCliente > 0 && creditoResolucao === "estorno_financeiro" ? estornoForma : null,
        codigo_devolucao: created.codigo_devolucao,
      });

      if (!result.concluded) {
        toast.warning("Troca criada mas com pendência fiscal — verificar em Consultar.");
      }

      // 4) Voucher redimido: debita saldo e marca como usado se zerou.
      if (voucherAplicado && voucherDesconto > 0) {
        const novoSaldo = Number((voucherAplicado.saldo - voucherDesconto).toFixed(2));
        try {
          await supabase.from("vouchers").update({
            saldo: novoSaldo,
            status: novoSaldo <= 0.009 ? ("usado" as any) : ("ativo" as any),
          } as any).eq("id", voucherAplicado.id);
        } catch (e) { console.error("[Presencial] voucher debit", e); }
      }

      // 5) Diferença paga na hora pelo cliente → cash_flow IN + baixa no mirror sale.
      if (clientePaga > 0 && result.posSaleId) {
        try {
          await supabase.from("pos_sales").update({
            payment_method: pagForma,
            paid_at: new Date().toISOString(),
          } as any).eq("id", result.posSaleId);
        } catch (e) { console.error("[Presencial] mirror payment", e); }
        try {
          await supabase.from("cash_flow_entries").insert({
            store_id: storeId,
            entry_date: new Date().toISOString().slice(0, 10),
            direction: "in",
            amount: clientePaga,
            payment_method: pagForma,
            description: `Diferença troca presencial ${created.codigo_devolucao}`,
            source: "troca_devolucao",
            source_ref_id: created.id,
          } as any);
        } catch (e) { console.error("[Presencial] cash flow", e); }
      }

      toast.success(`Troca presencial ${created.codigo_devolucao} concluída.`);
      onDone();
    } catch (e: any) {
      console.error("[PresentialExchangePicker] finalize", e);
      toast.error(e?.message || "Erro ao finalizar troca presencial");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="bg-pos-black border-emerald-500/40 max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-pos-white text-xl flex items-center gap-2">
            <Store className="h-5 w-5 text-emerald-400" /> Troca Presencial
          </DialogTitle>
        </DialogHeader>

        {phase === "store" && (
          <div className="space-y-4 pt-2">
            <p className="text-sm text-pos-white/60">Selecione a loja onde o cliente está.</p>
            <div className="grid grid-cols-2 gap-2">
              {STORES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setStoreId(s.id)}
                  className={cn(
                    "rounded-xl border-2 p-4 flex flex-col items-center gap-2 transition-all",
                    storeId === s.id
                      ? "border-emerald-400 bg-emerald-500/15"
                      : "border-emerald-400/20 bg-pos-white/5 hover:border-emerald-400/50",
                  )}
                >
                  <Store className="h-6 w-6 text-emerald-400" />
                  <span className="text-sm font-medium text-pos-white text-center">{s.name}</span>
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" className="text-pos-white/70" onClick={onCancel}>Cancelar</Button>
              <Button
                className="bg-emerald-500 text-pos-white hover:bg-emerald-600 font-bold"
                disabled={!storeId}
                onClick={() => setPhase("list")}
              >
                Buscar vendas <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {phase === "list" && (
          <div className="space-y-3 pt-1">
            <div className="flex items-center gap-2">
              <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-400/40 shrink-0">{lojaNome}</Badge>
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-pos-white/40" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por nome, telefone, CPF ou nº do pedido"
                  className="pl-8 bg-pos-white/5 border-emerald-400/30 text-pos-white"
                />
              </div>
            </div>
            <ScrollArea className="h-[46vh] pr-2">
              {loadingSales ? (
                <div className="flex items-center justify-center py-10 text-pos-white/50">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando vendas...
                </div>
              ) : sales.length === 0 ? (
                <p className="text-center text-pos-white/40 py-10 text-sm">Nenhuma venda encontrada</p>
              ) : (
                <div className="space-y-2">
                  {sales.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => selectSale(s)}
                      disabled={loadingOrder === s.id}
                      className="w-full text-left rounded-xl border border-emerald-400/20 bg-pos-white/5 hover:border-emerald-400/60 p-3 transition-all disabled:opacity-50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-pos-white truncate flex items-center gap-1">
                            <User className="h-3 w-3 text-emerald-400" />
                            {s.customer_name || "Cliente"}
                            {orderName(s.notes, s.external_order_id) && (
                              <span className="text-emerald-300 ml-1">{orderName(s.notes, s.external_order_id)}</span>
                            )}
                          </p>
                          <p className="text-[11px] text-pos-white/40">
                            {new Date(s.created_at).toLocaleDateString("pt-BR")} · R$ {Number(s.total || 0).toFixed(2)}
                          </p>
                        </div>
                        {loadingOrder === s.id
                          ? <Loader2 className="h-4 w-4 animate-spin text-emerald-400 shrink-0" />
                          : <ChevronRight className="h-4 w-4 text-pos-white/30 shrink-0" />}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
            <div className="flex items-center justify-between">
              <Button variant="ghost" className="text-pos-white/70" onClick={() => setPhase("store")}>Voltar</Button>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="border-emerald-400/30 text-pos-white"
                  disabled={page === 0 || loadingSales} onClick={() => setPage((p) => Math.max(0, p - 1))}>Anterior</Button>
                <Button variant="outline" size="sm" className="border-emerald-400/30 text-pos-white"
                  disabled={!hasMore || loadingSales} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
              </div>
            </div>
          </div>
        )}

        {phase === "config" && sale && (
          <ScrollArea className="max-h-[70vh] pr-2">
            <div className="space-y-4 pt-1">
              {/* Resumo */}
              <div className="rounded-xl border border-emerald-400/20 bg-pos-white/5 p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-pos-white">
                    {customer?.name || "Cliente"} {orderName(sale.notes, sale.external_order_id)}
                  </p>
                  <Badge className={cn("border", chaveOriginal
                    ? "bg-emerald-500/15 text-emerald-300 border-emerald-400/40"
                    : "bg-amber-500/15 text-amber-300 border-amber-400/40")}>
                    {chaveOriginal ? "Com NF (emite devolução)" : "Sem NF (só estoque)"}
                  </Badge>
                </div>
                <p className="text-[11px] text-pos-white/40">{lojaNome} · {new Date(sale.created_at).toLocaleDateString("pt-BR")}</p>
              </div>

              {/* Itens devolvidos */}
              <div>
                <p className="text-xs font-semibold text-pos-white/70 mb-2">
                  Itens devolvidos <span className="text-pos-white/40">(desmarque os que ficam com o cliente)</span>
                </p>
                <div className="space-y-1.5">
                  {items.map((it) => (
                    <label key={it.key} className={cn(
                      "flex items-center gap-3 rounded-lg border p-2.5 cursor-pointer transition-colors",
                      it.returned ? "border-emerald-400/50 bg-emerald-500/10" : "border-pos-white/10 bg-pos-white/5 opacity-60",
                    )}>
                      <Checkbox
                        checked={it.returned}
                        onCheckedChange={(c) => setItems((arr) => arr.map((x) => x.key === it.key ? { ...x, returned: !!c } : x))}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-pos-white truncate">
                          {it.name}{it.variant && <span className="text-emerald-300"> - {it.variant}</span>}
                        </p>
                        <p className="text-[10px] text-pos-white/40">
                          {it.sku && `SKU ${it.sku} · `}{it.size && `Tam ${it.size} · `}Qtd {it.quantity} · R$ {it.unit_price.toFixed(2)}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
                <div className="flex items-center justify-between mt-2 text-[11px] text-pos-white/50">
                  <span>{devolvidos.length}/{items.length} devolvidos {devolucaoTotal && "(devolução total)"}</span>
                  <span>Total devolvido: R$ {totalDevolvido.toFixed(2)}</span>
                </div>
              </div>

              {/* Motivo */}
              <div>
                <p className="text-xs font-semibold text-pos-white/70 mb-1">Motivo</p>
                <Select value={motivo} onValueChange={(v) => setMotivo(v as TdMotivo)}>
                  <SelectTrigger className="bg-pos-white/5 border-emerald-400/30 text-pos-white">
                    <SelectValue placeholder="Selecione o motivo" />
                  </SelectTrigger>
                  <SelectContent className="z-[60]">
                    {MOTIVOS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Reposição (opcional) */}
              <div className="rounded-xl border border-emerald-400/20 bg-pos-white/5 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-pos-white/70">Produtos de reposição (opcional)</p>
                  <Button size="sm" variant="outline" className="h-7 border-emerald-400/30 text-pos-white text-xs" onClick={addRepos}>
                    <Plus className="h-3 w-3 mr-1" /> Adicionar
                  </Button>
                </div>
                {repos.length === 0 && <p className="text-[11px] text-pos-white/40">Sem reposição → devolução pura (gera voucher/estorno pelo valor devolvido).</p>}
                {repos.map((r) => (
                  <div key={r.id} className="flex items-end gap-2">
                    <div className="flex-1">
                      <POSTinyProductPicker
                        storeId={storeId}
                        label="Produto de reposição"
                        value={r.produto_nome}
                        onSelect={(p) =>
                          setRepos((arr) => arr.map((x) => x.id === r.id ? {
                            ...x,
                            sku: p.sku,
                            produto_nome: p.product_name,
                            tamanho: p.size,
                            barcode: p.barcode,
                            valor_unitario: p.unit_price,
                          } : x))
                        }
                      />
                    </div>
                    <div className="w-14">
                      <label className="text-pos-white/50 text-[10px]">Qtd</label>
                      <Input
                        type="number" min={1}
                        value={r.quantidade}
                        onChange={(e) => setRepos((arr) => arr.map((x) => x.id === r.id ? { ...x, quantidade: Math.max(1, Number(e.target.value) || 1) } : x))}
                        className="h-8 text-xs bg-pos-white/5 border-emerald-400/30 text-pos-white"
                      />
                    </div>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-red-400"
                      onClick={() => setRepos((arr) => arr.filter((x) => x.id !== r.id))}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>

              {/* Voucher redenção */}
              <div className="rounded-xl border border-purple-400/20 bg-purple-500/5 p-3 space-y-2">
                <p className="text-xs font-semibold text-pos-white/70 flex items-center gap-1">
                  <Ticket className="h-3 w-3 text-purple-400" /> Aplicar voucher existente (opcional)
                </p>
                {voucherAplicado ? (
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm text-pos-white font-medium flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-emerald-400" /> {voucherAplicado.codigo}
                      </p>
                      <p className="text-[11px] text-pos-white/50">Saldo R$ {voucherAplicado.saldo.toFixed(2)} · Aplicado R$ {voucherDesconto.toFixed(2)}</p>
                    </div>
                    <Button size="sm" variant="ghost" className="text-red-400" onClick={() => { setVoucherAplicado(null); setVoucherCodigo(""); }}>
                      Remover
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      value={voucherCodigo}
                      onChange={(e) => setVoucherCodigo(e.target.value.toUpperCase())}
                      placeholder="Código do voucher"
                      className="bg-pos-white/5 border-purple-400/30 text-pos-white text-sm"
                    />
                    <Button size="sm" variant="outline" className="border-purple-400/30 text-pos-white"
                      disabled={!voucherCodigo || voucherLoading} onClick={aplicarVoucher}>
                      {voucherLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Aplicar"}
                    </Button>
                  </div>
                )}
              </div>

              {/* Balanço financeiro */}
              <div className="rounded-xl border border-emerald-400/40 bg-emerald-500/5 p-3 space-y-2">
                <div className="flex items-center justify-between text-xs text-pos-white/60">
                  <span>Devolvido</span><span>R$ {totalDevolvido.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-pos-white/60">
                  <span>Reposição</span><span>R$ {totalReposicao.toFixed(2)}</span>
                </div>
                {voucherDesconto > 0 && (
                  <div className="flex items-center justify-between text-xs text-purple-300">
                    <span>Voucher aplicado</span><span>- R$ {voucherDesconto.toFixed(2)}</span>
                  </div>
                )}
                <div className="border-t border-emerald-400/20 pt-2 flex items-center justify-between text-sm font-bold">
                  {clientePaga > 0 ? (
                    <><span className="text-amber-300">Cliente paga</span><span className="text-amber-300">R$ {clientePaga.toFixed(2)}</span></>
                  ) : favorCliente > 0 ? (
                    <><span className="text-purple-300">Crédito ao cliente</span><span className="text-purple-300">R$ {favorCliente.toFixed(2)}</span></>
                  ) : (
                    <><span className="text-emerald-300">Sem diferença</span><span className="text-emerald-300">R$ 0,00</span></>
                  )}
                </div>
              </div>

              {/* Diferença cliente paga */}
              {clientePaga > 0 && (
                <div>
                  <p className="text-xs font-semibold text-pos-white/70 mb-1 flex items-center gap-1">
                    <Wallet className="h-3 w-3" /> Forma de pagamento da diferença
                  </p>
                  <Select value={pagForma} onValueChange={(v) => setPagForma(v as any)}>
                    <SelectTrigger className="bg-pos-white/5 border-emerald-400/30 text-pos-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[60]">
                      {PAY_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Diferença crédito ao cliente */}
              {favorCliente > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-pos-white/70">Como resolver o crédito?</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(["voucher", "estorno_financeiro"] as const).map((r) => (
                      <button
                        key={r}
                        onClick={() => setCreditoResolucao(r)}
                        className={cn("rounded-lg border-2 p-2.5 text-xs font-medium transition-all",
                          creditoResolucao === r ? "border-purple-400 bg-purple-500/15 text-pos-white" : "border-pos-white/10 bg-pos-white/5 text-pos-white/60")}
                      >
                        {r === "voucher" ? "🎟️ Voucher" : "💸 Estorno"}
                      </button>
                    ))}
                  </div>
                  {creditoResolucao === "estorno_financeiro" && (
                    <Select value={estornoForma} onValueChange={(v) => setEstornoForma(v as any)}>
                      <SelectTrigger className="bg-pos-white/5 border-purple-400/30 text-pos-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="z-[60]">
                        <SelectItem value="pix">PIX</SelectItem>
                        <SelectItem value="dinheiro">Dinheiro</SelectItem>
                        <SelectItem value="cartao">Cartão</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <Button variant="ghost" className="text-pos-white/70" onClick={() => setPhase("list")}>Voltar</Button>
                <Button
                  className="bg-emerald-500 text-pos-white hover:bg-emerald-600 font-bold"
                  disabled={saving}
                  onClick={finalize}
                >
                  {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                  Concluir troca presencial
                </Button>
              </div>
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
