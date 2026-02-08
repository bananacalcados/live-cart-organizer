import { useState, useEffect } from "react";
import { Instagram, Phone, StickyNote, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProductSelector } from "./ProductSelector";
import { Order, OrderProduct, STAGES, OrderStage } from "@/types/order";
import { useOrderStore } from "@/stores/orderStore";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface OrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingOrder?: Order | null;
}

export function OrderDialog({ open, onOpenChange, editingOrder }: OrderDialogProps) {
  const { addOrder, updateOrder, addProductToOrder, removeProductFromOrder, updateProductQuantity } = useOrderStore();

  const [instagramHandle, setInstagramHandle] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [notes, setNotes] = useState("");
  const [stage, setStage] = useState<OrderStage>("new");
  const [localProducts, setLocalProducts] = useState<OrderProduct[]>([]);

  useEffect(() => {
    if (editingOrder) {
      setInstagramHandle(editingOrder.instagramHandle);
      setWhatsapp(editingOrder.whatsapp || "");
      setNotes(editingOrder.notes || "");
      setStage(editingOrder.stage);
      setLocalProducts([...editingOrder.products]);
    } else {
      resetForm();
    }
  }, [editingOrder, open]);

  const resetForm = () => {
    setInstagramHandle("");
    setWhatsapp("");
    setNotes("");
    setStage("new");
    setLocalProducts([]);
  };

  const handleAddLocalProduct = (product: OrderProduct) => {
    setLocalProducts((prev) => {
      const existing = prev.find((p) => p.id === product.id);
      if (existing) {
        return prev.map((p) =>
          p.id === product.id ? { ...p, quantity: p.quantity + 1 } : p
        );
      }
      return [...prev, product];
    });
  };

  const handleRemoveLocalProduct = (productId: string) => {
    setLocalProducts((prev) => prev.filter((p) => p.id !== productId));
  };

  const handleUpdateLocalQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      handleRemoveLocalProduct(productId);
      return;
    }
    setLocalProducts((prev) =>
      prev.map((p) => (p.id === productId ? { ...p, quantity } : p))
    );
  };

  const handleSubmit = () => {
    if (!instagramHandle.trim()) {
      toast.error("Informe o @ do Instagram");
      return;
    }

    if (editingOrder) {
      updateOrder(editingOrder.id, {
        instagramHandle: instagramHandle.startsWith("@")
          ? instagramHandle
          : `@${instagramHandle}`,
        whatsapp: whatsapp || undefined,
        notes: notes || undefined,
        stage,
        products: localProducts,
      });
      toast.success("Pedido atualizado!");
    } else {
      const orderId = addOrder(instagramHandle, whatsapp || undefined);
      if (notes) {
        updateOrder(orderId, { notes });
      }
      localProducts.forEach((product) => {
        addProductToOrder(orderId, product);
      });
      toast.success("Pedido criado!");
    }

    onOpenChange(false);
    resetForm();
  };

  const totalValue = localProducts.reduce(
    (sum, p) => sum + p.price * p.quantity,
    0
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Instagram className="h-5 w-5 text-accent" />
            {editingOrder ? "Editar Pedido" : "Novo Pedido"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4 flex-1 overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="instagram" className="flex items-center gap-2">
                <Instagram className="h-4 w-4" />
                Instagram *
              </Label>
              <Input
                id="instagram"
                placeholder="@usuario"
                value={instagramHandle}
                onChange={(e) => setInstagramHandle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="whatsapp" className="flex items-center gap-2">
                <Phone className="h-4 w-4" />
                WhatsApp
              </Label>
              <Input
                id="whatsapp"
                placeholder="(11) 99999-9999"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
              />
            </div>
          </div>

          {editingOrder && (
            <div className="space-y-2">
              <Label>Etapa do Pedido</Label>
              <Select value={stage} onValueChange={(v) => setStage(v as OrderStage)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAGES.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${s.color}`} />
                        {s.title}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Tabs defaultValue="products" className="w-full">
            <TabsList className="w-full">
              <TabsTrigger value="products" className="flex-1">
                Produtos ({localProducts.length})
              </TabsTrigger>
              <TabsTrigger value="notes" className="flex-1">
                Observações
              </TabsTrigger>
            </TabsList>
            <TabsContent value="products" className="mt-4">
              <ProductSelector
                selectedProducts={localProducts}
                onAddProduct={handleAddLocalProduct}
                onRemoveProduct={handleRemoveLocalProduct}
                onUpdateQuantity={handleUpdateLocalQuantity}
              />

              {localProducts.length > 0 && (
                <div className="mt-4 p-4 bg-secondary/50 rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Resumo do Carrinho</span>
                    <span className="text-lg font-bold text-accent">
                      R$ {totalValue.toFixed(2)}
                    </span>
                  </div>
                  <div className="mt-2 space-y-1">
                    {localProducts.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between text-sm text-muted-foreground"
                      >
                        <span>
                          {p.quantity}x {p.title}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => handleRemoveLocalProduct(p.id)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>
            <TabsContent value="notes" className="mt-4">
              <div className="space-y-2">
                <Label htmlFor="notes" className="flex items-center gap-2">
                  <StickyNote className="h-4 w-4" />
                  Observações
                </Label>
                <Textarea
                  id="notes"
                  placeholder="Anotações sobre o pedido..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                />
              </div>
            </TabsContent>
          </Tabs>

          <div className="flex gap-3 pt-4">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button className="flex-1 btn-accent" onClick={handleSubmit}>
              {editingOrder ? "Salvar Alterações" : "Criar Pedido"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
