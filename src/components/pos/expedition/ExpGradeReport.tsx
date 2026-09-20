import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { LinhaGrade } from "@/components/events/LiveGradePanel";

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

interface Props {
  /** Ids das vendas (pos_sales) que estão na etapa de separação */
  saleIds: string[];
  className?: string;
}

/** Relatório de grades da Expedição — mesma lógica/visual do relatório da Live. */
export function ExpGradeReport({ saleIds, className }: Props) {
  const [rows, setRows] = useState<LinhaGrade[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const key = saleIds.join(",");

  const load = useCallback(async () => {
    if (!saleIds.length) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error } = await (supabase as any).rpc("get_relatorio_grade_expedicao", {
      p_sale_ids: saleIds,
    });
    if (error) {
      setError(error.message);
      setRows([]);
    } else {
      setRows((data as LinhaGrade[]) ?? []);
      setUpdatedAt(new Date());
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPares = rows.reduce((s, r) => s + (r.total_vendido || 0), 0);
  const totalGrades = rows.reduce((s, r) => s + (r.grades || 0), 0);

  return (
    <div className={cn("flex min-h-0 flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center justify-end gap-3 text-xs text-muted-foreground">
        {updatedAt && (
          <span>
            atualizado às {updatedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-lg border">
        <div className="grid shrink-0 grid-cols-[minmax(0,2fr)_160px_minmax(0,2fr)_minmax(0,2fr)] gap-3 bg-muted/50 px-3 py-2 text-sm font-semibold text-muted-foreground">
          <span>Produto · cor</span>
          <span>Status</span>
          <span>Vendidos</span>
          <span>Comprar / repor</span>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          {loading && rows.length === 0 ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : error ? (
            <div className="p-6 text-center text-sm text-destructive">{error}</div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Nenhum produto na separação
            </div>
          ) : (
            rows.map((row, idx) => {
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
        {rows.length > 0 && (
          <div className="border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {rows.length} modelo(s)/cor · {totalPares} pares · {totalGrades} grade(s)
          </div>
        )}
      </div>
    </div>
  );
}
