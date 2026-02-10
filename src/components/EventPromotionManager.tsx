import { useState, useEffect } from "react";
import { Plus, Trash2, Tag, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { EventPromotion, PromotionTier } from "@/types/database";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface EventPromotionManagerProps {
  eventId: string;
}

export function EventPromotionManager({ eventId }: EventPromotionManagerProps) {
  const [promotions, setPromotions] = useState<EventPromotion[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [productIds, setProductIds] = useState("");
  const [collectionHandle, setCollectionHandle] = useState("");
  const [tiers, setTiers] = useState<PromotionTier[]>([{ quantity: 1, price: 0 }]);

  useEffect(() => {
    loadPromotions();
  }, [eventId]);

  const loadPromotions = async () => {
    const { data, error } = await supabase
      .from('event_promotions')
      .select('*')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error loading promotions:', error);
      return;
    }
    setPromotions((data || []).map(p => ({
      ...p,
      tiers: (p.tiers as unknown as PromotionTier[]) || [],
    })));
  };

  const handleAddTier = () => {
    setTiers(prev => [...prev, { quantity: prev.length + 1, price: 0 }]);
  };

  const handleRemoveTier = (index: number) => {
    setTiers(prev => prev.filter((_, i) => i !== index));
  };

  const handleTierChange = (index: number, field: 'quantity' | 'price', value: number) => {
    setTiers(prev => prev.map((t, i) => i === index ? { ...t, [field]: value } : t));
  };

  const handleSave = async () => {
    if (!name.trim() || tiers.length === 0) {
      toast.error("Preencha o nome e ao menos 1 faixa de preço");
      return;
    }

    const productIdsArray = productIds.trim()
      ? productIds.split(',').map(s => s.trim()).filter(Boolean)
      : null;

    try {
      const { error } = await supabase.from('event_promotions').insert({
        event_id: eventId,
        name: name.trim(),
        shopify_collection_handle: collectionHandle.trim() || null,
        shopify_product_ids: productIdsArray,
        tiers: tiers as any,
      });

      if (error) throw error;
      toast.success('Promoção criada!');
      setDialogOpen(false);
      resetForm();
      loadPromotions();
    } catch (error) {
      console.error('Error creating promotion:', error);
      toast.error('Erro ao criar promoção');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase.from('event_promotions').delete().eq('id', id);
      if (error) throw error;
      setPromotions(prev => prev.filter(p => p.id !== id));
      toast.success('Promoção excluída!');
    } catch (error) {
      console.error('Error deleting promotion:', error);
      toast.error('Erro ao excluir promoção');
    }
  };

  const resetForm = () => {
    setName("");
    setProductIds("");
    setCollectionHandle("");
    setTiers([{ quantity: 1, price: 0 }]);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Tag className="h-4 w-4" />
          Promoções Escalonadas
        </h3>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="h-7 text-xs">
              <Plus className="h-3 w-3 mr-1" />
              Nova Promoção
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nova Promoção Escalonada</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Nome da promoção *</Label>
                <Input
                  placeholder="Ex: Tênis Live Verão"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Coleção Shopify (handle)</Label>
                <Input
                  placeholder="Ex: tenis-esportivos"
                  value={collectionHandle}
                  onChange={(e) => setCollectionHandle(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Opcional: handle da coleção na Shopify
                </p>
              </div>
              <div className="space-y-2">
                <Label>IDs de produtos Shopify</Label>
                <Input
                  placeholder="IDs separados por vírgula"
                  value={productIds}
                  onChange={(e) => setProductIds(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Opcional: IDs de produtos específicos (separados por vírgula)
                </p>
              </div>
              <div className="space-y-2">
                <Label>Faixas de preço</Label>
                {tiers.map((tier, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      type="number"
                      min="1"
                      placeholder="Qtd"
                      value={tier.quantity}
                      onChange={(e) => handleTierChange(i, 'quantity', parseInt(e.target.value) || 1)}
                      className="w-20"
                    />
                    <span className="text-sm text-muted-foreground">
                      {tier.quantity === 1 ? 'par' : 'pares'} por R$
                    </span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Preço"
                      value={tier.price || ''}
                      onChange={(e) => handleTierChange(i, 'price', parseFloat(e.target.value) || 0)}
                      className="w-28"
                    />
                    {tiers.length > 1 && (
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleRemoveTier(i)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={handleAddTier} className="text-xs">
                  <Plus className="h-3 w-3 mr-1" />
                  Adicionar faixa
                </Button>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button className="flex-1 btn-accent" onClick={handleSave}>
                  Criar Promoção
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {promotions.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma promoção configurada</p>
      ) : (
        <div className="space-y-2">
          {promotions.map(promo => (
            <Card key={promo.id} className="p-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-sm">{promo.name}</p>
                  {promo.shopify_collection_handle && (
                    <p className="text-xs text-muted-foreground">
                      <Package className="h-3 w-3 inline mr-1" />
                      Coleção: {promo.shopify_collection_handle}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1 mt-1">
                    {promo.tiers.map((tier, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">
                        {tier.quantity} {tier.quantity === 1 ? 'un' : 'un'} = R$ {tier.price.toFixed(2)}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(promo.id)}>
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
