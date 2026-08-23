import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, KeyRound, Hand, ClipboardList, UserX } from "lucide-react";

interface GroupRow {
  origem: "cadastro_primeiro" | "pedido_primeiro" | "sem_pedido";
  pessoas: number;
  compraram: number;
  pedidos_pagos: number;
  faturamento: number;
}

interface Buyer {
  nome: string | null;
  phone: string;
  first_session: string;
  first_order: string;
  minutos_ate_pedido: number | null;
  pedidos_pagos: number;
  faturamento: number;
}

interface Payload {
  total_cadastros: number;
  groups: GroupRow[];
  compradores_cadastro_primeiro: Buyer[];
}

const fmtBRL = (n: number) =>
  (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtPhone = (raw: string) => {
  const d = String(raw || "").replace(/\D/g, "").replace(/^55/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return raw;
};

const fmtDT = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

const fmtGap = (min: number | null) => {
  if (min == null) return "—";
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} dias`;
};

const EMPTY: GroupRow = { origem: "sem_pedido", pessoas: 0, compraram: 0, pedidos_pagos: 0, faturamento: 0 };

/**
 * Área de Membros (Live) — quem deu o primeiro passo?
 * Compara o 1º acesso/cadastro em /minha-area com o 1º pedido do mesmo telefone:
 *  - cadastro_primeiro: a cliente se cadastrou sozinha ANTES de existir pedido;
 *  - pedido_primeiro: o cadastro só existe porque a equipe montou o pedido;
 *  - sem_pedido: se cadastrou e nunca teve pedido (base quente para remarketing).
 */
export function MemberAreaOriginPanel({ dateFrom, dateTo }: { dateFrom?: string | Date; dateTo?: string | Date }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [showList, setShowList] = useState(false);

  const load = useCallback(async () => {
    if (!dateFrom || !dateTo) return;
    setLoading(true);
    try {
      const { data: res, error } = await supabase.rpc("get_member_area_origin_breakdown" as any, {
        p_start: new Date(dateFrom as any).toISOString(),
        p_end: new Date(dateTo as any).toISOString(),
        p_lookback_days: 7,
      });
      if (error) throw error;
      setData(res as unknown as Payload);
    } catch (e) {
      console.error("[MemberAreaOriginPanel]", e);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const g = useMemo(() => {
    const by = (k: GroupRow["origem"]) =>
      (data?.groups || []).find((x) => x.origem === k) || { ...EMPTY, origem: k };
    return {
      self: by("cadastro_primeiro"),
      order: by("pedido_primeiro"),
      none: by("sem_pedido"),
    };
  }, [data]);

  const totalConv = g.self.compraram + g.order.compraram;
  const pctSelf = totalConv > 0 ? Math.round((g.self.compraram / totalConv) * 1000) / 10 : 0;
  const buyers = data?.compradores_cadastro_primeiro || [];

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start gap-2">
          <div className="flex-1 min-w-[240px]">
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4 text-primary" /> Área de Membros — quem deu o primeiro passo?
            </CardTitle>
            <CardDescription>
              Compara o 1º cadastro em /minha-area com o 1º pedido do mesmo WhatsApp no período.
              Mostra se a chamada da live ("entre no link e se cadastre") está gerando vendas por conta própria.
            </CardDescription>
          </div>
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={load} title="Atualizar">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {loading && !data ? (
          <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <Tile
                icon={<Hand className="h-4 w-4" />}
                accent="emerald"
                label="Cadastrou sozinha antes do pedido"
                value={g.self.pessoas}
                lines={[
                  `${g.self.compraram} compraram · ${fmtBRL(g.self.faturamento)}`,
                  `${pctSelf}% de todas as conversões do canal`,
                ]}
              />
              <Tile
                icon={<ClipboardList className="h-4 w-4" />}
                accent="violet"
                label="Pedido montado antes do cadastro"
                value={g.order.pessoas}
                lines={[
                  `${g.order.compraram} compraram · ${fmtBRL(g.order.faturamento)}`,
                  "Cadastro é consequência do pedido",
                ]}
              />
              <Tile
                icon={<UserX className="h-4 w-4" />}
                accent="amber"
                label="Só cadastro (sem pedido)"
                value={g.none.pessoas}
                lines={["Base captada pela chamada do sorteio", "Alvo natural de remarketing"]}
              />
            </div>

            <p className="text-[11px] text-muted-foreground">
              Total de cadastros no período: <strong>{data?.total_cadastros ?? 0}</strong>. Cruzamento por
              DDD + 8 últimos dígitos, considerando pedidos criados até 7 dias antes do início do período.
            </p>

            {buyers.length > 0 && (
              <div>
                <Button variant="outline" size="sm" onClick={() => setShowList((v) => !v)}>
                  {showList ? "Ocultar" : "Ver"} as {buyers.length} compradoras que se cadastraram sozinhas
                </Button>

                {showList && (
                  <div className="mt-3 max-h-[360px] overflow-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Cliente</TableHead>
                          <TableHead className="w-[140px]">WhatsApp</TableHead>
                          <TableHead className="w-[130px]">Cadastro</TableHead>
                          <TableHead className="w-[130px]">1º pedido</TableHead>
                          <TableHead className="w-[110px]">Intervalo</TableHead>
                          <TableHead className="w-[120px] text-right">Comprou</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {buyers.map((b) => (
                          <TableRow key={b.phone} className="text-xs">
                            <TableCell className="font-medium">{b.nome || "—"}</TableCell>
                            <TableCell>
                              <a
                                href={`https://wa.me/${String(b.phone).replace(/\D/g, "")}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-emerald-600 hover:underline"
                              >
                                {fmtPhone(b.phone)}
                              </a>
                            </TableCell>
                            <TableCell>{fmtDT(b.first_session)}</TableCell>
                            <TableCell>{fmtDT(b.first_order)}</TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={
                                  (b.minutos_ate_pedido ?? 0) > 30
                                    ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 text-[10px]"
                                    : "text-[10px]"
                                }
                              >
                                {fmtGap(b.minutos_ate_pedido)}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              {fmtBRL(b.faturamento)}
                              <span className="text-muted-foreground"> · {b.pedidos_pagos}x</span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground mt-2">
                  Intervalo acima de 30 min = cadastro claramente autônomo (ela voltou depois para comprar).
                  Abaixo disso, ela se cadastrou durante a live e o pedido foi montado logo em seguida.
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Tile({ icon, label, value, lines, accent }: {
  icon: React.ReactNode; label: string; value: number; lines: string[];
  accent: "emerald" | "violet" | "amber";
}) {
  const cls =
    accent === "emerald" ? "text-emerald-600 dark:text-emerald-400"
      : accent === "violet" ? "text-violet-600 dark:text-violet-400"
        : "text-amber-600 dark:text-amber-400";
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground text-[11px] mb-1">
        {icon}<span>{label}</span>
      </div>
      <div className={`text-2xl font-bold leading-tight ${cls}`}>{value.toLocaleString("pt-BR")}</div>
      {lines.map((l, i) => (
        <div key={i} className="text-[10px] text-muted-foreground mt-0.5">{l}</div>
      ))}
    </div>
  );
}

export default MemberAreaOriginPanel;
