import { Store, ChevronRight, Home, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface POSStore {
  id: string;
  name: string;
  address?: string;
}

interface Props {
  onSelect: (storeId: string) => void;
}

export function POSStoreSelector({ onSelect }: Props) {
  const navigate = useNavigate();
  const [stores, setStores] = useState<POSStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddStore, setShowAddStore] = useState(false);
  const [newStore, setNewStore] = useState({ name: "", tiny_token: "", address: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadStores();
  }, []);

  const loadStores = async () => {
    try {
      const { data, error } = await supabase
        .from('pos_stores')
        .select('id, name, address')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      setStores(data || []);
    } catch (e) {
      console.error(e);
      toast.error('Erro ao carregar lojas');
    } finally {
      setLoading(false);
    }
  };

  const addStore = async () => {
    if (!newStore.name.trim() || !newStore.tiny_token.trim()) {
      toast.error("Nome e Token do Tiny são obrigatórios");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('pos_stores').insert(newStore);
      if (error) throw error;
      toast.success("Loja adicionada!");
      setNewStore({ name: "", tiny_token: "", address: "" });
      setShowAddStore(false);
      loadStores();
    } catch (e) {
      toast.error("Erro ao adicionar loja");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-pos-black flex flex-col">
      <header className="sticky top-0 z-50 w-full border-b border-pos-orange/20 bg-pos-black/95 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-pos-orange text-pos-black">
              <Store className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-pos-white">Frente de Caixa</h1>
              <p className="text-xs text-pos-orange-muted">Selecione a loja</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-1 text-pos-white hover:text-pos-orange hover:bg-pos-orange/10">
            <Home className="h-4 w-4" /> Início
          </Button>
        </div>
      </header>

      <main className="flex-1 container py-10 flex items-center justify-center">
        <div className="w-full max-w-lg space-y-4">
          <div className="text-center mb-8">
            <Store className="h-12 w-12 mx-auto text-pos-orange mb-3" />
            <h2 className="text-2xl font-bold text-pos-white">Qual loja você está?</h2>
            <p className="text-pos-white/60 mt-1">Selecione para conectar ao Tiny ERP correto</p>
          </div>
          {loading ? (
            <div className="text-center text-pos-white/50 py-8">Carregando lojas...</div>
          ) : stores.length === 0 ? (
            <div className="text-center text-pos-white/50 py-8">
              <p>Nenhuma loja cadastrada.</p>
              <p className="text-xs mt-2 mb-4">Adicione sua primeira loja para começar.</p>
              <Button className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold gap-2" onClick={() => setShowAddStore(true)}>
                <Plus className="h-4 w-4" /> Adicionar Loja
              </Button>
            </div>
          ) : (
            <>
              {stores.map(store => (
                <div
                  key={store.id}
                  className="cursor-pointer rounded-xl border-2 border-pos-orange/30 bg-pos-black hover:border-pos-orange hover:shadow-[0_0_20px_hsl(25_100%_50%/0.15)] transition-all group p-6 flex items-center justify-between"
                  onClick={() => onSelect(store.id)}
                >
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-pos-orange/10 text-pos-orange group-hover:bg-pos-orange group-hover:text-pos-black transition-all group-hover:scale-110">
                      <Store className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg text-pos-white">{store.name}</h3>
                      {store.address && <p className="text-sm text-pos-white/50">{store.address}</p>}
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-pos-white/40 group-hover:text-pos-orange transition-colors" />
                </div>
              ))}
              <div className="text-center pt-4">
                <Button variant="outline" className="gap-2 border-pos-orange/30 text-pos-orange hover:bg-pos-orange/10" onClick={() => setShowAddStore(true)}>
                  <Plus className="h-4 w-4" /> Adicionar outra loja
                </Button>
              </div>
            </>
          )}
        </div>
      </main>

      {/* Add Store Dialog */}
      <Dialog open={showAddStore} onOpenChange={setShowAddStore}>
        <DialogContent className="bg-pos-black border-pos-orange/30">
          <DialogHeader><DialogTitle className="text-pos-white">Adicionar Loja</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-pos-white/70 text-xs">Nome da Loja *</Label>
              <Input value={newStore.name} onChange={e => setNewStore(s => ({ ...s, name: e.target.value }))} placeholder="Ex: Loja Centro" className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
            </div>
            <div>
              <Label className="text-pos-white/70 text-xs">Token da API Tiny *</Label>
              <Input value={newStore.tiny_token} onChange={e => setNewStore(s => ({ ...s, tiny_token: e.target.value }))} placeholder="Cole o token do Tiny ERP aqui" className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange font-mono text-xs" />
              <p className="text-[10px] text-pos-white/30 mt-1">Encontre em Tiny ERP → Configurações → Tokens de API</p>
            </div>
            <div>
              <Label className="text-pos-white/70 text-xs">Endereço (opcional)</Label>
              <Input value={newStore.address} onChange={e => setNewStore(s => ({ ...s, address: e.target.value }))} placeholder="Rua, número, cidade" className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
            </div>
            <Button className="w-full bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold" onClick={addStore} disabled={saving}>
              {saving ? "Salvando..." : "Adicionar Loja"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
