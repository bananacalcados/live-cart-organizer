import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, Package, CheckCircle2, AlertTriangle } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  sku: string;
  productName: string;
  variantName?: string;
  stockData?: Array<{ storeName: string; depositName: string; storeId: string; stock: number; reserved: number }>;
  onCorrected?: () => void;
}

interface StoreOption {
  id: string;
  name: string;
  currentStock?: number;
}

export function StockCorrectionDialog({ open, onClose, sku, productName, variantName, stockData, onCorrected }: Props) {
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selectedStore, setSelectedStore] = useState('');
  const [newQuantity, setNewQuantity] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setNewQuantity('');
    setSelectedStore('');

    const load = async () => {
      setLoading(true);
      const { data: storesData } = await supabase
        .from('pos_stores')
        .select('id, name')
        .eq('is_active', true)
        .order('name');

      const storeOptions: StoreOption[] = (storesData || []).map((s: any) => {
        const stockInfo = stockData?.find(sd => sd.storeId === s.id);
        return { id: s.id, name: s.name, currentStock: stockInfo?.stock };
      });

      setStores(storeOptions);
      setLoading(false);
    };
    load();
  }, [open, sku, stockData]);

  const selectedStoreInfo = stores.find(s => s.id === selectedStore);

  const handleCorrect = async () => {
    if (!selectedStore || newQuantity === '') {
      toast.error('Selecione a loja e informe a quantidade');
      return;
    }

    const qty = parseInt(newQuantity, 10);
    if (isNaN(qty) || qty < 0) {
      toast.error('Quantidade inválida');
      return;
    }

    setSaving(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('expedition-correct-stock', {
        body: { sku, store_id: selectedStore, new_quantity: qty },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erro desconhecido');

      setResult({
        success: true,
        message: `Estoque de "${selectedStoreInfo?.name}" corrigido: ${data.previous_stock} → ${qty}`,
      });
      toast.success('Balanço realizado com sucesso!');
      onCorrected?.();
    } catch (err: any) {
      setResult({ success: false, message: err.message });
      toast.error('Erro ao corrigir: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Corrigir Estoque (Balanço)
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Product info */}
          <Card>
            <CardContent className="p-3">
              <p className="font-medium text-foreground">{productName}</p>
              {variantName && <p className="text-sm text-muted-foreground">{variantName}</p>}
              <p className="text-xs font-mono text-muted-foreground">SKU: {sku}</p>
            </CardContent>
          </Card>

          {/* Current stock per store */}
          {stockData && stockData.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">Estoque atual por loja:</p>
              <div className="flex flex-wrap gap-1.5">
                {stockData.map((s, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded font-medium ${
                      s.stock > 0
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : s.stock < 0
                        ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    <Package className="h-3 w-3" />
                    {s.depositName || s.storeName}: {s.stock}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Store selector */}
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Loja para corrigir:</label>
                <Select value={selectedStore} onValueChange={(v) => { setSelectedStore(v); setResult(null); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a loja..." />
                  </SelectTrigger>
                  <SelectContent>
                    {stores.map(s => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} {s.currentStock !== undefined ? `(atual: ${s.currentStock})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedStore && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    Quantidade do Balanço:
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Informe a quantidade real que existe fisicamente na loja. O sistema irá ajustar o estoque no Tiny.
                  </p>
                  <Input
                    type="number"
                    min="0"
                    placeholder="Ex: 5"
                    value={newQuantity}
                    onChange={(e) => { setNewQuantity(e.target.value); setResult(null); }}
                    className="text-lg font-mono"
                    autoFocus
                  />
                </div>
              )}
            </>
          )}

          {/* Result feedback */}
          {result && (
            <Card className={`border ${result.success ? 'border-green-300 bg-green-50 dark:bg-green-900/20' : 'border-red-300 bg-red-50 dark:bg-red-900/20'}`}>
              <CardContent className="p-3 flex items-start gap-2">
                {result.success ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                )}
                <p className={`text-sm ${result.success ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                  {result.message}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Action button */}
          <Button
            onClick={handleCorrect}
            disabled={saving || !selectedStore || newQuantity === ''}
            className="w-full gap-2"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
            Realizar Balanço
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
