// Fase 7 — Busca/consulta de trocas e devoluções
// Tela de listagem/pesquisa com filtros: código de devolução, cliente,
// nº do pedido, loja, status, motivo e código de postagem reversa.
import { useState, useEffect, useCallback, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Search, RefreshCw, X, Package, Truck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

type TdEvent = Database["public"]["Tables"]["trocas_devolucoes"]["Row"];
type TdStatus = Database["public"]["Enums"]["td_status"];
type TdMotivo = Database["public"]["Enums"]["td_motivo"];

const STORE_NAMES: Record<string, string> = {
  "4ade7b44-5043-4ab1-a124-7a6ab5468e29": "Loja Centro",
  "1c08a9d8-fc12-4657-8ecf-d442f0c0e9f2": "Loja Perola",
  "2bd2c08d-321c-47ee-98a9-e27e936818ab": "Site (Online)",
};

const STATUS_LABELS: Record<TdStatus, string> = {
  iniciada: "Iniciada",
  aguardando_retorno: "Aguardando Retorno",
  recebido_conferencia: "Recebido / Conferência",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

const STATUS_COLORS: Record<TdStatus, string> = {
  iniciada: "bg-yellow-500/15 text-yellow-300 border-yellow-500/40",
  aguardando_retorno: "bg-blue-500/15 text-blue-300 border-blue-500/40",
  recebido_conferencia: "bg-purple-500/15 text-purple-300 border-purple-500/40",
  concluida: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  cancelada: "bg-red-500/15 text-red-300 border-red-500/40",
};

const MOTIVO_LABELS: Record<TdMotivo, string> = {
  defeito_avaria: "Defeito / Avaria",
  tamanho: "Tamanho",
  arrependimento: "Arrependimento",
  erro_expedicao: "Erro de Expedição",
  outro: "Outro",
};

interface EventRow extends TdEvent {
  customer_name?: string | null;
  order_label?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ExchangeSearchList({ open, onClose }: Props) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(false);

  // filtros
  const [codigo, setCodigo] = useState("");
  const [cliente, setCliente] = useState("");
  const [pedido, setPedido] = useState("");
  const [postagem, setPostagem] = useState("");
  const [loja, setLoja] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [motivo, setMotivo] = useState<string>("all");

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("trocas_devolucoes")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(300);

      if (loja !== "all") query = query.eq("loja_origem_id", loja);
      if (status !== "all") query = query.eq("status", status as TdStatus);
      if (motivo !== "all") query = query.eq("motivo", motivo as TdMotivo);
      if (codigo.trim()) query = query.ilike("codigo_devolucao", `%${codigo.trim()}%`);
      if (postagem.trim()) query = query.ilike("codigo_postagem_reversa", `%${postagem.trim()}%`);

      const { data, error } = await query;
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
      console.error("[ExchangeSearchList] loadEvents", e);
      toast.error("Erro ao carregar trocas/devoluções");
    } finally {
      setLoading(false);
    }
  }, [loja, status, motivo, codigo, postagem]);

  useEffect(() => {
    if (open) {
      setCodigo(""); setCliente(""); setPedido(""); setPostagem("");
      setLoja("all"); setStatus("all"); setMotivo("all");
    }
  }, [open]);

  useEffect(() => {
    if (open) loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loja, status, motivo]);

  // filtros de texto livres aplicados no cliente (cliente / pedido)
  const filtered = useMemo(() => {
    const c = cliente.trim().toLowerCase();
    const p = pedido.trim().toLowerCase();
    return events.filter((e) => {
      if (c && !(e.customer_name || "").toLowerCase().includes(c)) return false;
      if (p && !(e.order_label || "").toLowerCase().includes(p)) return false;
      return true;
    });
  }, [events, cliente, pedido]);

  const hasActiveFilters =
    codigo || cliente || pedido || postagem ||
    loja !== "all" || status !== "all" || motivo !== "all";

  const clearFilters = () => {
    setCodigo(""); setCliente(""); setPedido(""); setPostagem("");
    setLoja("all"); setStatus("all"); setMotivo("all");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="bg-pos-black border-purple-500/40 max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-pos-white text-xl flex items-center gap-2">
            <Search className="h-5 w-5" /> Consultar Trocas / Devoluções
          </DialogTitle>
        </DialogHeader>

        {/* Filtros */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Input
            placeholder="Código (TD-...)"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && loadEvents()}
            className="bg-pos-black border-pos-white/20 text-pos-white text-sm"
          />
          <Input
            placeholder="Cliente"
            value={cliente}
            onChange={(e) => setCliente(e.target.value)}
            className="bg-pos-black border-pos-white/20 text-pos-white text-sm"
          />
          <Input
            placeholder="Nº do pedido"
            value={pedido}
            onChange={(e) => setPedido(e.target.value)}
            className="bg-pos-black border-pos-white/20 text-pos-white text-sm"
          />
          <Input
            placeholder="Postagem reversa"
            value={postagem}
            onChange={(e) => setPostagem(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && loadEvents()}
            className="bg-pos-black border-pos-white/20 text-pos-white text-sm"
          />

          <Select value={loja} onValueChange={setLoja}>
            <SelectTrigger className="bg-pos-black border-pos-white/20 text-pos-white text-sm">
              <SelectValue placeholder="Loja" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as lojas</SelectItem>
              {Object.entries(STORE_NAMES).map(([id, name]) => (
                <SelectItem key={id} value={id}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="bg-pos-black border-pos-white/20 text-pos-white text-sm">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              {(Object.keys(STATUS_LABELS) as TdStatus[]).map((s) => (
                <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={motivo} onValueChange={setMotivo}>
            <SelectTrigger className="bg-pos-black border-pos-white/20 text-pos-white text-sm">
              <SelectValue placeholder="Motivo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os motivos</SelectItem>
              {(Object.keys(MOTIVO_LABELS) as TdMotivo[]).map((m) => (
                <SelectItem key={m} value={m}>{MOTIVO_LABELS[m]}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex gap-2">
            <Button
              onClick={loadEvents}
              className="flex-1 bg-purple-600 hover:bg-purple-700 text-white"
              disabled={loading}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
            {hasActiveFilters && (
              <Button variant="outline" onClick={clearFilters} className="border-pos-white/20 text-pos-white">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        <div className="text-xs text-pos-white/50">
          {filtered.length} resultado(s)
        </div>

        {/* Lista */}
        <ScrollArea className="flex-1 -mx-2 px-2">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-pos-white/60">
              <Loader2 className="h-6 w-6 animate-spin mr-2" /> Carregando...
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-pos-white/50">
              Nenhuma troca/devolução encontrada.
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((e) => (
                <div
                  key={e.id}
                  className="rounded-xl border border-pos-white/10 bg-pos-white/5 p-3 flex flex-col gap-2"
                >
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-pos-white text-sm">
                        {e.codigo_devolucao || "—"}
                      </span>
                      <Badge variant="outline" className="text-[10px] border-pos-white/20 text-pos-white/80">
                        {e.tipo === "troca" ? "Troca" : "Devolução"}
                      </Badge>
                      <Badge className={cn("text-[10px] border", STATUS_COLORS[e.status])}>
                        {STATUS_LABELS[e.status]}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] border-pos-white/20 text-pos-white/70">
                        {MOTIVO_LABELS[e.motivo]}
                      </Badge>
                    </div>
                    <span className="text-[11px] text-pos-white/50 whitespace-nowrap">
                      {format(new Date(e.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-pos-white/70">
                    <div>
                      <span className="text-pos-white/40">Cliente:</span>{" "}
                      {e.customer_name || "—"}
                    </div>
                    <div>
                      <span className="text-pos-white/40">Pedido:</span>{" "}
                      {e.order_label || "—"}
                    </div>
                    <div>
                      <span className="text-pos-white/40">Loja:</span>{" "}
                      {e.loja_origem_id ? (STORE_NAMES[e.loja_origem_id] || "—") : "—"}
                    </div>
                    <div className="flex items-center gap-1">
                      <Truck className="h-3 w-3 text-pos-white/40" />
                      {e.codigo_postagem_reversa || "—"}
                    </div>
                  </div>

                  {(e.diferenca !== 0 || e.origem_canal === "site") && (
                    <div className="flex items-center gap-3 text-[11px] text-pos-white/50 flex-wrap">
                      <span className="flex items-center gap-1">
                        <Package className="h-3 w-3" />
                        {e.origem_canal === "site" ? "Canal: Site" : "Canal: Física"}
                      </span>
                      {e.diferenca !== 0 && (
                        <span>
                          Diferença:{" "}
                          <span className={e.diferenca > 0 ? "text-emerald-400" : "text-orange-400"}>
                            {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(e.diferenca)}
                          </span>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
