import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { User, Star, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const AGE_RANGES = ["18-24", "25-34", "35-44", "45-54", "55+"];
const STYLES = ["Casual", "Esportivo", "Clássico", "Streetwear", "Romântico", "Minimalista", "Boho", "Fashion"];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (customer: { id: string; name: string; cpf?: string }) => void;
}

export function POSCustomerForm({ open, onOpenChange, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "", email: "", whatsapp: "", cpf: "",
    cep: "", address: "", address_number: "", complement: "",
    neighborhood: "", city: "", state: "",
    age_range: "", preferred_style: "", notes: "",
  });

  const update = (field: string, value: string) => setForm(f => ({ ...f, [field]: value }));

  // Calculate completeness for gamification
  const fields = Object.values(form);
  const filled = fields.filter(v => v.trim()).length;
  const completeness = Math.round((filled / fields.length) * 100);

  const handleCepLookup = async () => {
    if (form.cep.length < 8) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${form.cep.replace(/\D/g, '')}/json/`);
      const data = await res.json();
      if (!data.erro) {
        setForm(f => ({
          ...f,
          address: data.logradouro || f.address,
          neighborhood: data.bairro || f.neighborhood,
          city: data.localidade || f.city,
          state: data.uf || f.state,
        }));
      }
    } catch { /* ignore */ }
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('pos_customers')
        .insert({
          name: form.name,
          email: form.email || null,
          whatsapp: form.whatsapp || null,
          cpf: form.cpf || null,
          cep: form.cep || null,
          address: form.address || null,
          address_number: form.address_number || null,
          complement: form.complement || null,
          neighborhood: form.neighborhood || null,
          city: form.city || null,
          state: form.state || null,
          age_range: form.age_range || null,
          preferred_style: form.preferred_style || null,
          notes: form.notes || null,
        })
        .select()
        .single();

      if (error) throw error;
      toast.success("Cliente cadastrado!");
      onSaved({ id: data.id, name: data.name || '', cpf: data.cpf || undefined });
      setForm({ name: "", email: "", whatsapp: "", cpf: "", cep: "", address: "", address_number: "", complement: "", neighborhood: "", city: "", state: "", age_range: "", preferred_style: "", notes: "" });
    } catch (e: any) {
      console.error(e);
      toast.error("Erro ao salvar cliente");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] bg-pos-black border-pos-yellow/30 p-0 gap-0">
        <DialogHeader className="p-4 border-b border-pos-yellow/20">
          <DialogTitle className="flex items-center justify-between text-pos-white">
            <div className="flex items-center gap-2">
              <User className="h-5 w-5 text-pos-yellow" />
              Cadastro de Cliente
            </div>
            <div className="flex items-center gap-2">
              <Star className="h-4 w-4 text-pos-yellow" />
              <span className="text-sm font-normal text-pos-yellow">{completeness}% completo</span>
              <div className="w-20 h-2 rounded-full bg-pos-white/10">
                <div className="h-full rounded-full bg-pos-yellow transition-all" style={{ width: `${completeness}%` }} />
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(90vh-120px)]">
          <div className="p-4 space-y-4">
            {/* Personal Info */}
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-pos-orange uppercase tracking-wider">Dados Pessoais</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label className="text-pos-white/70 text-xs">Nome *</Label>
                  <Input value={form.name} onChange={e => update('name', e.target.value)} placeholder="Nome completo" className="bg-pos-white/5 border-pos-yellow/30 text-pos-white placeholder:text-pos-white/30 focus:border-pos-yellow" />
                </div>
                <div>
                  <Label className="text-pos-white/70 text-xs">CPF</Label>
                  <Input value={form.cpf} onChange={e => update('cpf', e.target.value)} placeholder="000.000.000-00" className="bg-pos-white/5 border-pos-yellow/30 text-pos-white placeholder:text-pos-white/30 focus:border-pos-yellow" />
                </div>
                <div>
                  <Label className="text-pos-white/70 text-xs">WhatsApp</Label>
                  <Input value={form.whatsapp} onChange={e => update('whatsapp', e.target.value)} placeholder="(11) 99999-9999" className="bg-pos-white/5 border-pos-yellow/30 text-pos-white placeholder:text-pos-white/30 focus:border-pos-yellow" />
                </div>
                <div className="col-span-2">
                  <Label className="text-pos-white/70 text-xs">E-mail</Label>
                  <Input value={form.email} onChange={e => update('email', e.target.value)} placeholder="email@exemplo.com" className="bg-pos-white/5 border-pos-yellow/30 text-pos-white placeholder:text-pos-white/30 focus:border-pos-yellow" />
                </div>
              </div>
            </div>

            {/* Address */}
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-pos-orange uppercase tracking-wider">Endereço</h3>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-pos-white/70 text-xs">CEP</Label>
                  <Input value={form.cep} onChange={e => update('cep', e.target.value)} onBlur={handleCepLookup} placeholder="00000-000" className="bg-pos-white/5 border-pos-yellow/30 text-pos-white placeholder:text-pos-white/30 focus:border-pos-yellow" />
                </div>
                <div className="col-span-2">
                  <Label className="text-pos-white/70 text-xs">Rua</Label>
                  <Input value={form.address} onChange={e => update('address', e.target.value)} className="bg-pos-white/5 border-pos-yellow/30 text-pos-white placeholder:text-pos-white/30 focus:border-pos-yellow" />
                </div>
                <div>
                  <Label className="text-pos-white/70 text-xs">Número</Label>
                  <Input value={form.address_number} onChange={e => update('address_number', e.target.value)} className="bg-pos-white/5 border-pos-yellow/30 text-pos-white placeholder:text-pos-white/30 focus:border-pos-yellow" />
                </div>
                <div>
                  <Label className="text-pos-white/70 text-xs">Complemento</Label>
                  <Input value={form.complement} onChange={e => update('complement', e.target.value)} className="bg-pos-white/5 border-pos-yellow/30 text-pos-white placeholder:text-pos-white/30 focus:border-pos-yellow" />
                </div>
                <div>
                  <Label className="text-pos-white/70 text-xs">Bairro</Label>
                  <Input value={form.neighborhood} onChange={e => update('neighborhood', e.target.value)} className="bg-pos-white/5 border-pos-yellow/30 text-pos-white placeholder:text-pos-white/30 focus:border-pos-yellow" />
                </div>
                <div>
                  <Label className="text-pos-white/70 text-xs">Cidade</Label>
                  <Input value={form.city} onChange={e => update('city', e.target.value)} className="bg-pos-white/5 border-pos-yellow/30 text-pos-white placeholder:text-pos-white/30 focus:border-pos-yellow" />
                </div>
                <div>
                  <Label className="text-pos-white/70 text-xs">Estado</Label>
                  <Input value={form.state} onChange={e => update('state', e.target.value)} placeholder="SP" className="bg-pos-white/5 border-pos-yellow/30 text-pos-white placeholder:text-pos-white/30 focus:border-pos-yellow" />
                </div>
              </div>
            </div>

            {/* Preferences */}
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-pos-orange uppercase tracking-wider">Preferências (CRM)</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-pos-white/70 text-xs">Faixa de Idade</Label>
                  <Select value={form.age_range} onValueChange={v => update('age_range', v)}>
                    <SelectTrigger className="bg-pos-white/5 border-pos-yellow/30 text-pos-white"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {AGE_RANGES.map(r => <SelectItem key={r} value={r}>{r} anos</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-pos-white/70 text-xs">Estilo que Gosta</Label>
                  <Select value={form.preferred_style} onValueChange={v => update('preferred_style', v)}>
                    <SelectTrigger className="bg-pos-white/5 border-pos-yellow/30 text-pos-white"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {STYLES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-pos-white/70 text-xs">Observações</Label>
                <Textarea value={form.notes} onChange={e => update('notes', e.target.value)} placeholder="Preferências, alergias, etc..." className="bg-pos-white/5 border-pos-yellow/30 text-pos-white placeholder:text-pos-white/30 focus:border-pos-yellow min-h-[60px]" />
              </div>
            </div>

            {/* Gamification hint */}
            <div className="rounded-xl bg-pos-yellow/5 border border-pos-yellow/20 p-3 flex items-center gap-3">
              <Star className="h-5 w-5 text-pos-yellow flex-shrink-0" />
              <div className="text-xs text-pos-white/70">
                <span className="font-bold text-pos-yellow">+{Math.floor(completeness / 10)} pts</span> — Quanto mais dados preencher, mais pontos você ganha na gamificação!
              </div>
            </div>
          </div>
        </ScrollArea>

        <div className="p-4 border-t border-pos-yellow/20 flex items-center justify-end gap-2">
          <Button variant="ghost" className="text-pos-white/70 hover:text-pos-yellow" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold gap-2" onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4" /> {saving ? 'Salvando...' : 'Salvar Cliente'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
