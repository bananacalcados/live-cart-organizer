import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { propagateCustomerEdit, CustomerEditValues } from "@/lib/posCustomerEdit";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** id do registro em customers_unified */
  unifiedId: string | null;
  onSaved?: () => void;
}

const EMPTY: CustomerEditValues = {
  name: "", cpf: "", email: "", whatsapp: "", birth_date: "", gender: "",
  age_range: "", shoe_size: "", preferred_style: "", cep: "", address: "",
  address_number: "", complement: "", neighborhood: "", city: "", state: "",
};

export function EditCustomerDialog({ open, onOpenChange, unifiedId, onSaved }: Props) {
  const [form, setForm] = useState<CustomerEditValues>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !unifiedId) return;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("customers_unified")
          .select(
            "name, cpf, email, phone_e164, birth_date, gender, age_range, shoe_size, preferred_style, cep, address, address_number, complement, neighborhood, city, state",
          )
          .eq("id", unifiedId)
          .maybeSingle();
        if (error) throw error;
        const d = (data || {}) as any;
        setForm({
          name: d.name || "",
          cpf: d.cpf || "",
          email: d.email || "",
          whatsapp: d.phone_e164 || "",
          birth_date: d.birth_date || "",
          gender: d.gender || "",
          age_range: d.age_range || "",
          shoe_size: d.shoe_size || "",
          preferred_style: d.preferred_style || "",
          cep: d.cep || "",
          address: d.address || "",
          address_number: d.address_number || "",
          complement: d.complement || "",
          neighborhood: d.neighborhood || "",
          city: d.city || "",
          state: d.state || "",
        });
      } catch (e: any) {
        toast.error("Erro ao carregar cliente: " + e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, unifiedId]);

  const set = (k: keyof CustomerEditValues) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const handleSave = async () => {
    if (!unifiedId) return;
    if (!form.name.trim()) {
      toast.error("Informe o nome do cliente");
      return;
    }
    setSaving(true);
    try {
      const res = await propagateCustomerEdit(unifiedId, form);
      toast.success(
        `Cliente atualizado · base ${res.unified ? "✓" : "—"} · PDV ${res.pos} · Marketing ${res.zoppy}`,
      );
      onSaved?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Erro ao salvar: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar dados do cliente</DialogTitle>
          <DialogDescription>
            As alterações são aplicadas na base unificada, no PDV e no Marketing.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 py-2">
            <div className="md:col-span-2">
              <Label>Nome completo</Label>
              <Input value={form.name} onChange={set("name")} />
            </div>
            <div>
              <Label>CPF</Label>
              <Input value={form.cpf} onChange={set("cpf")} />
            </div>
            <div>
              <Label>WhatsApp / Telefone</Label>
              <Input value={form.whatsapp} onChange={set("whatsapp")} placeholder="(33) 99999-9999" />
            </div>
            <div className="md:col-span-2">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={set("email")} />
            </div>
            <div>
              <Label>Data de nascimento</Label>
              <Input type="date" value={form.birth_date} onChange={set("birth_date")} />
            </div>
            <div>
              <Label>Faixa etária</Label>
              <Input value={form.age_range} onChange={set("age_range")} placeholder="ex.: 25-34" />
            </div>
            <div>
              <Label>Gênero</Label>
              <Input value={form.gender} onChange={set("gender")} />
            </div>
            <div>
              <Label>Numeração (calçado)</Label>
              <Input value={form.shoe_size} onChange={set("shoe_size")} />
            </div>
            <div className="md:col-span-2">
              <Label>Estilo preferido</Label>
              <Input value={form.preferred_style} onChange={set("preferred_style")} />
            </div>
            <div>
              <Label>CEP</Label>
              <Input value={form.cep} onChange={set("cep")} />
            </div>
            <div>
              <Label>Cidade</Label>
              <Input value={form.city} onChange={set("city")} />
            </div>
            <div className="md:col-span-2">
              <Label>Endereço</Label>
              <Input value={form.address} onChange={set("address")} />
            </div>
            <div>
              <Label>Número</Label>
              <Input value={form.address_number} onChange={set("address_number")} />
            </div>
            <div>
              <Label>Complemento</Label>
              <Input value={form.complement} onChange={set("complement")} />
            </div>
            <div>
              <Label>Bairro</Label>
              <Input value={form.neighborhood} onChange={set("neighborhood")} />
            </div>
            <div>
              <Label>Estado (UF)</Label>
              <Input
                value={form.state}
                maxLength={2}
                onChange={(e) => setForm((p) => ({ ...p, state: e.target.value.toUpperCase() }))}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Salvar em todos os sistemas
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
