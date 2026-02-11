import { useState, useEffect, useRef } from "react";
import { Settings, Store, Users, Save, Plus, Trash2, Receipt, RefreshCw, Loader2, CheckCircle, AlertCircle, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface Props {
  storeId: string;
}

interface SellerRow {
  id: string;
  name: string;
  is_active: boolean;
}

export function POSConfig({ storeId }: Props) {
  const [sellers, setSellers] = useState<SellerRow[]>([]);
  const [showAddSeller, setShowAddSeller] = useState(false);
  const [newSellerName, setNewSellerName] = useState("");
  const [showAddStore, setShowAddStore] = useState(false);
  const [newStore, setNewStore] = useState({ name: "", tiny_token: "", address: "" });
  const [autoEmit, setAutoEmit] = useState(false);
  const [autoEmitMinValue, setAutoEmitMinValue] = useState("");
  const [autoEmitMethods, setAutoEmitMethods] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<{ status: string; products_synced: number; completed_at: string; total_products?: number } | null>(null);
  const [productCount, setProductCount] = useState(0);
  const [syncProgress, setSyncProgress] = useState<{ synced: number; total: number } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // WhatsApp numbers config
  const [allWhatsAppNumbers, setAllWhatsAppNumbers] = useState<{ id: string; label: string; phone_display: string }[]>([]);
  const [linkedNumberIds, setLinkedNumberIds] = useState<Set<string>>(new Set());
  const [savingNumbers, setSavingNumbers] = useState(false);

  useEffect(() => {
    loadSellers();
    loadInvoiceConfig();
    loadSyncInfo();
    loadWhatsAppNumbers();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [storeId]);

  const loadWhatsAppNumbers = async () => {
    const [{ data: allNums }, { data: linked }] = await Promise.all([
      supabase.from('whatsapp_numbers').select('id, label, phone_display').eq('is_active', true),
      supabase.from('pos_store_whatsapp_numbers').select('whatsapp_number_id').eq('store_id', storeId),
    ]);
    setAllWhatsAppNumbers(allNums || []);
    setLinkedNumberIds(new Set((linked || []).map((l: any) => l.whatsapp_number_id)));
  };

  const toggleWhatsAppNumber = (numberId: string) => {
    setLinkedNumberIds(prev => {
      const next = new Set(prev);
      if (next.has(numberId)) next.delete(numberId);
      else next.add(numberId);
      return next;
    });
  };

  const saveWhatsAppNumbers = async () => {
    setSavingNumbers(true);
    try {
      await supabase.from('pos_store_whatsapp_numbers').delete().eq('store_id', storeId);
      const rows = Array.from(linkedNumberIds).map(whatsapp_number_id => ({ store_id: storeId, whatsapp_number_id }));
      if (rows.length > 0) {
        const { error } = await supabase.from('pos_store_whatsapp_numbers').insert(rows);
        if (error) throw error;
      }
      toast.success("Números vinculados salvos!");
    } catch {
      toast.error("Erro ao salvar");
    } finally {
      setSavingNumbers(false);
    }
  };

  const loadSellers = async () => {
    const { data } = await supabase.from('pos_sellers').select('*').eq('store_id', storeId).order('name');
    setSellers(data || []);
  };

  const loadInvoiceConfig = async () => {
    const { data } = await supabase.from('pos_invoice_config').select('*').eq('store_id', storeId).maybeSingle();
    if (data) {
      setAutoEmit(data.auto_emit_on_sale);
      setAutoEmitMinValue(String(data.auto_emit_min_value || 0));
      setAutoEmitMethods((data as any).auto_emit_payment_methods || []);
    }
  };

  const loadSyncInfo = async () => {
    const { data: log } = await supabase
      .from('pos_product_sync_log')
      .select('status, products_synced, completed_at, total_products')
      .eq('store_id', storeId)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setLastSync(log);

    const { count } = await supabase
      .from('pos_products')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId);
    setProductCount(count || 0);
  };

  const addSeller = async () => {
    if (!newSellerName.trim()) return;
    try {
      const { error } = await supabase.from('pos_sellers').insert({ store_id: storeId, name: newSellerName });
      if (error) throw error;
      toast.success("Vendedora adicionada!");
      setNewSellerName("");
      setShowAddSeller(false);
      loadSellers();
    } catch (e) {
      toast.error("Erro ao adicionar");
    }
  };

  const removeSeller = async (id: string) => {
    await supabase.from('pos_sellers').delete().eq('id', id);
    loadSellers();
  };

  const addStore = async () => {
    if (!newStore.name.trim() || !newStore.tiny_token.trim()) {
      toast.error("Nome e token são obrigatórios");
      return;
    }
    try {
      const { error } = await supabase.from('pos_stores').insert(newStore);
      if (error) throw error;
      toast.success("Loja adicionada! Recarregue para vê-la.");
      setNewStore({ name: "", tiny_token: "", address: "" });
      setShowAddStore(false);
    } catch (e) {
      toast.error("Erro ao adicionar loja");
    }
  };

  const saveInvoiceConfig = async () => {
    try {
      const payload = {
        auto_emit_on_sale: autoEmit,
        auto_emit_min_value: parseFloat(autoEmitMinValue) || 0,
        auto_emit_payment_methods: autoEmitMethods,
      };
      const existing = await supabase.from('pos_invoice_config').select('id').eq('store_id', storeId).maybeSingle();
      if (existing.data) {
        await supabase.from('pos_invoice_config').update(payload as any).eq('id', existing.data.id);
      } else {
        await supabase.from('pos_invoice_config').insert({ store_id: storeId, ...payload } as any);
      }
      toast.success("Configuração salva!");
    } catch (e) {
      toast.error("Erro ao salvar");
    }
  };

  const pollSyncProgress = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const { data: log } = await supabase
        .from('pos_product_sync_log')
        .select('status, products_synced, total_products, completed_at')
        .eq('store_id', storeId)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (log) {
        const synced = log.products_synced || 0;
        const total = log.total_products || 0;
        setSyncProgress({ synced, total });

        if (log.status === 'completed' || log.status === 'error') {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setSyncing(false);
          setSyncProgress(null);
          setLastSync(log);
          loadSyncInfo();
          if (log.status === 'completed') {
            toast.success(`Sync concluído! ${synced} produtos sincronizados.`);
          } else {
            toast.error("Erro durante a sincronização");
          }
        }
      }
    }, 3000);
  };

  const syncProducts = async () => {
    setSyncing(true);
    setSyncProgress({ synced: 0, total: 0 });
    toast.info("Sincronizando produtos do Tiny ERP...");
    try {
      // Fire and forget - we'll poll for progress
      fetch(`${SUPABASE_URL}/functions/v1/pos-tiny-sync-products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({ store_id: storeId }),
      });

      // Start polling for progress
      pollSyncProgress();
    } catch (e) {
      toast.error("Erro ao sincronizar");
      setSyncing(false);
      setSyncProgress(null);
    }
  };

  const progressPercent = syncProgress
    ? syncProgress.total > 0
      ? Math.min(100, Math.round((syncProgress.synced / syncProgress.total) * 100))
      : 0
    : 0;

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        <div>
          <h2 className="text-lg font-bold text-pos-white flex items-center gap-2">
            <Settings className="h-5 w-5 text-pos-yellow" /> Configurações
          </h2>
        </div>

        {/* Product Sync */}
        <Card className="bg-pos-white/5 border-pos-yellow/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between text-pos-white">
              <span className="flex items-center gap-2"><RefreshCw className="h-4 w-4 text-pos-yellow" /> Sincronização de Produtos</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-pos-white">Produtos no banco local</p>
                <p className="text-2xl font-bold text-pos-yellow">{productCount}</p>
              </div>
              <Button
                className="bg-pos-yellow text-pos-black hover:bg-pos-yellow-muted font-bold gap-2 h-12 px-6"
                onClick={syncProducts}
                disabled={syncing}
              >
                {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {syncing ? 'Sincronizando...' : 'Sincronizar Agora'}
              </Button>
            </div>

            {/* Progress Bar */}
            {syncing && syncProgress && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-pos-white/70">
                  <span>Progresso da sincronização</span>
                  <span className="font-mono font-bold text-pos-yellow">
                    {syncProgress.total > 0
                      ? `${syncProgress.synced} / ${syncProgress.total} (${progressPercent}%)`
                      : `${syncProgress.synced} produtos...`
                    }
                  </span>
                </div>
                <Progress value={syncProgress.total > 0 ? progressPercent : undefined} className="h-3 bg-pos-white/10" />
                <p className="text-[10px] text-pos-white/40">
                  ⏱ Tempo estimado: ~{syncProgress.total > 0 ? Math.ceil((syncProgress.total - syncProgress.synced) * 0.4 / 60) : '?'} min restante(s)
                </p>
              </div>
            )}

            {!syncing && lastSync && (
              <div className="flex items-center gap-2 text-xs text-pos-white/50">
                {lastSync.status === 'completed' ? (
                  <CheckCircle className="h-3 w-3 text-green-400" />
                ) : lastSync.status === 'error' ? (
                  <AlertCircle className="h-3 w-3 text-red-400" />
                ) : (
                  <Loader2 className="h-3 w-3 animate-spin" />
                )}
                Último sync: {lastSync.completed_at ? new Date(lastSync.completed_at).toLocaleString('pt-BR') : 'em andamento'}
                {lastSync.products_synced > 0 && ` • ${lastSync.products_synced} produtos`}
              </div>
            )}
            <p className="text-[10px] text-pos-white/30">
              Sincroniza todos os produtos do Tiny ERP para o banco local, permitindo busca instantânea no PDV.
            </p>
          </CardContent>
        </Card>

        {/* Stores */}
        <Card className="bg-pos-white/5 border-pos-yellow/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between text-pos-white">
              <span className="flex items-center gap-2"><Store className="h-4 w-4 text-pos-yellow" /> Lojas</span>
              <Button size="sm" className="bg-pos-yellow text-pos-black hover:bg-pos-yellow-muted font-bold gap-1" onClick={() => setShowAddStore(true)}>
                <Plus className="h-3 w-3" /> Nova Loja
              </Button>
            </CardTitle>
          </CardHeader>
        </Card>

        {/* WhatsApp Numbers per Store */}
        <Card className="bg-pos-white/5 border-pos-yellow/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2 text-pos-white">
              <Phone className="h-4 w-4 text-green-400" /> Instâncias WhatsApp
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-pos-white/50">Selecione quais números de WhatsApp esta loja pode utilizar.</p>
            {allWhatsAppNumbers.length === 0 ? (
              <p className="text-xs text-pos-white/40">Nenhum número cadastrado no sistema.</p>
            ) : (
              <div className="space-y-2">
                {allWhatsAppNumbers.map(num => (
                  <div key={num.id} className="flex items-center gap-3 p-2 rounded-lg bg-pos-white/5">
                    <Checkbox
                      id={`wn-${num.id}`}
                      checked={linkedNumberIds.has(num.id)}
                      onCheckedChange={() => toggleWhatsAppNumber(num.id)}
                    />
                    <label htmlFor={`wn-${num.id}`} className="flex-1 cursor-pointer">
                      <span className="text-sm text-pos-white">{num.label}</span>
                      <span className="text-xs text-pos-white/40 ml-2">{num.phone_display}</span>
                    </label>
                  </div>
                ))}
              </div>
            )}
            <Button
              className="bg-pos-yellow text-pos-black hover:bg-pos-yellow-muted font-bold gap-2"
              onClick={saveWhatsAppNumbers}
              disabled={savingNumbers}
            >
              <Save className="h-4 w-4" /> {savingNumbers ? 'Salvando...' : 'Salvar'}
            </Button>
          </CardContent>
        </Card>

        {/* Sellers */}
        <Card className="bg-pos-white/5 border-pos-yellow/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between text-pos-white">
              <span className="flex items-center gap-2"><Users className="h-4 w-4 text-pos-orange" /> Vendedoras</span>
              <Button size="sm" className="bg-pos-orange text-pos-white hover:bg-pos-orange-muted font-bold gap-1" onClick={() => setShowAddSeller(true)}>
                <Plus className="h-3 w-3" /> Adicionar
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {sellers.length === 0 ? (
              <p className="text-xs text-pos-white/40">Nenhuma vendedora cadastrada</p>
            ) : sellers.map(s => (
              <div key={s.id} className="flex items-center justify-between p-2 rounded-lg bg-pos-white/5">
                <span className="text-sm text-pos-white">{s.name}</span>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-red-400 hover:text-red-300" onClick={() => removeSeller(s.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Invoice Config */}
        <Card className="bg-pos-white/5 border-pos-yellow/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2 text-pos-white">
              <Receipt className="h-4 w-4 text-pos-yellow" /> Emissão Automática de NF
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-pos-white">Emitir NFC-e automaticamente</p>
                <p className="text-xs text-pos-white/40">Ao finalizar cada venda</p>
              </div>
              <Switch checked={autoEmit} onCheckedChange={setAutoEmit} />
            </div>
            {autoEmit && (
              <>
                <div>
                  <Label className="text-pos-white/70 text-xs">Valor mínimo para emissão automática</Label>
                  <Input type="number" value={autoEmitMinValue} onChange={e => setAutoEmitMinValue(e.target.value)} placeholder="0,00" className="bg-pos-white/5 border-pos-yellow/30 text-pos-white focus:border-pos-yellow" />
                </div>
                <div>
                  <Label className="text-pos-white/70 text-xs mb-2 block">Formas de pagamento que geram NFC-e</Label>
                  <p className="text-[10px] text-pos-white/40 mb-3">Marque quais formas de pagamento devem emitir nota fiscal automaticamente</p>
                  <div className="space-y-2">
                    {[
                      { key: 'pix', label: 'PIX' },
                      { key: 'credito', label: 'Cartão de Crédito' },
                      { key: 'debito', label: 'Cartão de Débito' },
                      { key: 'dinheiro', label: 'Dinheiro' },
                      { key: 'crediario', label: 'Crediário' },
                      { key: 'transferencia', label: 'Transferência' },
                      { key: 'boleto', label: 'Boleto' },
                    ].map(method => {
                      const isChecked = autoEmitMethods.includes(method.key);
                      return (
                        <div key={method.key} className="flex items-center justify-between p-2 rounded-lg bg-pos-white/5">
                          <span className="text-sm text-pos-white">{method.label}</span>
                          <Switch
                            checked={isChecked}
                            onCheckedChange={(checked) => {
                              setAutoEmitMethods(prev =>
                                checked ? [...prev, method.key] : prev.filter(m => m !== method.key)
                              );
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
            <Button className="bg-pos-yellow text-pos-black hover:bg-pos-yellow-muted font-bold gap-2" onClick={saveInvoiceConfig}>
              <Save className="h-4 w-4" /> Salvar
            </Button>
          </CardContent>
        </Card>

        {/* Add Seller Dialog */}
        <Dialog open={showAddSeller} onOpenChange={setShowAddSeller}>
          <DialogContent className="bg-pos-black border-pos-yellow/30">
            <DialogHeader><DialogTitle className="text-pos-white">Adicionar Vendedora</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <Input value={newSellerName} onChange={e => setNewSellerName(e.target.value)} placeholder="Nome da vendedora" className="bg-pos-white/5 border-pos-yellow/30 text-pos-white focus:border-pos-yellow" />
              <Button className="w-full bg-pos-yellow text-pos-black hover:bg-pos-yellow-muted font-bold" onClick={addSeller}>Adicionar</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Add Store Dialog */}
        <Dialog open={showAddStore} onOpenChange={setShowAddStore}>
          <DialogContent className="bg-pos-black border-pos-yellow/30">
            <DialogHeader><DialogTitle className="text-pos-white">Adicionar Loja</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label className="text-pos-white/70 text-xs">Nome da Loja</Label>
                <Input value={newStore.name} onChange={e => setNewStore(s => ({ ...s, name: e.target.value }))} className="bg-pos-white/5 border-pos-yellow/30 text-pos-white focus:border-pos-yellow" />
              </div>
              <div>
                <Label className="text-pos-white/70 text-xs">Token da API Tiny</Label>
                <Input value={newStore.tiny_token} onChange={e => setNewStore(s => ({ ...s, tiny_token: e.target.value }))} className="bg-pos-white/5 border-pos-yellow/30 text-pos-white focus:border-pos-yellow" />
              </div>
              <div>
                <Label className="text-pos-white/70 text-xs">Endereço (opcional)</Label>
                <Input value={newStore.address} onChange={e => setNewStore(s => ({ ...s, address: e.target.value }))} className="bg-pos-white/5 border-pos-yellow/30 text-pos-white focus:border-pos-yellow" />
              </div>
              <Button className="w-full bg-pos-yellow text-pos-black hover:bg-pos-yellow-muted font-bold" onClick={addStore}>Adicionar Loja</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </ScrollArea>
  );
}
