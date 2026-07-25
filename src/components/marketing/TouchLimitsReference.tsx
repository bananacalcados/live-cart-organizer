import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ShieldCheck } from "lucide-react";

type TouchLimit = {
  classificacao: string;
  cota_mensal: number;
  tipos_permitidos: string[] | null;
  min_dias_entre_toques: number | null;
  observacoes: string | null;
};

const CLASS_LABEL: Record<string, string> = {
  quente: "Quente",
  morno: "Morno",
  frio: "Frio",
  silencio_reativavel: "Silêncio reativável",
  silencio_puro: "Silêncio puro",
  sem_classificacao: "Sem classificação",
};

const CLASS_ORDER = ["quente", "morno", "sem_classificacao", "frio", "silencio_reativavel", "silencio_puro"];

const TIPO_LABEL: Record<string, string> = {
  convite_live: "Convite de live",
  oferta: "Oferta",
  lancamento: "Lançamento",
  reativacao: "Reativação",
  pesquisa: "Pesquisa",
};

export function TouchLimitsReference() {
  const [rows, setRows] = useState<TouchLimit[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("dispatch_touch_limits")
        .select("classificacao, cota_mensal, tipos_permitidos, min_dias_entre_toques, observacoes");
      if (data) {
        const sorted = [...(data as TouchLimit[])].sort(
          (a, b) => CLASS_ORDER.indexOf(a.classificacao) - CLASS_ORDER.indexOf(b.classificacao)
        );
        setRows(sorted);
      }
    })();
  }, []);

  if (rows.length === 0) return null;

  return (
    <Card className="border-dashed">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="py-3 cursor-pointer">
            <CardTitle className="text-sm flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Regras de cota de disparo (consulta)
              </span>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
                {open ? "Ocultar" : "Ver regras"}
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
              </Button>
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0 space-y-2">
            <p className="text-xs text-muted-foreground">
              Limites aplicados automaticamente pelo motor de cotas em todo disparo em massa e automação.
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left font-medium py-2 pr-3">Classificação</th>
                    <th className="text-left font-medium py-2 pr-3 whitespace-nowrap">Cota / mês</th>
                    <th className="text-left font-medium py-2 pr-3 whitespace-nowrap">Intervalo mín.</th>
                    <th className="text-left font-medium py-2">Canais / tipos permitidos</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const blocked = (r.cota_mensal ?? 0) <= 0;
                    return (
                      <tr key={r.classificacao} className="border-b last:border-0 align-top">
                        <td className="py-2 pr-3 font-medium whitespace-nowrap">
                          {CLASS_LABEL[r.classificacao] || r.classificacao}
                        </td>
                        <td className="py-2 pr-3">
                          <Badge variant={blocked ? "destructive" : "secondary"} className="text-[10px]">
                            {blocked ? "bloqueado" : `${r.cota_mensal} msg`}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">
                          {r.min_dias_entre_toques ? `${r.min_dias_entre_toques} dias` : "—"}
                        </td>
                        <td className="py-2">
                          {blocked || !r.tipos_permitidos?.length ? (
                            <span className="text-muted-foreground">Nenhum canal outbound</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {r.tipos_permitidos.map((t) => (
                                <Badge key={t} variant="outline" className="text-[10px] font-normal">
                                  {TIPO_LABEL[t] || t}
                                </Badge>
                              ))}
                            </div>
                          )}
                          {r.observacoes && (
                            <p className="text-[10px] text-muted-foreground mt-1 max-w-md">{r.observacoes}</p>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
