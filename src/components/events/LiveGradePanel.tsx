import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

export type PaymentFilter = "pago" | "nao_pago" | "ambos";

export type LinhaGrade = {
  produto_nome: string;
  cor: string;
  total_vendido: number;
  grades: number;
  status: "lucro" | "empate" | "prejuizo" | "sem_grade";
  vendidos: { tam: string; qtd: number; estouro: boolean }[];
  vender_mais: { tam: string; qtd: number }[];
  tamanhos_estouro: string[];
  grade_cheia: boolean;
  tamanhos_fora_da_grade: { tam: string; qtd: number }[];
  /** estoque atual por numeração (todas as lojas) */
  estoque?: { tam: string; qtd: number }[];
  estoque_total?: number;
  /** pares que faltam comprar por numeração, já descontando o estoque */
  comprar?: { tam: string; qtd: number }[];
  /** grades a comprar já descontando o estoque */
  grades_comprar?: number;
};

export const PAYMENT_OPTIONS: { id: PaymentFilter; label: string }[] = [
  { id: "pago", label: "PAGOS" },
  { id: "nao_pago", label: "NÃO PAGOS" },
  { id: "ambos", label: "AMBOS" },
];

const STATUS_STYLES: Record<LinhaGrade["status"], { label: string; pill: string; row?: string }> = {
  lucro: { label: "Lucro", pill: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
  empate: { label: "Empate", pill: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
  prejuizo: {
    label: "Prejuízo",
    pill: "bg-destructive/15 text-destructive border-destructive/30",
    row: "bg-destructive/5",
  },
  sem_grade: { label: "Fora da grade", pill: "bg-muted text-muted-foreground border-border" },
};

interface LiveGradePanelProps {
  eventId?: string | null;
  active?: boolean;
  /** Filtro controlado externamente (opcional) */
  paymentFilter?: PaymentFilter;
  onPaymentFilterChange?: (v: PaymentFilter) => void;
  /** Esconde o seletor PAGOS/NÃO PAGOS/AMBOS */
  hideFilter?: boolean;
  className?: string;
}

/** Painel de grades da Live em tempo real (cálculo 100% na RPC). */
export function LiveGradePanel({
  eventId,
  active = true,
  paymentFilter,
  onPaymentFilterChange,
  hideFilter = false,
  className,
}: LiveGradePanelProps) {
  const [internalFilter, setInternalFilter] = useState<PaymentFilter>("pago");
  const filter = paymentFilter ?? internalFilter;
  const setFilter = (v: PaymentFilter) => {
    if (onPaymentFilterChange) onPaymentFilterChange(v);
    else setInternalFilter(v);
  };

  const [gradeRows, setGradeRows] = useState<LinhaGrade[]>([]);
  const [loadingGrade, setLoadingGrade] = useState(false);
  const [gradeError, setGradeError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  /** Soma também os pedidos da live anterior (mesmos produtos vendidos nas duas lives) */
  const [incluirAnterior, setIncluirAnterior] = useState(true);
  const [prevLive, setPrevLive] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!eventId) {
      setPrevLive(null);
      return;
    }
    (async () => {
      const { data } = await (supabase as any).rpc("get_live_anterior_grade", { p_live_id: eventId });
      if (!cancelled) setPrevLive((data?.[0] as { id: string; name: string }) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const loadGrade = useCallback(async () => {
    if (!eventId) return;
    setLoadingGrade(true);
    setGradeError(null);
    const { data, error } = await (supabase as any).rpc("get_relatorio_grade_live", {
      p_live_id: eventId,
      p_status: filter,
      p_incluir_anterior: incluirAnterior,
    });
    if (error) {
      setGradeError(error.message);
      setGradeRows([]);
    } else {
      setGradeRows((data as LinhaGrade[]) ?? []);
      setUpdatedAt(new Date());
    }
    setLoadingGrade(false);
  }, [eventId, filter, incluirAnterior]);

  useEffect(() => {
    if (!active || !eventId) return;
    loadGrade();
  }, [active, eventId, loadGrade]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!active || !eventId) return;
    const bump = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => loadGrade(), 500);
    };
    const channel = supabase
      .channel(`grade-report-${eventId}-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `event_id=eq.${eventId}` },
        bump,
      );
    if (incluirAnterior && prevLive?.id) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `event_id=eq.${prevLive.id}` },
        bump,
      );
    }
    channel.subscribe();

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [active, eventId, loadGrade, incluirAnterior, prevLive?.id]);


  const totalPares = gradeRows.reduce((sum, r) => sum + (r.total_vendido || 0), 0);
  const totalGrades = gradeRows.reduce((sum, r) => sum + (r.grades || 0), 0);
  const totalGradesComprar = gradeRows.reduce((sum, r) => sum + (r.grades_comprar || 0), 0);
  const totalEstoque = gradeRows.reduce((sum, r) => sum + (r.estoque_total || 0), 0);

  const GRID =
    "grid-cols-[minmax(0,2fr)_150px_minmax(0,1.6fr)_minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,1.6fr)]";

  return (
    <div className={cn("flex min-h-0 flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {!hideFilter ? (
          <Tabs value={filter} onValueChange={(v) => setFilter(v as PaymentFilter)}>
            <TabsList>
              {PAYMENT_OPTIONS.map((opt) => (
                <TabsTrigger key={opt.id} value={opt.id} className="text-xs">
                  {opt.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {prevLive && (
            <Button
              variant={incluirAnterior ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs"
              onClick={() => setIncluirAnterior((v) => !v)}
              title={`Somar os pedidos de ${prevLive.name}`}
            >
              {incluirAnterior ? "Somando" : "Somar"} live anterior · {prevLive.name}
            </Button>
          )}

          {updatedAt && (
            <span>
              atualizado às{" "}
              {updatedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={loadGrade} disabled={!eventId || loadingGrade}>
            <RefreshCw className={cn("h-4 w-4", loadingGrade && "animate-spin")} />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-lg border">
        <div
          className={cn(
            "grid shrink-0 gap-3 bg-muted/50 px-3 py-2 text-sm font-semibold text-muted-foreground",
            GRID,
          )}
        >
          <span>Produto · cor</span>
          <span>Status</span>
          <span>Vendidos</span>
          <span>Estoque atual</span>
          <span>Vender mais</span>
          <span>Comprar (já descontando estoque)</span>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          {!eventId ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Selecione uma live para ver o painel de grades.
            </div>
          ) : loadingGrade && gradeRows.length === 0 ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : gradeError ? (
            <div className="p-6 text-center text-sm text-destructive">{gradeError}</div>
          ) : gradeRows.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Nenhum par no filtro atual
            </div>
          ) : (
            gradeRows.map((row, idx) => {
              const style = STATUS_STYLES[row.status] ?? STATUS_STYLES.sem_grade;
              const estouro = new Set(row.tamanhos_estouro ?? []);
              return (
                <div
                  key={`${row.produto_nome}-${row.cor}-${idx}`}
                  className={cn(
                    "grid grid-cols-[minmax(0,2fr)_160px_minmax(0,2fr)_minmax(0,2fr)] items-start gap-3 border-t px-3 py-3 text-base",
                    style.row,
                  )}
                >
                  <div className="min-w-0">
                    <div className="whitespace-normal break-words text-base font-semibold leading-tight">
                      {row.produto_nome}
                    </div>
                    <div className="whitespace-normal break-words text-sm text-muted-foreground">
                      {row.cor} · {row.total_vendido} pares
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("rounded-full border px-2 py-0.5 text-sm font-semibold", style.pill)}>
                      {style.label}
                    </span>
                    {row.status !== "sem_grade" && (
                      <span className="font-mono text-sm text-muted-foreground">{row.grades}g</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(row.vendidos ?? []).map((v) => (
                      <span
                        key={`v-${v.tam}`}
                        className={cn(
                          "rounded bg-muted/60 px-2 py-0.5 font-mono text-sm font-medium text-muted-foreground",
                          (v.estouro || estouro.has(v.tam)) && "bg-amber-500/15 text-amber-600",
                        )}
                      >
                        {v.tam}×{v.qtd}
                      </span>
                    ))}
                    {(row.tamanhos_fora_da_grade ?? []).length > 0 && (
                      <span className="font-mono text-sm text-muted-foreground/80">
                        fora: {row.tamanhos_fora_da_grade.map((f) => `${f.tam}×${f.qtd}`).join(" ")}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {row.status === "sem_grade" ? (
                      <span className="text-sm text-muted-foreground">—</span>
                    ) : row.grade_cheia || (row.vender_mais ?? []).length === 0 ? (
                      <span className="text-base font-bold text-emerald-600">Grade cheia</span>
                    ) : (
                      row.vender_mais.map((v) => (
                        <span
                          key={`m-${v.tam}`}
                          className="rounded bg-primary/15 px-2 py-1 font-mono text-lg font-extrabold text-foreground"
                        >
                          {v.tam}×{v.qtd}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              );
            })
          )}
        </ScrollArea>
        {gradeRows.length > 0 && (
          <div className="border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {gradeRows.length} modelo(s)/cor · {totalPares} pares · {totalGrades} grade(s)
          </div>
        )}
      </div>
    </div>
  );
}
