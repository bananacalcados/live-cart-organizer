// Fase 3 — Etapa 1: Nova Troca/Devolução (venda faturada)
// Fluxo: escolher loja -> buscar/selecionar venda -> puxar dados fiscais/itens/cliente
//        -> selecionar itens devolvidos (parcial) -> troca/devolução -> motivo
//        -> (se troca) reposição + reserva -> modo de expedição -> gerar registro + PDF.
import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Loader2, Search, RotateCcw, User, ChevronRight, Store, Plus, Trash2, FileDown,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { POSTinyProductPicker } from "./POSTinyProductPicker";
import {
  createNewExchange, generateExchangeLabelPdf, motivoReposEstoquePadrao,
  type ExchangeItemInput, type ReposicaoItemInput,
} from "@/lib/pos/newExchange";
import type { Database } from "@/integrations/supabase/types";

type TdMotivo = Database["public"]["Enums"]["td_motivo"];

const SITE_STORE_ID = "2bd2c08d-321c-47ee-98a9-e27e936818ab"; // Tiny Shopify (site)
const STORES: { id: string; name: string; canal: "fisica" | "site" }[] = [
  { id: "4ade7b44-5043-4ab1-a124-7a6ab5468e29", name: "Loja Centro", canal: "fisica" },
  { id: "1c08a9d8-fc12-4657-8ecf-d442f0c0e9f2", name: "Loja Perola", canal: "fisica" },
  { id: SITE_STORE_ID, name: "Site (Online)", canal: "site" },
];

const MOTIVOS: { value: TdMotivo; label: string }[] = [
  { value: "defeito_avaria", label: "Defeito / Avaria" },
  { value: "tamanho", label: "Tamanho errado" },
  { value: "arrependimento", label: "Arrependimento" },
  { value: "erro_expedicao", label: "Erro de expedição (nosso)" },
  { value: "outro", label: "Outro" },
];

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
  returned: boolean; // true = devolvido (fica na devolução)
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

interface Props {
  open: boolean;
  sellerId?: string;
  onCancel: () => void;
  onDone: () => void;
}

