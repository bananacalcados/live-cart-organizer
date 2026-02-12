import { useState, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
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
const GENDERS = ["Feminino", "Masculino", "Outro", "Prefiro não informar"];
const SHOE_SIZES = ["33", "34", "35", "36", "37", "38", "39", "40", "41", "42", "43", "44"];
const CHILDREN_AGE_RANGES = ["0-2 anos", "3-5 anos", "6-10 anos", "11-14 anos", "15-17 anos"];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (customer: { id: string; name: string; cpf?: string }) => void;
  existingCustomer?: { id: string; name?: string; email?: string; whatsapp?: string; cpf?: string; cep?: string; address?: string; address_number?: string; complement?: string; neighborhood?: string; city?: string; state?: string; age_range?: string; preferred_style?: string; shoe_size?: string; gender?: string } | null;
}

export function POSCustomerForm({ open, onOpenChange, onSaved, existingCustomer }: Props) {
  const [saving, setSaving] = useState(false);
  const initForm = () => ({
    name: existingCustomer?.name || "", email: existingCustomer?.email || "", whatsapp: existingCustomer?.whatsapp || "", cpf: existingCustomer?.cpf || "",
    cep: existingCustomer?.cep || "", address: existingCustomer?.address || "", address_number: existingCustomer?.address_number || "", complement: existingCustomer?.complement || "",
    neighborhood: existingCustomer?.neighborhood || "", city: existingCustomer?.city || "", state: existingCustomer?.state || "",
    age_range: existingCustomer?.age_range || "", preferred_style: existingCustomer?.preferred_style || "", notes: "",
    shoe_size: existingCustomer?.shoe_size || "", gender: existingCustomer?.gender || "", has_children: false, children_age_range: "",
  });
  const [form, setForm] = useState(initForm);

  // Reset form when existingCustomer changes
  useEffect(() => {
    if (open) setForm(initForm());
  }, [open, existingCustomer?.id]);

  const update = (field: string, value: string | boolean) => setForm(f => ({ ...f, [field]: value }));

  // Calculate completeness for gamification
  const stringFields = [form.name, form.email, form.whatsapp, form.cpf, form.cep, form.address, form.address_number, form.complement, form.neighborhood, form.city, form.state, form.age_range, form.preferred_style, form.notes, form.shoe_size, form.gender, form.children_age_range];
  const filled = stringFields.filter(v => v.trim()).length + (form.has_children ? 1 : 0);
  const completeness = Math.round((filled / (stringFields.length + 1)) * 100);

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
      const payload = {
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
          shoe_size: form.shoe_size || null,
          gender: form.gender || null,
          has_children: form.has_children,
          children_age_range: form.children_age_range || null,
        } as any;

      let data: any;
      if (existingCustomer?.id) {
        const { data: updated, error } = await supabase
          .from('pos_customers')
          .update(payload)
          .eq('id', existingCustomer.id)
          .select()
          .single();
        if (error) throw error;
        data = updated;
        toast.success("Cadastro atualizado! +pontos de gamificação 🎯");
      } else {
        const { data: inserted, error } = await supabase
          .from('pos_customers')
          .insert(payload)
          .select()
          .single();
        if (error) throw error;
        data = inserted;
        toast.success("Cliente cadastrado!");
      }
      onSaved({ id: data.id, name: data.name || '', cpf: data.cpf || undefined });
      setForm({ name: "", email: "", whatsapp: "", cpf: "", cep: "", address: "", address_number: "", complement: "", neighborhood: "", city: "", state: "", age_range: "", preferred_style: "", notes: "", shoe_size: "", gender: "", has_children: false, children_age_range: "" });
    } catch (e: any) {
      console.error(e);
      toast.error("Erro ao salvar cliente");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] bg-pos-black border-pos-orange/30 p-0 gap-0">
        <DialogHeader className="p-4 border-b border-pos-orange/20">
          <DialogTitle className="flex items-center justify-between text-pos-white">
            <div className="flex items-center gap-2">
              <User className="h-5 w-5 text-pos-orange" />
              Cadastro de Cliente
            </div>
            <div className="flex items-center gap-2">
              <Star className="h-4 w-4 text-pos-orange" />
              <span className="text-sm font-normal text-pos-orange">{completeness}% completo</span>
              <div className="w-20 h-2 rounded-full bg-pos-white/10">
                <div className="h-full rounded-full bg-pos-orange transition-all" style={{ width: `${completeness}%` }} />
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
                  <Input value={form.name} onChange={e => update('name', e.target.value)} placeholder="Nome completo" className="bg-pos-white/5 border-pos-orange/30 text-pos-white placeholder:text-pos-white/30 focus:border-pos-orange" />
                </div>
                <div>
                  <Label className="text-pos-white/70 text-xs">CPF</Label>
                  <Input value={form.cpf} onChange={e => update('cpf', e.target.value)} placeholder="000.000.000-00" className="bg-pos-white/5 border-pos-orange/30 text-pos-white placeholder:text-pos-white/30 focus:border-pos-orange" />
                </div>
                <div>
                  <Label className="text-pos-white/70 text-xs">WhatsApp</Label>
                  <Input value={form.whatsapp} onChange={e => update('whatsapp', e.target.value)} placeholder="(11) 99999-9999" className="bg-pos-white/5 border-pos-orange/30 text-pos-white placeholder:text-pos-white/30 focus:border-pos-orange" />
                </div>
                <div className="col-span-2">
                  <Label className="text-pos-white/70 text-xs">E-mail</Label>
                  <Input value={form.email} onChange={e => update('email', e.target.value)} placeholder="email@exemplo.com" className="bg-pos-white/5 border-pos-orange/30 text-pos-white placeholder:text-pos-white/30 focus:border-pos-orange" />
                </div>
              </div>
            </div>

            {/* Address */}
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-pos-orange uppercase tracking-wider">Endereço</h3>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-pos-white/70 text-xs">CEP</Label>
                  <Input value={form.cep} onChange={e => update('cep', e.target.value)} onBlur={handleCepLookup} placeholder="00000-000" className="bg-pos-white/5 border-pos-orange/30 text-pos-white placeholder:text-pos-white/30 focus:border-pos-orange" />
                </div>
                <div className="col-span-2">
                  <Label className="text-pos-white/70 text-xs">Rua</Label>
                  <Input value={form.address} onChange={e => update('address', e.target.value)} className="bg-pos-white/5 border-pos-orange/30 text-pos-white placeholder:text-pos-white/30 focus:border-pos-orange" />
                </div>
                <div>
                  <Label className="text-pos-white/70 text-xs">Número</Label>
                  <Input value={form.address_number} onChange={e => update('address_number', e.target.value)} className="bg-pos-white/5 border-pos-orange/30 text-pos-white placeholder:text-pos-white/30 focus:border-pos-orange" />
                </div>
                <div>
                  <Label className="text-pos-white/70 text-xs">Complemento</Label>
                  <Input value={form.complement} onChange={e => update('complement', e.target.value)} className="bg-pos-white/5 border-pos-orange/30 text-pos-white placeholder:text-pos-white/30 focus:border-pos-orange" />
                </div>
                <div>
                  <Label className="text-pos-white/70 text-xs">Bairro</Label>
                  <Input value={form.neighborhood} onChange={e => update('neighborhood', e.target.value)} className="bg-pos-white/5 border-pos-orange/30 text-pos-white placeholder:text-pos-white/30 focus:border-pos-orange" />
                </div>
                <div>
                  <Label className="text-pos-white/70 text-xs">Cidade</Label>
                  <Input value={form.city} onChange={e => update('city', e.target.value)} className="bg-pos-white/5 border-pos-orange/30 text-pos-white placeholder:text-pos-white/30 focus:border-pos-orange" />
                </div>
                <div>
                  <Label className="text-pos-white/70 text-xs">Estado</Label>
                  <Input value={form.state} onChange={e => update('state', e.target.value)} placeholder="SP" className="bg-pos-white/5 border-pos-orange/30 text-pos-white placeholder:text-pos-white/30 focus:border-pos-orange" />
                </div>
              </div>
            </div>

            {/* Preferences */}
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-pos-orange uppercase tracking-wider">Preferências (CRM)</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-pos-white/70 text-xs">Sexo</Label>
                  <Select value={form.gender} onValueChange={v => update('gender', v)}>
                    <SelectTrigger className="bg-pos-white/5 border-pos-orange/30 text-pos-white"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {GENDERS.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-pos-white/70 text-xs">Faixa de Idade</Label>
                  <Select value={form.age_range} onValueChange={v => update('age_range', v)}>
                    <SelectTrigger className="bg-pos-white/5 border-pos-orange/30 text-pos-white"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {AGE_RANGES.map(r => <SelectItem key={r} value={r}>{r} anos</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-pos-white/70 text-xs">Tamanho (Calçado)</Label>
                  <Select value={form.shoe_size} onValueChange={v => update('shoe_size', v)}>
                    <SelectTrigger className="bg-pos-white/5 border-pos-orange/30 text-pos-white"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {SHOE_SIZES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-pos-white/70 text-xs">Estilo que Gosta</Label>
                  <Select value={form.preferred_style} onValueChange={v => update('preferred_style', v)}>
                    <SelectTrigger className="bg-pos-white/5 border-pos-orange/30 text-pos-white"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {STYLES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 items-end">
                <div className="flex items-center gap-3 py-2">
                  <Switch checked={form.has_children} onCheckedChange={v => update('has_children', v)} />
                  <Label className="text-pos-white/70 text-xs">Possui filhos?</Label>
                </div>
                {form.has_children && (
                  <div>
                    <Label className="text-pos-white/70 text-xs">Faixa Etária dos Filhos</Label>
                    <Select value={form.children_age_range} onValueChange={v => update('children_age_range', v)}>
                      <SelectTrigger className="bg-pos-white/5 border-pos-orange/30 text-pos-white"><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {CHILDREN_AGE_RANGES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <div>
                <Label className="text-pos-white/70 text-xs">Observações</Label>
                <Textarea value={form.notes} onChange={e => update('notes', e.target.value)} placeholder="Preferências, alergias, etc..." className="bg-pos-white/5 border-pos-orange/30 text-pos-white placeholder:text-pos-white/30 focus:border-pos-orange min-h-[60px]" />
              </div>
            </div>

            {/* Gamification hint */}
            <div className="rounded-xl bg-pos-orange/5 border border-pos-orange/20 p-3 flex items-center gap-3">
              <Star className="h-5 w-5 text-pos-orange flex-shrink-0" />
              <div className="text-xs text-pos-white/70">
                <span className="font-bold text-pos-orange">+{Math.floor(completeness / 10)} pts</span> — Quanto mais dados preencher, mais pontos você ganha na gamificação!
              </div>
            </div>
          </div>
        </ScrollArea>

        <div className="p-4 border-t border-pos-orange/20 flex items-center justify-end gap-2">
          <Button variant="ghost" className="text-pos-white/70 hover:text-pos-orange" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold gap-2" onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4" /> {saving ? 'Salvando...' : 'Salvar Cliente'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
