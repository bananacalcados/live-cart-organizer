import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Loader2, Sparkles, Star, User, Users, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  EventOriginDrilldownDialog,
  type OriginPerson,
  type OriginBucket,
} from "./EventOriginDrilldownDialog";

interface Props {
  eventId?: string;
  range?: { from: string; to: string; channel?: string | null };
}

interface MatrixData {
  events_count?: number;
  buyers: {
    total: number;
    lead_first_purchase: number;
    existing_customers: number;
    brand_new: number;
    revenue: number;
  };
  non_buyers: {
    total: number;
    lead_first_purchase: number;
    existing_customers: number;
    brand_new: number;
    by_reason?: Record<string, number> | null;
  };
  buyer_list: OriginPerson[];
  non_buyer_list: OriginPerson[];
}

interface DrilldownState {
  open: boolean;
  kind: "buyer" | "non_buyer";
  bucket: OriginBucket | "all";
  title: string;
}

export function EventBuyerOriginMatrix({ eventId, range }: Props) {
  const [data, setData] = useState<MatrixData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drill, setDrill] = useState<DrilldownState>({
    open: false,
    kind: "buyer",
    bucket: "all",
    title: "",
  });

  const load = useCallback(async () => {
    if (!eventId && !range) return;
    setLoading(true);
    setError(null);
    try {
      const { data: res, error } = eventId
        ? await supabase.rpc("event_buyer_origin_matrix" as any, { p_event_id: eventId })
        : await supabase.rpc("events_buyer_origin_matrix_range" as any, {
            p_from: range!.from,
            p_to: range!.to,
            p_channel: range!.channel ?? null,
          });
      if (error) throw error;
      setData(res as unknown as MatrixData);
    } catch (e: any) {
      setError(e?.message || "Falha ao carregar matriz de origem");
    } finally {
      setLoading(false);
    }
  }, [eventId, range?.from, range?.to, range?.channel]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="container py-2">
        <div className="flex items-center gap-2 rounded-lg bg-secondary/40 px-4 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Analisando origem dos compradores...
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="container py-2">
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-xs text-destructive">
          Não foi possível carregar a matriz de origem: {error || "sem dados"}
        </div>
      </div>
    );
  }

  const openDrill = (
    kind: "buyer" | "non_buyer",
    bucket: OriginBucket | "all",
    title: string,
  ) => setDrill({ open: true, kind, bucket, title });

  const buyerList = data.buyer_list || [];
  const nonBuyerList = data.non_buyer_list || [];

  const avgTicket = (bucket: OriginBucket) => {
    const rows = buyerList.filter((p) => p.bucket === bucket && (p.value ?? 0) > 0);
    if (rows.length === 0) return 0;
    const sum = rows.reduce((s, p) => s + (Number(p.value) || 0), 0);
    return sum / rows.length;
  };
  const avgLead = avgTicket("lead_first_purchase");
  const avgRecurring = avgTicket("existing_customer");
  const avgBrandNew = avgTicket("brand_new");

  return (
    <div className="container py-2 space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Buyers */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <Users className="h-4 w-4 text-emerald-600" />
                Compradores por origem
              </h3>
              <p className="text-[11px] text-muted-foreground">
                {range
                  ? `Quem eram os ${data.buyers.total} clientes de ${data.events_count ?? 0} live(s) do período antes da compra`
                  : `Quem eram os ${data.buyers.total} clientes desta live antes da compra`}
              </p>
            </div>
            <button
              className="text-[11px] text-primary hover:underline"
              onClick={() =>
                openDrill("buyer", "all", `Compradores desta live (${data.buyers.total})`)
              }
            >
              Ver todos
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <OriginTile
              label="Lead → 1ª compra"
              value={data.buyers.lead_first_purchase}
              total={data.buyers.total}
              icon={Sparkles}
              tone="text-amber-600"
              subtitle={avgLead > 0 ? `Ticket médio ${brl(avgLead)}` : undefined}
              onClick={() =>
                openDrill(
                  "buyer",
                  "lead_first_purchase",
                  `Leads que compraram pela 1ª vez (${data.buyers.lead_first_purchase})`,
                )
              }
            />
            <OriginTile
              label="Cliente recorrente"
              value={data.buyers.existing_customers}
              total={data.buyers.total}
              icon={Star}
              tone="text-emerald-600"
              subtitle={avgRecurring > 0 ? `Ticket médio ${brl(avgRecurring)}` : undefined}
              onClick={() =>
                openDrill(
                  "buyer",
                  "existing_customer",
                  `Clientes recorrentes que compraram (${data.buyers.existing_customers})`,
                )
              }
            />
            <OriginTile
              label="Totalmente novo"
              value={data.buyers.brand_new}
              total={data.buyers.total}
              icon={User}
              tone="text-blue-600"
              subtitle={avgBrandNew > 0 ? `Ticket médio ${brl(avgBrandNew)}` : undefined}
              onClick={() =>
                openDrill(
                  "buyer",
                  "brand_new",
                  `Novos compradores sem histórico (${data.buyers.brand_new})`,
                )
              }
            />
          </div>
        </Card>

        {/* Non-buyers */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <TrendingDown className="h-4 w-4 text-rose-600" />
                Não-compradores por origem
              </h3>
              <p className="text-[11px] text-muted-foreground">
                {data.non_buyers.total} pessoas engajaram mas não fecharam
              </p>
            </div>
            <button
              className="text-[11px] text-primary hover:underline"
              onClick={() =>
                openDrill(
                  "non_buyer",
                  "all",
                  `Não-compradores desta live (${data.non_buyers.total})`,
                )
              }
            >
              Ver todos
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <OriginTile
              label="Lead sem compra"
              value={data.non_buyers.lead_first_purchase}
              total={data.non_buyers.total}
              icon={Sparkles}
              tone="text-amber-600"
              onClick={() =>
                openDrill(
                  "non_buyer",
                  "lead_first_purchase",
                  `Leads que não compraram (${data.non_buyers.lead_first_purchase})`,
                )
              }
            />
            <OriginTile
              label="Cliente antigo"
              value={data.non_buyers.existing_customers}
              total={data.non_buyers.total}
              icon={Star}
              tone="text-emerald-600"
              onClick={() =>
                openDrill(
                  "non_buyer",
                  "existing_customer",
                  `Clientes antigos que não compraram (${data.non_buyers.existing_customers})`,
                )
              }
            />
            <OriginTile
              label="Totalmente novo"
              value={data.non_buyers.brand_new}
              total={data.non_buyers.total}
              icon={User}
              tone="text-blue-600"
              onClick={() =>
                openDrill(
                  "non_buyer",
                  "brand_new",
                  `Novos sem histórico que não compraram (${data.non_buyers.brand_new})`,
                )
              }
            />
          </div>
          {data.non_buyers.by_reason && Object.keys(data.non_buyers.by_reason).length > 0 && (
            <div className="mt-3 pt-3 border-t flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              {Object.entries(data.non_buyers.by_reason).map(([r, n]) => (
                <span key={r}>
                  <b className="text-foreground">{n}</b>{" "}
                  {r === "checkout_started"
                    ? "iniciou checkout"
                    : r === "abandoned_cart"
                    ? "carrinho abandonado"
                    : r === "registered_only"
                    ? "só cadastrou"
                    : r === "lead_only"
                    ? "só lead"
                    : r}
                </span>
              ))}
            </div>
          )}
        </Card>
      </div>

      <EventOriginDrilldownDialog
        open={drill.open}
        onOpenChange={(v) => setDrill((d) => ({ ...d, open: v }))}
        title={drill.title}
        people={drill.kind === "buyer" ? buyerList : nonBuyerList}
        kind={drill.kind}
        initialBucket={drill.bucket}
      />
    </div>
  );
}

function OriginTile({
  label,
  value,
  total,
  icon: Icon,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  total: number;
  icon: any;
  tone: string;
  onClick: () => void;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <button
      onClick={onClick}
      className="text-left rounded-lg border p-2.5 hover:bg-accent transition-colors group"
    >
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={cn("h-3.5 w-3.5", tone)} />
        <span className="text-[10px] font-medium text-muted-foreground group-hover:text-foreground">
          {label}
        </span>
      </div>
      <p className="text-xl font-bold leading-tight">{value}</p>
      <p className="text-[10px] text-muted-foreground">{pct}% do total</p>
    </button>
  );
}
