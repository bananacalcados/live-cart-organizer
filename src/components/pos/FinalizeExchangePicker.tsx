// Fase 4 — Etapa 2: Finalizar Troca/Devolução
// Buscar evento iniciado -> conferência do retorno -> entrada de estoque,
// despacho da reposição, ajuste do pedido original e conclusão.
import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2, Search, CheckCircle2, ChevronRight, PackageCheck, AlertTriangle, Undo2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { finalizeExchange, type ConferItemInput } from "@/lib/pos/finalizeExchange";
import type { Database } from "@/integrations/supabase/types";

type TdEvent = Database["public"]["Tables"]["trocas_devolucoes"]["Row"];
type TdItem = Database["public"]["Tables"]["trocas_devolucoes_itens"]["Row"];

const OPEN_STATUSES: Database["public"]["Enums"]["td_status"][] = [
  "iniciada", "aguardando_retorno", "recebido_conferencia",
];

const STORE_NAMES: Record<string, string> = {
  "4ade7b44-5043-4ab1-a124-7a6ab5468e29": "Loja Centro",
  "1c08a9d8-fc12-4657-8ecf-d442f0c0e9f2": "Loja Perola",
  "2bd2c08d-321c-47ee-98a9-e27e936818ab": "Site (Online)",
};

interface EventRow extends TdEvent {
  customer_name?: string | null;
  order_label?: string | null;
}

interface ConferRow {
  item: TdItem;
  confirmado: boolean;
  condicao: "vendavel" | "avaria";
  quantidade: number;
}

interface Props {
  open: boolean;
  sellerId?: string;
  sellerName?: string;
  onCancel: () => void;
  onDone: () => void;
}

