import { Package, DollarSign, Users, TrendingUp, AlertCircle } from "lucide-react";
import { Order } from "@/types/order";

interface StatsBarProps {
  orders: Order[];
}

export function StatsBar({ orders }: StatsBarProps) {
  const totalOrders = orders.length;
  const totalValue = orders.reduce(
    (sum, order) =>
      sum + order.products.reduce((s, p) => s + p.price * p.quantity, 0),
    0
  );
  const paidOrders = orders.filter(
    (o) => o.stage === "paid" || o.stage === "shipped"
  ).length;
  const unpaidOrders = totalOrders - paidOrders;
  const conversionRate = totalOrders > 0 ? (paidOrders / totalOrders) * 100 : 0;

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
      value: unpaidOrders,
      icon: AlertCircle,
      color: "text-stage-awaiting",
      bgColor: "bg-stage-awaiting/10",
    },
    {
      label: "Valor Total",
      value: `R$ ${totalValue.toFixed(2)}`,
      icon: DollarSign,
      color: "text-accent",
      bgColor: "bg-accent/10",
    },
    {
      label: "Taxa de Conversão",
      value: `${conversionRate.toFixed(0)}%`,
      icon: TrendingUp,
      color: "text-stage-paid",
      bgColor: "bg-stage-paid/10",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="bg-card border border-border/50 rounded-xl p-4 shadow-card"
        >
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-lg ${stat.bgColor}`}>
              <stat.icon className={`h-5 w-5 ${stat.color}`} />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