function orderName(notes: string | null, ext: string | null): string | null {
  const m = (notes || "").match(/#\s*(\d+)/);
  if (m) return `#${m[1]}`;
  return ext ? `#${ext}` : null;
}

export function NewExchangePicker({ open, sellerId, onCancel, onDone }: Props) {
  const [phase, setPhase] = useState<"store" | "list" | "config">("store");
  const [storeId, setStoreId] = useState<string>("");

  const [sales, setSales] = useState<Sale[]>([]);
  const [loadingSales, setLoadingSales] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [loadingOrder, setLoadingOrder] = useState<string | null>(null);

  // dados da venda selecionada
  const [sale, setSale] = useState<Sale | null>(null);
  const [chaveOriginal, setChaveOriginal] = useState<string | null>(null);
  const [customer, setCustomer] = useState<{ id?: string; name?: string; whatsapp?: string; address?: string } | null>(null);
  const [items, setItems] = useState<SaleItemRow[]>([]);

  // configuração da troca/devolução
  const [tipo, setTipo] = useState<"troca" | "devolucao">("devolucao");
  const [motivo, setMotivo] = useState<TdMotivo | "">("");
  const [postagemReversa, setPostagemReversa] = useState("");
  const [modoExpedicao, setModoExpedicao] = useState<"aguarda_retorno" | "despacho_antecipado">("aguarda_retorno");
  const [produtoEmMaos, setProdutoEmMaos] = useState(false);
  const [repos, setRepos] = useState<ReposRow[]>([]);
  const [saving, setSaving] = useState(false);

  const canal = STORES.find((s) => s.id === storeId)?.canal || "fisica";
  const lojaNome = STORES.find((s) => s.id === storeId)?.name || "";

  // reset ao abrir
  useEffect(() => {
    if (open) {
      setPhase("store"); setStoreId(""); setSales([]); setPage(0);
      setSearch(""); setDebounced(""); setSale(null); setChaveOriginal(null);
      setCustomer(null); setItems([]); setTipo("devolucao"); setMotivo("");
      setPostagemReversa(""); setModoExpedicao("aguarda_retorno");
      setProdutoEmMaos(false); setRepos([]);
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
      console.error("[NewExchangePicker] loadSales", e);
      toast.error("Erro ao carregar vendas da loja");
    } finally {
      setLoadingSales(false);
    }
  }, [storeId, page, debounced]);

  useEffect(() => {
    if (open && phase === "list") loadSales();
  }, [open, phase, loadSales]);

  const selectSale = async (s: Sale) => {
    setLoadingOrder(s.id);
    try {
      // itens
      const { data: rawItems, error: itErr } = await supabase
        .from("pos_sale_items")
        .select("sku, product_name, variant_name, size, unit_price, quantity, barcode")
        .eq("sale_id", s.id);
      if (itErr) throw itErr;

      // resolve produto_id por sku (catálogo da loja)
      const skus = [...new Set((rawItems || []).map((i: any) => (i.sku || "").trim()).filter(Boolean))];
      const bySku = new Map<string, { id: string; barcode: string }>();
      if (skus.length > 0) {
        const { data: prods } = await supabase
          .from("pos_products")
          .select("id, sku, barcode")
          .in("sku", skus);
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
          unit_price: Number(i.unit_price || 0),
          quantity: Number(i.quantity || 1),
          returned: true, // por padrão, todos entram na devolução; a vendedora remove os que ficam
        };
      });

      // cliente
      const { data: full } = await supabase
        .from("pos_sales")
        .select("customer_id, customer_name, customer_phone, shipping_address")
        .eq("id", s.id)
        .maybeSingle();
      const addr: any = (full as any)?.shipping_address || {};
      const address = [addr.address, addr.address_number || addr.number, addr.neighborhood, addr.city, addr.state]
        .filter(Boolean).join(", ");
      setCustomer({
        id: (full as any)?.customer_id || undefined,
        name: (full as any)?.customer_name || undefined,
        whatsapp: (full as any)?.customer_phone || undefined,
        address: address || undefined,
      });

      // dados fiscais (chave de acesso). Venda física sem nota => segue sem estorno fiscal.
      const { data: fdoc } = await supabase
        .from("fiscal_documents")
        .select("chave_acesso")
        .eq("pos_sale_id", s.id)
        .not("chave_acesso", "is", null)
        .neq("chave_acesso", "")
        .limit(1)
        .maybeSingle();
      setChaveOriginal(fdoc?.chave_acesso || null);
      if (!fdoc?.chave_acesso && canal === "fisica") {
        toast.info("Venda sem nota fiscal — seguindo sem estorno fiscal.");
      }

      setSale(s);
      setItems(rows);
      setPhase("config");
    } catch (e) {
      console.error("[NewExchangePicker] selectSale", e);
      toast.error("Erro ao puxar os dados da venda");
    } finally {
      setLoadingOrder(null);
    }
  };

  const devolvidos = items.filter((i) => i.returned);
  const totalDevolvido = devolvidos.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  const devolucaoTotal = items.length > 0 && devolvidos.length === items.length;

  const addRepos = () =>
    setRepos((r) => [...r, { id: crypto.randomUUID(), sku: "", produto_nome: "", valor_unitario: 0, quantidade: 1 }]);

  const finalize = async () => {
    if (!sale || !motivo) { toast.error("Selecione o motivo"); return; }
    if (devolvidos.length === 0) { toast.error("Selecione ao menos 1 item devolvido"); return; }
    if (tipo === "troca") {
      const validos = repos.filter((r) => r.sku && r.produto_nome);
      if (validos.length === 0) { toast.error("Selecione o(s) produto(s) de reposição"); return; }
    }

    setSaving(true);
    try {
      const reposEstoquePadrao = motivoReposEstoquePadrao(motivo);
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

      const estadoRepos = modoExpedicao === "despacho_antecipado" ? "despachado" : "reservado";
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
              estado_estoque: estadoRepos as any,
            }))
          : [];

      // Status inicial: físico com produto em mãos -> vai direto p/ conferência.
      const status =
        canal === "fisica" && produtoEmMaos ? "recebido_conferencia" : "aguardando_retorno";

      const params = {
        tipo,
        motivo: motivo as TdMotivo,
        origem_canal: canal,
        loja_origem_id: storeId,
        loja_nome: lojaNome,
        pedido_original_id: sale.id,
        chave_acesso_original: chaveOriginal,
        cliente_id: customer?.id || null,
        cliente_nome: customer?.name || null,
        cliente_whatsapp: customer?.whatsapp || null,
        cliente_endereco: customer?.address || null,
        codigo_postagem_reversa: postagemReversa.trim() || null,
        modo_expedicao: modoExpedicao,
        status: status as any,
        vendedora_troca_id: sellerId || null,
        devolvidos: devolvidosInput,
        reposicoes: reposicoesInput,
      };

      const result = await createNewExchange(params);

      // Devolução total: marca o pedido original como cancelado (fora das métricas).
      if (devolucaoTotal) {
        await supabase
          .from("pos_sales")
          .update({
            status_cancelamento: "cancelado",
            motivo_cancelamento: tipo === "troca" ? "troca" : "devolucao",
          } as any)
          .eq("id", sale.id);
      }

      // PDF da etiqueta/instrução
      try {
        generateExchangeLabelPdf({ ...params, codigo_devolucao: result.codigo_devolucao });
      } catch (pdfErr) {
        console.error("[NewExchangePicker] pdf", pdfErr);
      }

      toast.success(`Troca/Devolução ${result.codigo_devolucao} criada.`);
      onDone();
    } catch (e: any) {
      console.error("[NewExchangePicker] finalize", e);
      toast.error(e?.message || "Erro ao criar troca/devolução");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="bg-pos-black border-purple-500/40 max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-pos-white text-xl flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-purple-400" /> Nova Troca / Devolução
          </DialogTitle>
        </DialogHeader>

        {/* ETAPA: escolher loja */}
        {phase === "store" && (
          <div className="space-y-4 pt-2">
            <p className="text-sm text-pos-white/60">Selecione a loja da venda original.</p>
            <div className="grid grid-cols-3 gap-2">
              {STORES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setStoreId(s.id)}
                  className={cn(
                    "rounded-xl border-2 p-4 flex flex-col items-center gap-2 transition-all",
                    storeId === s.id
                      ? "border-purple-400 bg-purple-500/15"
                      : "border-purple-400/20 bg-pos-white/5 hover:border-purple-400/50",
                  )}
                >
                  <Store className="h-6 w-6 text-purple-400" />
                  <span className="text-sm font-medium text-pos-white text-center">{s.name}</span>
                  <span className="text-[10px] text-pos-white/40">{s.canal === "site" ? "Online" : "Física"}</span>
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" className="text-pos-white/70" onClick={onCancel}>Cancelar</Button>
              <Button
                className="bg-purple-500 text-pos-white hover:bg-purple-600 font-bold"
                disabled={!storeId}
                onClick={() => setPhase("list")}
              >
                Buscar vendas <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ETAPA: escolher venda */}
        {phase === "list" && (
          <div className="space-y-3 pt-1">
            <div className="flex items-center gap-2">
              <Badge className="bg-purple-500/20 text-purple-300 border-purple-400/40 shrink-0">{lojaNome}</Badge>
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-pos-white/40" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por nome, telefone, CPF ou nº do pedido"
                  className="pl-8 bg-pos-white/5 border-purple-400/30 text-pos-white"
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
                      className="w-full text-left rounded-xl border border-purple-400/20 bg-pos-white/5 hover:border-purple-400/60 p-3 transition-all disabled:opacity-50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-pos-white truncate flex items-center gap-1">
                            <User className="h-3 w-3 text-purple-400" />
                            {s.customer_name || "Cliente"}
                            {orderName(s.notes, s.external_order_id) && (
                              <span className="text-purple-300 ml-1">{orderName(s.notes, s.external_order_id)}</span>
                            )}
                          </p>
                          <p className="text-[11px] text-pos-white/40">
                            {new Date(s.created_at).toLocaleDateString("pt-BR")} · R$ {Number(s.total || 0).toFixed(2)}
                          </p>
                        </div>
                        {loadingOrder === s.id
                          ? <Loader2 className="h-4 w-4 animate-spin text-purple-400 shrink-0" />
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
                <Button variant="outline" size="sm" className="border-purple-400/30 text-pos-white"
                  disabled={page === 0 || loadingSales} onClick={() => setPage((p) => Math.max(0, p - 1))}>Anterior</Button>
                <Button variant="outline" size="sm" className="border-purple-400/30 text-pos-white"
                  disabled={!hasMore || loadingSales} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
              </div>
            </div>
          </div>
        )}

        {/* ETAPA: configurar troca/devolução */}
        {phase === "config" && sale && (
          <ScrollArea className="max-h-[70vh] pr-2">
            <div className="space-y-4 pt-1">
              {/* Resumo */}
              <div className="rounded-xl border border-purple-400/20 bg-pos-white/5 p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-pos-white">
                    {customer?.name || "Cliente"} {orderName(sale.notes, sale.external_order_id)}
                  </p>
                  <Badge className={cn("border", chaveOriginal ? "bg-emerald-500/15 text-emerald-300 border-emerald-400/40" : "bg-amber-500/15 text-amber-300 border-amber-400/40")}>
                    {chaveOriginal ? "Com NF" : "Sem NF"}
                  </Badge>
                </div>
                <p className="text-[11px] text-pos-white/40">{lojaNome} · {new Date(sale.created_at).toLocaleDateString("pt-BR")}</p>
              </div>

              {/* Itens (parcial) */}
              <div>
                <p className="text-xs font-semibold text-pos-white/70 mb-2">
                  Itens devolvidos <span className="text-pos-white/40">(desmarque os que ficam com o cliente)</span>
                </p>
                <div className="space-y-1.5">
                  {items.map((it) => (
                    <label
                      key={it.key}
                      className={cn(
                        "flex items-center gap-3 rounded-lg border p-2.5 cursor-pointer transition-colors",
                        it.returned ? "border-purple-400/50 bg-purple-500/10" : "border-pos-white/10 bg-pos-white/5 opacity-60",
                      )}
                    >
                      <Checkbox
                        checked={it.returned}
                        onCheckedChange={(c) =>
                          setItems((arr) => arr.map((x) => x.key === it.key ? { ...x, returned: !!c } : x))
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-pos-white truncate">
                          {it.name}{it.variant && <span className="text-purple-300"> - {it.variant}</span>}
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

              {/* Tipo */}
              <div className="grid grid-cols-2 gap-2">
                {(["devolucao", "troca"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTipo(t)}
                    className={cn(
                      "rounded-xl border-2 p-3 text-sm font-bold transition-all",
                      tipo === t ? "border-purple-400 bg-purple-500/15 text-pos-white" : "border-purple-400/20 bg-pos-white/5 text-pos-white/60",
                    )}
                  >
                    {t === "troca" ? "🔁 Troca" : "↩️ Devolução"}
                  </button>
                ))}
              </div>

              {/* Motivo */}
              <div>
                <p className="text-xs font-semibold text-pos-white/70 mb-1">Motivo</p>
                <Select value={motivo} onValueChange={(v) => setMotivo(v as TdMotivo)}>
                  <SelectTrigger className="bg-pos-white/5 border-purple-400/30 text-pos-white">
                    <SelectValue placeholder="Selecione o motivo" />
                  </SelectTrigger>
                  <SelectContent className="z-[60]">
                    {MOTIVOS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {motivo && (
                  <p className="text-[10px] text-pos-white/40 mt-1">
                    {motivoReposEstoquePadrao(motivo)
                      ? "Itens devolvidos voltam ao estoque vendável."
                      : "Itens devolvidos NÃO voltam ao estoque (avaria)."}
                  </p>
                )}
              </div>

              {/* Postagem reversa */}
              <div>
                <p className="text-xs font-semibold text-pos-white/70 mb-1">Código de postagem reversa <span className="text-pos-white/40">(opcional)</span></p>
                <Input
                  value={postagemReversa}
                  onChange={(e) => setPostagemReversa(e.target.value)}
                  placeholder="Ex: PR123456789BR"
                  className="bg-pos-white/5 border-purple-400/30 text-pos-white"
                />
              </div>

              {/* Reposição (troca) */}
              {tipo === "troca" && (
                <div className="rounded-xl border border-purple-400/20 bg-pos-white/5 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-pos-white/70">Produtos de reposição</p>
                    <Button size="sm" variant="outline" className="h-7 border-purple-400/30 text-pos-white text-xs" onClick={addRepos}>
                      <Plus className="h-3 w-3 mr-1" /> Adicionar
                    </Button>
                  </div>
                  {repos.length === 0 && <p className="text-[11px] text-pos-white/40">Nenhum produto de reposição.</p>}
                  {repos.map((r) => (
                    <div key={r.id} className="flex items-end gap-2">
                      <div className="flex-1">
                        <POSTinyProductPicker
                          storeId={storeId === SITE_STORE_ID ? "4ade7b44-5043-4ab1-a124-7a6ab5468e29" : storeId}
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
                          className="h-8 text-xs bg-pos-white/5 border-purple-400/30 text-pos-white"
                        />
                      </div>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-red-400"
                        onClick={() => setRepos((arr) => arr.filter((x) => x.id !== r.id))}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  <p className="text-[10px] text-pos-white/40">
                    A reposição fica <b>reservada</b> (derruba disponível-para-venda, sem alterar a contagem física).
                  </p>
                </div>
              )}

              {/* Modo de expedição (troca) */}
              {tipo === "troca" && (
                <div>
                  <p className="text-xs font-semibold text-pos-white/70 mb-1">Modo de expedição</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setModoExpedicao("aguarda_retorno")}
                      className={cn("rounded-lg border-2 p-2.5 text-xs font-medium transition-all",
                        modoExpedicao === "aguarda_retorno" ? "border-purple-400 bg-purple-500/15 text-pos-white" : "border-purple-400/20 bg-pos-white/5 text-pos-white/60")}
                    >
                      Aguarda retorno<br /><span className="text-[10px] text-pos-white/40">Despacha na conferência (padrão)</span>
                    </button>
                    <button
                      onClick={() => setModoExpedicao("despacho_antecipado")}
                      className={cn("rounded-lg border-2 p-2.5 text-xs font-medium transition-all",
                        modoExpedicao === "despacho_antecipado" ? "border-amber-400 bg-amber-500/15 text-pos-white" : "border-purple-400/20 bg-pos-white/5 text-pos-white/60")}
                    >
                      Despacho antecipado<br /><span className="text-[10px] text-pos-white/40">Envia a reposição agora</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Produto em mãos (físico) */}
              {canal === "fisica" && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={produtoEmMaos} onCheckedChange={(c) => setProdutoEmMaos(!!c)} />
                  <span className="text-xs text-pos-white/70">Produto já está em mãos (avançar direto para conferência)</span>
                </label>
              )}

              <div className="flex items-center justify-between pt-2">
                <Button variant="ghost" className="text-pos-white/70" onClick={() => setPhase("list")}>Voltar</Button>
                <Button
                  className="bg-purple-500 text-pos-white hover:bg-purple-600 font-bold"
                  disabled={saving}
                  onClick={finalize}
                >
                  {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileDown className="h-4 w-4 mr-1" />}
                  Criar e gerar PDF
                </Button>
              </div>
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
