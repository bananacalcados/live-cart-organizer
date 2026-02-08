import { Instagram, Phone, Package, Trash2, Edit2 } from "lucide-react";
import { Order, STAGES } from "@/types/order";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface OrderCardProps {
  order: Order;
  onEdit: (order: Order) => void;
  onDelete: (orderId: string) => void;
  isDragging?: boolean;
}

export function OrderCard({ order, onEdit, onDelete, isDragging }: OrderCardProps) {
  const stage = STAGES.find((s) => s.id === order.stage);
  const totalValue = order.products.reduce(
    (sum, p) => sum + p.price * p.quantity,
    0
  );
  const totalItems = order.products.reduce((sum, p) => sum + p.quantity, 0);

  return (
    <div
      className={`order-card ${isDragging ? "dragging" : ""}`}
    >
        <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary">
            <Instagram className="h-4 w-4 text-primary-foreground" />
          </div>
          <div>
            <p className="font-semibold text-foreground text-sm">{order.instagramHandle}</p>
            <p className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(order.createdAt), {
                addSuffix: true,
                locale: ptBR,
              })}
            </p>
          </div>
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(order);
            }}
          >
            <Edit2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(order.id);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {order.whatsapp && (
          <a
          href={`https://wa.me/${order.whatsapp.replace(/\D/g, "")}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-stage-paid hover:underline mb-3"
          onClick={(e) => e.stopPropagation()}
        >
          <Phone className="h-3 w-3" />
          {order.whatsapp}
        </a>
      )}

      {order.products.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
            <Package className="h-3 w-3" />
            {totalItems} {totalItems === 1 ? "item" : "itens"}
          </div>
          <div className="space-y-1.5 max-h-24 overflow-y-auto">
            {order.products.slice(0, 3).map((product) => (
              <div
                key={product.id}
                className="flex items-center gap-2 text-xs bg-secondary/50 rounded-md p-1.5"
              >
                {product.image && (
                  <img
                    src={product.image}
                    alt={product.title}
                    className="w-8 h-8 rounded object-cover"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{product.title}</p>
                  <p className="text-muted-foreground">
                    {product.quantity}x R$ {product.price.toFixed(2)}
                  </p>
                </div>
              </div>
            ))}
            {order.products.length > 3 && (
              <p className="text-xs text-muted-foreground text-center">
                +{order.products.length - 3} mais
              </p>
            )}
          </div>
          <div className="pt-2 border-t border-border/50">
            <p className="text-sm font-bold text-accent">
              Total: R$ {totalValue.toFixed(2)}
            </p>
          </div>
        </div>
      ) : (
        <div className="py-4 text-center text-xs text-muted-foreground bg-secondary/30 rounded-lg">
          Nenhum produto adicionado
        </div>
      )}

      {order.notes && (
        <p className="mt-2 text-xs text-muted-foreground italic line-clamp-2">
          "{order.notes}"
        </p>
      )}
    </div>
  );
}
