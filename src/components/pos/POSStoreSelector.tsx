import { Store, ChevronRight, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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

  return (
    <div className="min-h-screen bg-pos-black flex flex-col">
      <header className="sticky top-0 z-50 w-full border-b border-pos-yellow/20 bg-pos-black/95 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-pos-yellow text-pos-black">
              <Store className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-pos-white">Frente de Caixa</h1>
              <p className="text-xs text-pos-yellow-muted">Selecione a loja</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-1 text-pos-white hover:text-pos-yellow hover:bg-pos-yellow/10">
            <Home className="h-4 w-4" /> Início
          </Button>
        </div>
      </header>

      <main className="flex-1 container py-10 flex items-center justify-center">
        <div className="w-full max-w-lg space-y-4">
          <div className="text-center mb-8">
            <Store className="h-12 w-12 mx-auto text-pos-yellow mb-3" />
            <h2 className="text-2xl font-bold text-pos-white">Qual loja você está?</h2>
            <p className="text-pos-white/60 mt-1">Selecione para conectar ao Tiny ERP correto</p>
          </div>
          {loading ? (
            <div className="text-center text-pos-white/50 py-8">Carregando lojas...</div>
          ) : stores.length === 0 ? (
            <div className="text-center text-pos-white/50 py-8">
              <p>Nenhuma loja cadastrada.</p>
              <p className="text-xs mt-2">Cadastre lojas na aba Configurações.</p>
            </div>
          ) : (
            stores.map(store => (
              <div
                key={store.id}
                className="cursor-pointer rounded-xl border-2 border-pos-yellow/30 bg-pos-black hover:border-pos-yellow hover:shadow-[0_0_20px_hsl(48_100%_50%/0.15)] transition-all group p-6 flex items-center justify-between"
                onClick={() => onSelect(store.id)}
              >
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-pos-yellow/10 text-pos-yellow group-hover:bg-pos-yellow group-hover:text-pos-black transition-all group-hover:scale-110">
                    <Store className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg text-pos-white">{store.name}</h3>
                    {store.address && <p className="text-sm text-pos-white/50">{store.address}</p>}
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-pos-white/40 group-hover:text-pos-yellow transition-colors" />
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