export function FinalizeExchangePicker({ open, sellerId, sellerName, onCancel, onDone }: Props) {
  const [phase, setPhase] = useState<"list" | "confer">("list");
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<EventRow | null>(null);
  const [devolvidos, setDevolvidos] = useState<ConferRow[]>([]);
  const [reposicoes, setReposicoes] = useState<TdItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [saving, setSaving] = useState(false);
  // Fase 6: resolução da diferença a favor do cliente
  const [resolucao, setResolucao] = useState<"voucher" | "estorno_financeiro">("voucher");
  const [estornoForma, setEstornoForma] = useState<"pix" | "cartao" | "dinheiro">("pix");

  useEffect(() => {
    if (open) {
      setPhase("list"); setSearch(""); setSelected(null);
      setDevolvidos([]); setReposicoes([]);
      setResolucao("voucher"); setEstornoForma("pix");
    }
  }, [open]);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("trocas_devolucoes")
        .select("*")
        .in("status", OPEN_STATUSES)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      const rows = (data || []) as EventRow[];

      // enriquece com nome do cliente / nº do pedido
      const saleIds = [...new Set(rows.map((r) => r.pedido_original_id).filter(Boolean))] as string[];
      if (saleIds.length > 0) {
        const { data: sales } = await supabase
          .from("pos_sales")
          .select("id, customer_name, external_order_id, notes")
          .in("id", saleIds);
        const map = new Map<string, { name: string | null; label: string | null }>();
        for (const s of sales || []) {
          const m = ((s as any).notes || "").match(/#\s*(\d+)/);
          const label = m ? `#${m[1]}` : (s as any).external_order_id ? `#${(s as any).external_order_id}` : null;
          map.set((s as any).id, { name: (s as any).customer_name || null, label });
        }
        for (const r of rows) {
          const info = r.pedido_original_id ? map.get(r.pedido_original_id) : undefined;
          r.customer_name = info?.name || null;
          r.order_label = info?.label || null;
        }
      }
      setEvents(rows);
    } catch (e) {
      console.error("[FinalizeExchangePicker] loadEvents", e);
      toast.error("Erro ao carregar trocas/devoluções");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && phase === "list") loadEvents();
  }, [open, phase, loadEvents]);

  const filtered = events.filter((e) => {
    const t = search.trim().toLowerCase();
    if (!t) return true;
    return (
      (e.codigo_devolucao || "").toLowerCase().includes(t) ||
      (e.codigo_postagem_reversa || "").toLowerCase().includes(t) ||
      (e.customer_name || "").toLowerCase().includes(t) ||
      (e.order_label || "").toLowerCase().includes(t)
    );
  });

  const selectEvent = async (ev: EventRow) => {
    setLoadingItems(true);
    setSelected(ev);
    try {
      const { data, error } = await supabase
        .from("trocas_devolucoes_itens")
        .select("*")
        .eq("troca_devolucao_id", ev.id);
      if (error) throw error;
      const items = (data || []) as TdItem[];
      setDevolvidos(
        items.filter((i) => i.direcao === "devolvido").map((i) => ({
          item: i,
          confirmado: true,
          condicao: i.repoe_estoque ? "vendavel" : (ev.motivo === "defeito_avaria" ? "avaria" : "vendavel"),
          quantidade: Number(i.quantidade || 1),
        })),
      );
      setReposicoes(items.filter((i) => i.direcao === "reposicao"));
      setPhase("confer");
    } catch (e) {
      console.error("[FinalizeExchangePicker] selectEvent", e);
      toast.error("Erro ao carregar itens do evento");
    } finally {
      setLoadingItems(false);
    }
  };

  // Fase 6 — duas camadas de valor
  const valorDevolvido = devolvidos
    .filter((d) => d.confirmado)
    .reduce((s, d) => s + Number(d.item.valor_unitario || 0) * d.quantidade, 0);
  const valorReposicao = reposicoes
    .reduce((s, r) => s + Number(r.valor_unitario || 0) * Number(r.quantidade || 1), 0);
  const diferenca = Number((valorReposicao - valorDevolvido).toFixed(2));
  const isSite = selected?.origem_canal === "site";
  const faturamentoVendedoraTroca = !isSite && diferenca > 0 ? diferenca : 0;



  const finalize = async () => {
    if (!selected) return;
    const confirmados = devolvidos.filter((d) => d.confirmado);
    if (confirmados.length === 0) {
      toast.error("Confirme ao menos 1 item retornado");
      return;
    }
    setSaving(true);
    try {
      const conferidos: ConferItemInput[] = devolvidos.map((d) => ({
        itemId: d.item.id,
        produto_id: d.item.produto_id,
        sku: d.item.sku,
        barcode: d.item.barcode,
        produto_nome: d.item.produto_nome,
        quantidade: d.quantidade,
        confirmado: d.confirmado,
        condicao: d.condicao,
      }));

      const result = await finalizeExchange({
        eventId: selected.id,
        tipo: selected.tipo,
        loja_origem_id: selected.loja_origem_id || "",
        pedido_original_id: selected.pedido_original_id || "",
        modo_expedicao: selected.modo_expedicao,
        motivo_cancelamento: selected.tipo === "troca" ? "troca" : "devolucao",
        sellerName: sellerName || null,
        sellerId: sellerId || null,
        conferidos,
        reposicaoItemIds: reposicoes.map((r) => r.id),
        origem_canal: selected.origem_canal,
        cliente_id: selected.cliente_id,
        valor_devolvido: valorDevolvido,
        valor_reposicao: valorReposicao,
        resolucao_diferenca: diferenca < -0.009 ? resolucao : undefined,
        estorno_forma: diferenca < -0.009 && resolucao === "estorno_financeiro" ? estornoForma : null,
        codigo_devolucao: selected.codigo_devolucao,
      });

      const dev = result.devolucao;

      // Rejeição/erro fiscal → NÃO concluiu. Pedido original preservado. Reprocessável.
      if (!result.concluded && dev.status !== "pending_sefaz") {
        toast.error(
          `NF-e de devolução ${dev.status === "rejected" ? "rejeitada" : "falhou"}: ${dev.error || "erro desconhecido"}. ` +
          "O pedido original NÃO foi cancelado. Corrija e clique em Finalizar novamente para reemitir.",
          { duration: 9000 },
        );
        loadEvents(); // reflete o estado intermediário (fase2_erro)
        return; // mantém o diálogo aberto para reprocessar
      }

      // Contingência: estoque movimentado, mas devolução ainda em fila (SEFAZ offline).
      if (dev.status === "pending_sefaz") {
        toast.warning(
          `${selected.codigo_devolucao}: SEFAZ indisponível — devolução em fila de contingência. ` +
          "O pedido original só será cancelado quando a nota for autorizada. Reprocesse depois em Finalizar.",
          { duration: 9000 },
        );
        onDone();
        return;
      }

      // Sucesso (autorizada ou venda sem nota original).
      const fiscalMsg =
        dev.status === "authorized"
          ? " · NF-e de devolução autorizada"
          : dev.status === "skipped"
            ? " · sem estorno fiscal (venda sem nota)"
            : "";
      toast.success(
        `${selected.codigo_devolucao} concluída. ${result.restocked} item(ns) ao estoque` +
        `${result.totalReturn ? " · pedido original cancelado" : ""}${fiscalMsg}.`,
        { duration: 7000 },
      );

      if (selected.tipo === "troca") {
        toast.info("Nova NF-e de venda (valor cheio) será emitida na Fase 6.", { duration: 6000 });
      }

      onDone();
    } catch (e: any) {
      console.error("[FinalizeExchangePicker] finalize", e);
      toast.error(e?.message || "Erro ao finalizar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="bg-pos-black border-emerald-500/40 max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-pos-white text-xl flex items-center gap-2">
            <PackageCheck className="h-5 w-5 text-emerald-400" /> Finalizar Troca / Devolução
          </DialogTitle>
        </DialogHeader>

        {phase === "list" && (
          <div className="space-y-3 pt-1">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-pos-white/40" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Código de devolução, cliente, pedido ou postagem reversa"
                className="pl-8 bg-pos-white/5 border-emerald-400/30 text-pos-white"
              />
            </div>

            <ScrollArea className="h-[52vh] pr-2">
              {loading ? (
                <div className="flex items-center justify-center py-10 text-pos-white/50">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
                </div>
              ) : filtered.length === 0 ? (
                <p className="text-center text-pos-white/40 py-10 text-sm">Nenhuma troca/devolução em aberto</p>
              ) : (
                <div className="space-y-2">
                  {filtered.map((ev) => (
                    <button
                      key={ev.id}
                      onClick={() => selectEvent(ev)}
                      disabled={loadingItems}
                      className="w-full text-left rounded-xl border border-emerald-400/20 bg-pos-white/5 hover:border-emerald-400/60 p-3 transition-all disabled:opacity-50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-pos-white truncate flex items-center gap-2">
                            {ev.codigo_devolucao || "—"}
                            <Badge className={cn("border text-[10px]", ev.tipo === "troca" ? "bg-purple-500/15 text-purple-300 border-purple-400/40" : "bg-blue-500/15 text-blue-300 border-blue-400/40")}>
                              {ev.tipo === "troca" ? "Troca" : "Devolução"}
                            </Badge>
                          </p>
                          <p className="text-[11px] text-pos-white/40 truncate">
                            {ev.customer_name || "Cliente"} {ev.order_label || ""} · {STORE_NAMES[ev.loja_origem_id || ""] || "—"}
                          </p>
                          <p className="text-[10px] text-pos-white/30">
                            {ev.status} · {new Date(ev.created_at).toLocaleDateString("pt-BR")}
                            {ev.codigo_postagem_reversa && ` · ${ev.codigo_postagem_reversa}`}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-pos-white/30 shrink-0" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>

            <div className="flex justify-end">
              <Button variant="ghost" className="text-pos-white/70" onClick={onCancel}>Fechar</Button>
            </div>
          </div>
        )}

        {phase === "confer" && selected && (
          <ScrollArea className="max-h-[72vh] pr-2">
            <div className="space-y-4 pt-1">
              <div className="rounded-xl border border-emerald-400/20 bg-pos-white/5 p-3">
                <p className="text-sm font-bold text-pos-white">{selected.codigo_devolucao}</p>
                <p className="text-[11px] text-pos-white/40">
                  {selected.customer_name || "Cliente"} {selected.order_label || ""} · {STORE_NAMES[selected.loja_origem_id || ""] || "—"}
                </p>
              </div>

              <div>
                <p className="text-xs font-semibold text-pos-white/70 mb-2">Conferência do retorno</p>
                <div className="space-y-2">
                  {devolvidos.map((d, idx) => (
                    <div
                      key={d.item.id}
                      className={cn(
                        "rounded-lg border p-2.5 space-y-2 transition-colors",
                        d.confirmado ? "border-emerald-400/40 bg-emerald-500/5" : "border-pos-white/10 bg-pos-white/5 opacity-60",
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={d.confirmado}
                          onCheckedChange={(c) =>
                            setDevolvidos((arr) => arr.map((x, i) => i === idx ? { ...x, confirmado: !!c } : x))
                          }
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-pos-white truncate">{d.item.produto_nome || d.item.sku || "Produto"}</p>
                          <p className="text-[10px] text-pos-white/40">
                            {d.item.sku && `SKU ${d.item.sku} · `}{d.item.tamanho && `Tam ${d.item.tamanho} · `}R$ {Number(d.item.valor_unitario).toFixed(2)}
                          </p>
                        </div>
                        <Input
                          type="number" min={1}
                          value={d.quantidade}
                          onChange={(e) =>
                            setDevolvidos((arr) => arr.map((x, i) => i === idx ? { ...x, quantidade: Math.max(1, Number(e.target.value) || 1) } : x))
                          }
                          className="h-8 w-14 text-xs bg-pos-white/5 border-emerald-400/30 text-pos-white"
                        />
                      </div>
                      {d.confirmado && (
                        <div className="grid grid-cols-2 gap-2 pl-7">
                          <button
                            onClick={() => setDevolvidos((arr) => arr.map((x, i) => i === idx ? { ...x, condicao: "vendavel" } : x))}
                            className={cn("rounded-lg border-2 p-1.5 text-[11px] font-medium flex items-center justify-center gap-1 transition-all",
                              d.condicao === "vendavel" ? "border-emerald-400 bg-emerald-500/15 text-pos-white" : "border-pos-white/10 bg-pos-white/5 text-pos-white/60")}
                          >
                            <CheckCircle2 className="h-3 w-3" /> Vendável (volta ao estoque)
                          </button>
                          <button
                            onClick={() => setDevolvidos((arr) => arr.map((x, i) => i === idx ? { ...x, condicao: "avaria" } : x))}
                            className={cn("rounded-lg border-2 p-1.5 text-[11px] font-medium flex items-center justify-center gap-1 transition-all",
                              d.condicao === "avaria" ? "border-amber-400 bg-amber-500/15 text-pos-white" : "border-pos-white/10 bg-pos-white/5 text-pos-white/60")}
                          >
                            <AlertTriangle className="h-3 w-3" /> Avaria (não volta)
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {reposicoes.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-pos-white/70 mb-2">
                    Reposição (troca) · {selected.modo_expedicao === "despacho_antecipado" ? "já despachada" : "despacha ao concluir"}
                  </p>
                  <div className="space-y-1">
                    {reposicoes.map((r) => (
                      <div key={r.id} className="rounded-lg border border-purple-400/20 bg-purple-500/5 p-2 flex items-center gap-2">
                        <Undo2 className="h-3.5 w-3.5 text-purple-400" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-pos-white truncate">{r.produto_nome || r.sku}</p>
                          <p className="text-[10px] text-pos-white/40">
                            {r.sku && `SKU ${r.sku} · `}{r.tamanho && `Tam ${r.tamanho} · `}Qtd {r.quantidade}
                          </p>
                        </div>
                        <Badge className="bg-purple-500/15 text-purple-300 border-purple-400/40 text-[10px] border">{r.estado_estoque}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <Button variant="ghost" className="text-pos-white/70" onClick={() => setPhase("list")}>Voltar</Button>
                <Button
                  className="bg-emerald-500 text-pos-black hover:bg-emerald-600 font-bold"
                  disabled={saving}
                  onClick={finalize}
                >
                  {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <PackageCheck className="h-4 w-4 mr-1" />}
                  Concluir troca/devolução
                </Button>
              </div>
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
