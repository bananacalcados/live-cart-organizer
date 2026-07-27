import { Package, DollarSign, TrendingUp, AlertCircle, CheckCircle, Receipt } from "lucide-react";
import { DbOrder } from "@/types/database";
import { isPaidOrderStage } from "@/lib/orderPaymentStages";

interface StatsBarProps {
  orders: DbOrder[];
}

// Calculate order final value with discount applied
const calculateOrderValue = (order: DbOrder) => {
  const subtotal = order.products.reduce((s, p) => s + p.price * p.quantity, 0);
  
  if (order.discount_type && order.discount_value) {
    const discount = order.discount_type === 'percentage'
      ? subtotal * (order.discount_value / 100)
      : order.discount_value;
    return Math.max(0, subtotal - discount);
  }
  
  return subtotal;
};

// Compact BRL: no cents, thousands separator, abbreviated when very large
const brl = (v: number) => {
  if (Math.abs(v) >= 1_000_000) {
    return `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}mi`;
  }
  return `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
};


export function StatsBar({ orders }: StatsBarProps) {
  const totalOrders = orders.length;
  
  const paidOrders = orders.filter((o) => o.is_paid || o.paid_externally || isPaidOrderStage(o.stage));
  const paidOrdersCount = paidOrders.length;
  const unpaidOrdersCount = totalOrders - paidOrdersCount;
  
  const totalValue = orders.reduce(
    (sum, order) => sum + calculateOrderValue(order),
    0
  );
  
  const receivedValue = paidOrders.reduce(
    (sum, order) => sum + calculateOrderValue(order),
    0
  );
  
  const conversionRate = totalOrders > 0 ? (paidOrdersCount / totalOrders) * 100 : 0;

  const stats = [
    {
      label: "Total de Pedidos",
      value: totalOrders,
      icon: Package,
      color: "text-primary",
      bgColor: "bg-primary/10",
    },
    {
      label: "Não Pagos",
      value: unpaidOrdersCount,
      icon: AlertCircle,
      color: "text-stage-awaiting",
      bgColor: "bg-stage-awaiting/10",
    },
    {
      label: "Pagos",
      value: paidOrdersCount,
      icon: CheckCircle,
      color: "text-stage-paid",
      bgColor: "bg-stage-paid/10",
    },
    {
      label: "Faturamento Total",
      value: brl(totalValue),
      icon: Receipt,
      color: "text-accent",
      bgColor: "bg-accent/10",
    },
    {
      label: "Faturamento Recebido",
      value: brl(receivedValue),
      icon: DollarSign,
      color: "text-stage-paid",
      bgColor: "bg-stage-paid/10",
    },
    {
      label: "Conversão",
      value: `${conversionRate.toFixed(0)}%`,
      icon: TrendingUp,
      color: "text-stage-contacted",
      bgColor: "bg-stage-contacted/10",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6 mb-2">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="bg-card border border-border/50 rounded-xl p-4 shadow-card"
        >
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-lg ${stat.bgColor}`}>
              <stat.icon className={`h-5 w-5 ${stat.color}`} />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-extrabold leading-tight text-foreground truncate">{stat.value}</p>
              <p className="text-xs font-medium text-muted-foreground truncate">{stat.label}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
