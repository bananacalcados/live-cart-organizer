import { Package, DollarSign, TrendingUp, AlertCircle, CheckCircle, Receipt } from "lucide-react";
import { Order } from "@/types/order";

interface StatsBarProps {
  orders: Order[];
}

export function StatsBar({ orders }: StatsBarProps) {
  const totalOrders = orders.length;
  
  const paidOrders = orders.filter(
    (o) => o.stage === "paid" || o.stage === "shipped"
  );
  const paidOrdersCount = paidOrders.length;
  const unpaidOrdersCount = totalOrders - paidOrdersCount;
  
  const totalValue = orders.reduce(
    (sum, order) =>
      sum + order.products.reduce((s, p) => s + p.price * p.quantity, 0),
    0
  );
  
  const receivedValue = paidOrders.reduce(
    (sum, order) =>
      sum + order.products.reduce((s, p) => s + p.price * p.quantity, 0),
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
      value: `R$ ${totalValue.toFixed(2)}`,
      icon: Receipt,
      color: "text-accent",
      bgColor: "bg-accent/10",
    },
    {
      label: "Faturamento Recebido",
      value: `R$ ${receivedValue.toFixed(2)}`,
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
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="bg-card border border-border/50 rounded-xl p-3 shadow-card"
        >
          <div className="flex items-center gap-2">
            <div className={`p-2 rounded-lg ${stat.bgColor}`}>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </div>
            <div className="min-w-0">
              <p className="text-lg font-bold text-foreground truncate">{stat.value}</p>
              <p className="text-[10px] text-muted-foreground truncate">{stat.label}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
