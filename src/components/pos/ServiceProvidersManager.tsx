import { useState, useEffect } from "react";
import { Truck, Plus, Pencil, Trash2, Loader2, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ServiceProvider, ProviderType, PROVIDER_TYPE_LABEL } from "@/lib/deliveryProviders";

const EMPTY = {
  name: "",
  phone: "",
  document: "",
  provider_type: "mototaxi" as ProviderType,
  notes: "",
  is_active: true,
};

export function ServiceProvidersManager() {
  const [providers, setProviders] = useState<ServiceProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("service_providers" as any).select("*").order("name");
    setProviders((data as any as ServiceProvider[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => { setEditingId(null); setForm({ ...EMPTY }); setShowDialog(true); };
  const openEdit = (p: ServiceProvider) => {
    setEditingId(p.id);
    setForm({
      name: p.name,
      phone: p.phone || "",
      document: p.document || "",
      provider_type: p.provider_type,
      notes: p.notes || "",
      is_active: p.is_active,
    });
    setShowDialog(true);
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error("Informe o nome"); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        document: form.document.trim() || null,
        provider_type: form.provider_type,
        notes: form.notes.trim() || null,
        is_active: form.is_active,
      };
      if (editingId) {
        const { error } = await supabase.from("service_providers" as any).update(payload as any).eq("id", editingId);
        if (error) throw error;
        toast.success("Prestador atualizado!");
      } else {
        const { error } = await supabase.from("service_providers" as any).insert(payload as any);
        if (error) throw error;
        toast.success("Prestador cadastrado!");
      }
      setShowDialog(false);
      load();
    } catch (e: any) {
      toast.error("Erro ao salvar: " + (e.message || ""));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: ServiceProvider) => {
    if (!confirm(`Excluir o prestador "${p.name}"?`)) return;
    const { error } = await supabase.from("service_providers" as any).delete().eq("id", p.id);
    if (error) { toast.error("Não foi possível excluir (pode ter pagamentos vinculados). Desative-o."); return; }
    toast.success("Prestador excluído");
    load();
  };

  return (
    <Card className="bg-pos-white/5 border-pos-orange/20">
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between text-pos-white">
          <span className="flex items-center gap-2"><Truck className="h-4 w-4 text-pos-orange" /> Prestadores de Serviço (Entregas)</span>
          <Button size="sm" className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold gap-1" onClick={openNew}>
            <Plus className="h-4 w-4" /> Novo
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-pos-white/40 mb-2">Mototaxistas e transportadoras usados nas entregas. São universais (valem para todas as lojas e módulos).</p>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-pos-orange" /></div>
        ) : providers.length === 0 ? (
          <p className="text-sm text-pos-white/40 py-4 text-center">Nenhum prestador cadastrado ainda.</p>
        ) : (
          providers.map((p) => (
            <div key={p.id} className="flex items-center gap-3 p-3 rounded-xl bg-pos-white/5 border border-pos-orange/10">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-pos-white text-sm truncate">{p.name}</span>
                  <Badge className="text-[9px] border-0 bg-pos-white/10 text-pos-white/70">{PROVIDER_TYPE_LABEL[p.provider_type]}</Badge>
                  {!p.is_active && <Badge className="text-[9px] border-0 bg-red-500/20 text-red-400">Inativo</Badge>}
                </div>
                {p.phone && <p className="text-[11px] text-pos-white/40 flex items-center gap-1 mt-0.5"><Phone className="h-3 w-3" /> {p.phone}</p>}
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-pos-white/60 hover:text-pos-orange" onClick={() => openEdit(p)}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400 hover:bg-red-500/10" onClick={() => remove(p)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))
        )}
      </CardContent>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="bg-pos-black border-pos-orange/30">
          <DialogHeader>
            <DialogTitle className="text-pos-white flex items-center gap-2">
              <Truck className="h-5 w-5 text-pos-orange" /> {editingId ? "Editar Prestador" : "Novo Prestador"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-pos-white/70 text-xs">Nome *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-pos-white/5 border-pos-orange/30 text-pos-white" placeholder="Ex: João Mototaxi" />
            </div>
            <div>
              <Label className="text-pos-white/70 text-xs">Tipo</Label>
              <Select value={form.provider_type} onValueChange={(v) => setForm({ ...form, provider_type: v as ProviderType })}>
                <SelectTrigger className="bg-pos-white/5 border-pos-orange/30 text-pos-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mototaxi">🏍️ Mototaxista</SelectItem>
                  <SelectItem value="transportadora">🚚 Transportadora</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-pos-white/70 text-xs">Telefone</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="bg-pos-white/5 border-pos-orange/30 text-pos-white" placeholder="(33) 9 9999-9999" />
              </div>
              <div>
                <Label className="text-pos-white/70 text-xs">CPF / CNPJ</Label>
                <Input value={form.document} onChange={(e) => setForm({ ...form, document: e.target.value })} className="bg-pos-white/5 border-pos-orange/30 text-pos-white" />
              </div>
            </div>
            <div>
              <Label className="text-pos-white/70 text-xs">Observações</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="bg-pos-white/5 border-pos-orange/30 text-pos-white" placeholder="Dados pessoais, chave PIX, etc." />
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-pos-white/5 border border-pos-orange/10">
              <Label className="text-pos-white/70 text-xs">Ativo</Label>
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
            </div>
            <Button className="w-full bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold h-11" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
