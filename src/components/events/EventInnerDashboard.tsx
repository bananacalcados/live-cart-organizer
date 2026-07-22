import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import {
  DollarSign,
  ShoppingCart,
  CheckCircle2,
  Users,
  TrendingUp,
  Target,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EventBuyerOriginMatrix } from "./EventBuyerOriginMatrix";

interface DashboardData {
  total_orders: number;
  paid_orders: number;
  revenue: number;
  avg_ticket: number;
  crossell_added: number;
  crossell_converted: number;
  leads_total: number;
  leads_lp: number;
  leads_typebot: number;
  leads_converted: number;
  conversion_rate: number;
}

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

interface Props {
  eventId: string;
}

interface Metric {
  label: string;
  value: string;
  sub?: string;
  icon: typeof DollarSign;
  tone: string;
}

export function EventInnerDashboard({ eventId }: Props) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    const { data: res, error } = await supabase.rpc("event_inner_dashboard", {
      p_event_id: eventId,
    });
    if (!error && res) setData(res as unknown as DashboardData);
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="container py-2">
        <div className="flex items-center gap-2 rounded-lg bg-secondary/40 px-4 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando métricas do evento...
        </div>
      </div>
    );
  }

  if (!data) return null;

  const metrics: Metric[] = [
    {
      label: "Ticket médio",
      value: brl(data.avg_ticket),
      sub: `${data.paid_orders} pago${data.paid_orders !== 1 ? "s" : ""} • ${brl(data.revenue)}`,
      icon: DollarSign,
      tone: "text-emerald-600",
    },
    {
      label: "Crossell no carrinho",
      value: String(data.crossell_added),
      sub: "itens adicionados no checkout",
      icon: ShoppingCart,
      tone: "text-indigo-600",
    },
    {
      label: "Crossell convertido",
      value: String(data.crossell_converted),
      sub: "itens em pedidos pagos",
      icon: CheckCircle2,
      tone: "text-green-600",
    },
    {
      label: "Leads captados",
      value: String(data.leads_total),
      sub: `LP ${data.leads_lp} • Typebot ${data.leads_typebot}`,
      icon: Users,
      tone: "text-pink-600",
    },
    {
      label: "Leads convertidos",
      value: String(data.leads_converted),
      sub: "viraram venda neste evento",
      icon: Target,
      tone: "text-amber-600",
    },
    {
      label: "Taxa de conversão",
      value: `${data.conversion_rate}%`,
      sub: "leads → pedidos pagos",
      icon: TrendingUp,
      tone: "text-blue-600",
    },
  ];

  return (
    <div className="container py-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
        {metrics.map((m) => (
          <Card key={m.label} className="p-3">
            <div className="flex items-center gap-1.5">
              <m.icon className={cn("h-4 w-4", m.tone)} />
              <span className="text-[11px] font-medium text-muted-foreground">{m.label}</span>
            </div>
            <p className="mt-1 text-lg font-bold leading-tight">{m.value}</p>
            {m.sub && <p className="text-[10px] text-muted-foreground">{m.sub}</p>}
          </Card>
        ))}
      </div>
    </div>
  );
}
