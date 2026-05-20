import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Receipt, Plus, Trash2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Gateway {
  id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
}

export function POSCrediarioGatewaysManager() {
  const [rows, setRows] = useState<Gateway[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("pos_crediario_gateways")
      .select("id, name, is_active, sort_order")
      .order("sort_order")
      .order("name");
    setLoading(false);
    if (error) { toast.error("Erro: " + error.message); return; }
    setRows((data || []) as Gateway[]);
  };

  useEffect(() => { load(); }, []);

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    const { error } = await supabase
      .from("pos_crediario_gateways")
      .insert({ name, sort_order: rows.length } as any);
    setSaving(false);
    if (error) { toast.error("Erro: " + error.message); return; }
    setNewName("");
    toast.success("Gateway adicionado");
    load();
  };

  const toggle = async (id: string, value: boolean) => {
    const { error } = await supabase
      .from("pos_crediario_gateways")
      .update({ is_active: value } as any)
      .eq("id", id);
    if (error) { toast.error("Erro: " + error.message); return; }
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Remover este gateway? Vendas antigas continuam preservadas.")) return;
    const { error } = await supabase
      .from("pos_crediario_gateways")
      .delete()
      .eq("id", id);
    if (error) { toast.error("Erro: " + error.message); return; }
    load();
  };

  return (
    <Card className="bg-pos-white/5 border-pos-orange/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2 text-pos-white">
          <Receipt className="h-4 w-4 text-pos-orange" /> Gateways de Crediário
        </CardTitle>
        <p className="text-xs text-pos-white/50 mt-1">
          Lista global. Quando o vendedor escolher "Crediário" no PDV, vai selecionar um destes gateways para identificar a origem da venda.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nome do gateway (ex: PagBank, Koin, Provi...)"
            onKeyDown={(e) => e.key === "Enter" && add()}
            className="bg-pos-white/5 border-pos-orange/20 text-pos-white"
          />
          <Button onClick={add} disabled={saving || !newName.trim()} className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted gap-1">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Adicionar
          </Button>
        </div>
        {loading ? (
          <div className="text-pos-white/50 text-sm flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Carregando...</div>
        ) : rows.length === 0 ? (
          <p className="text-pos-white/40 text-sm italic">Nenhum gateway cadastrado.</p>
        ) : (
          <div className="space-y-1">
            {rows.map((g) => (
              <div key={g.id} className="flex items-center justify-between rounded border border-pos-white/10 bg-pos-white/5 p-2">
                <div className="flex items-center gap-3">
                  <Switch checked={g.is_active} onCheckedChange={(v) => toggle(g.id, v)} />
                  <span className={`text-sm ${g.is_active ? "text-pos-white" : "text-pos-white/40 line-through"}`}>{g.name}</span>
                </div>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-pos-white/50 hover:text-red-400" onClick={() => remove(g.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
