import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Check, Sparkles, Clock, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export interface CrossellBlock {
  offer_id: string;
  shopify_product_id: string;
  variant_id: string;
  title: string;
  color: string | null;
  size: string | null;
  image: string | null;
  original_price: number;
  discount_price: number;
}

interface CrossellCartItem {
  shopify_variant_id: string;
}

interface CrossellModalProps {
  open: boolean;
  orderId: string;
  offers: CrossellBlock[];
  initialCart?: CrossellCartItem[];
  onClose: () => void;
  /** Called whenever the order products change (add/remove). Receives the new products array from the edge function. */
  onCartChanged: (products: any[]) => void;
}

const COUNTDOWN_SECONDS = 120; // 2 minutes

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function CrossellModal({
  open,
  orderId,
  offers,
  initialCart = [],
  onClose,
  onCartChanged,
}: CrossellModalProps) {
  const [timeLeft, setTimeLeft] = useState(COUNTDOWN_SECONDS);
  const [busyVariant, setBusyVariant] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(
    () => new Set(initialCart.map((c) => c.shopify_variant_id)),
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // (Re)start the countdown each time the modal opens
  useEffect(() => {
    if (!open) return;
    setTimeLeft(COUNTDOWN_SECONDS);
    setAdded(new Set(initialCart.map((c) => c.shopify_variant_id)));
    intervalRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Auto-close when the timer runs out
  useEffect(() => {
    if (open && timeLeft === 0) {
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, open]);

  const mm = String(Math.floor(timeLeft / 60)).padStart(2, "0");
  const ss = String(timeLeft % 60).padStart(2, "0");
  const isUrgent = timeLeft <= 30;

  const handleAdd = async (block: CrossellBlock) => {
    setBusyVariant(block.variant_id);
    try {
      const { data, error } = await supabase.functions.invoke("checkout-crossell", {
        body: {
          action: "add",
          order_id: orderId,
          offer_id: block.offer_id,
          variant_id: block.variant_id,
          color: block.color,
          size: block.size,
          image: block.image,
          title: block.title,
        },
      });
      if (error || (data as any)?.error) {
        throw new Error((data as any)?.error || error?.message || "Erro ao adicionar");
      }
      setAdded((prev) => new Set(prev).add(block.variant_id));
      onCartChanged((data as any).products || []);
      toast.success("Produto adicionado ao seu pedido! 🎉");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível adicionar");
    } finally {
      setBusyVariant(null);
    }
  };

  const handleRemove = async (block: CrossellBlock) => {
    setBusyVariant(block.variant_id);
    try {
      const { data, error } = await supabase.functions.invoke("checkout-crossell", {
        body: {
          action: "remove",
          order_id: orderId,
          variant_id: block.variant_id,
        },
      });
      if (error || (data as any)?.error) {
        throw new Error((data as any)?.error || error?.message || "Erro ao remover");
      }
      setAdded((prev) => {
        const next = new Set(prev);
        next.delete(block.variant_id);
        return next;
      });
      onCartChanged((data as any).products || []);
      toast.success("Produto removido");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível remover");
    } finally {
      setBusyVariant(null);
    }
  };

  const hasOffers = offers.length > 0;

  // Maior desconto unitário entre as ofertas (diferença do item de maior desconto),
  // NÃO a soma de vários itens.
  const maxSavings = useMemo(
    () =>
      offers.reduce(
        (max, o) => Math.max(max, Math.max(0, o.original_price - o.discount_price)),
        0,
      ),
    [offers],
  );

  if (!hasOffers) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl w-[95vw] max-h-[90vh] p-0 overflow-y-auto gap-0 border-2 border-primary/40">
        {/* Header */}
        <div className="bg-gradient-to-br from-primary/15 via-primary/5 to-background px-4 sm:px-5 pt-5 pb-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <Sparkles className="h-5 w-5 text-primary shrink-0" />
            <h2 className="text-base sm:text-xl font-bold leading-tight">Oferta exclusiva pra você!</h2>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground max-w-lg mx-auto">
            Como você já tem um produto no carrinho, liberamos condições especiais
            {maxSavings > 0 && (
              <> com até <strong className="text-primary">{brl(maxSavings)}</strong> de desconto</>
            )}
            . Aproveite antes que o tempo acabe!
          </p>

          {/* Countdown */}
          <div
            className={`mt-3 inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-bold ${
              isUrgent
                ? "bg-destructive/15 text-destructive animate-pulse"
                : "bg-primary/10 text-primary"
            }`}
          >
            <Clock className="h-4 w-4" />
            <span className="tabular-nums">{mm}:{ss}</span>
            <span className="font-medium text-xs">restantes</span>
          </div>
        </div>

        {/* Horizontal scroll carousel */}
        <div className="px-3 pb-2">
          <div
            className="flex gap-3 overflow-x-auto py-4 px-1 snap-x snap-mandatory scrollbar-thin touch-pan-x"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            {offers.map((block) => {
              const isAdded = added.has(block.variant_id);
              const isBusy = busyVariant === block.variant_id;
              const discountPct =
                block.original_price > 0
                  ? Math.round(
                      ((block.original_price - block.discount_price) / block.original_price) * 100,
                    )
                  : 0;
              return (
                <div
                  key={block.variant_id}
                  className="snap-start shrink-0 w-[160px] sm:w-[240px] rounded-xl border border-border bg-card overflow-hidden flex flex-col"
                >
                  <div className="relative aspect-square bg-muted">
                    {block.image ? (
                      <img
                        src={block.image}
                        alt={block.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                        Sem imagem
                      </div>
                    )}
                    {discountPct > 0 && (
                      <Badge className="absolute top-2 left-2 bg-destructive text-destructive-foreground border-0 font-bold">
                        -{discountPct}%
                      </Badge>
                    )}
                  </div>
                  <div className="p-3 flex flex-col flex-1">
                    <p className="text-sm font-semibold leading-tight line-clamp-2 min-h-[2.5rem]">
                      {block.title}
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {block.color && (
                        <Badge variant="secondary" className="text-[10px]">
                          {block.color}
                        </Badge>
                      )}
                      {block.size && (
                        <Badge variant="secondary" className="text-[10px]">
                          Tam. {block.size}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-2">
                      {block.original_price > block.discount_price && (
                        <p className="text-xs text-muted-foreground line-through">
                          {brl(block.original_price)}
                        </p>
                      )}
                      <p className="text-lg font-bold text-primary leading-none">
                        {brl(block.discount_price)}
                      </p>
                    </div>
                    <div className="mt-3 mt-auto pt-3">
                      {isAdded ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full border-destructive/40 text-destructive hover:bg-destructive/10"
                          disabled={isBusy}
                          onClick={() => handleRemove(block)}
                        >
                          {isBusy ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <Trash2 className="h-4 w-4 mr-1" /> Remover
                            </>
                          )}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          className="w-full font-semibold"
                          disabled={isBusy}
                          onClick={() => handleAdd(block)}
                        >
                          {isBusy ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <Plus className="h-4 w-4 mr-1" /> Adicionar
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-5 py-3 border-t bg-muted/30 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 sm:gap-3">
          <p className="text-[11px] text-muted-foreground flex items-center gap-1 order-2 sm:order-1">
            <Check className="h-3.5 w-3.5 text-primary shrink-0" />
            Itens adicionados entram no mesmo pagamento
          </p>
          <Button
            size="sm"
            onClick={onClose}
            className="order-1 sm:order-2 w-full sm:w-auto font-semibold shrink-0"
          >
            Continuar pagamento
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
